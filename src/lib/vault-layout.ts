import type { CurriculumSyncManifest } from './curriculum-sync-read';

/**
 * How Chalkenso's Obsidian plugin lays out a vault (its README, "Folders"; the plugin is its own
 * repository, chalkenso-obsidian), for files written on the server: "Export everything" writes each
 * course version and group curriculum exactly as the plugin writes a folder it downloads, so the
 * export can be copied into a vault and synced.
 *
 * The plugin is one `main.js` with no build step, so it can't import this; each function here
 * mirrors the one it names in the plugin's `main.js`, and a test runs the plugin's own download
 * against the same lessons and checks the two agree. Change both together.
 *
 * - `<Organisation>/Curriculums/<course> – <version>/`: one folder per course version;
 * - `<Organisation>/Groups/<course> – <group>/`: one per group curriculum, with the plugin's README.md;
 * - a note per lesson at the folder's top, named after the lesson (`<name> (2).md` when taken), its
 *   properties as the plugin writes them after a download, and its body the lesson's text;
 * - `_attachments/` for images embedded with `![[…]]`; `![](path)` images at that path.
 *
 * Pure: no Node, Next or database.
 */

export const CURRICULUMS_FOLDER = 'Curriculums';
export const GROUPS_FOLDER = 'Groups';
export const ATTACHMENTS_FOLDER = '_attachments';
export const FOLDER_README = 'README.md';

/** A course version or group curriculum as the sync describes it (`/api/sync/me`, the manifest). */
export type VaultWorkspace = Pick<CurriculumSyncManifest['version'], 'label' | 'course' | 'group' | 'baseVersion'>;

/** A lesson as the manifest carries it with `include=content`. */
export type VaultLesson = CurriculumSyncManifest['lessons'][number];

const FORBIDDEN = /[\\/:*?"<>|#^[\]]+/g;

/** `sanitizeFolderName`: a file-name-safe folder name, keeping the en dash and spaces. */
export function sanitizeFolderName(value: string | null | undefined, fallback = 'Group'): string {
  const cleaned = String(value ?? '')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

/** `sanitizeFileName`: a lesson note's name from its title. */
export function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  return cleaned || 'Lesson';
}

/**
 * `workspaceFolderPath`'s name part: `<course> – <group>` for a group curriculum, `<course> –
 * <version label>` for a course version. Its parent is the organisation's Groups or Curriculums.
 */
export function workspaceFolderName(workspace: VaultWorkspace): string {
  const group = Boolean(workspace.group);
  return sanitizeFolderName(
    `${workspace.course?.title ?? 'Course'} – ${group ? (workspace.group?.name ?? workspace.label ?? 'Group') : (workspace.label ?? 'Version')}`
  );
}

/** `groupReadmeContent`: the README.md the plugin writes in a group curriculum's folder. */
export function groupReadmeContent(workspace: VaultWorkspace): string {
  const group = workspace.group?.name ?? workspace.label ?? 'this group';
  const course = workspace.course?.title ?? 'the course';
  const base = workspace.baseVersion?.label ? `core ${workspace.baseVersion.label}` : 'the core curriculum';
  return `Group curriculum for ${group} (${course}), copied from ${base}. Changes here only affect this group. Managed by the Chalkenso plugin — the folder is removed when the group is closed.\n`;
}

/**
 * `uniqueNotePath`: a free `<folder>/<name>.md` (then `<name> (2).md`, …), checked
 * case-insensitively against `taken` (lower-case paths), which it adds to.
 */
export function uniqueNotePath(folder: string, name: string, taken: Set<string>): string {
  const pathFor = (suffix: string) => (folder ? `${folder}/${name}${suffix}.md` : `${name}${suffix}.md`);
  let path = pathFor('');
  for (let n = 2; taken.has(path.toLowerCase()); n += 1) {
    path = pathFor(` (${n})`);
  }
  taken.add(path.toLowerCase());
  return path;
}

/** The note's name for a lesson (`createLessonNote`), before it is made unique. */
export function lessonNoteName(lesson: Pick<VaultLesson, 'title'>): string {
  return sanitizeFileName(String(lesson.title ?? 'Lesson')).replace(/^\.+/, '').trim() || 'Lesson';
}

const RESERVED_SCALAR = /^(?:true|false|yes|no|on|off|null|~|y|n)$/i;
const NUMBER_LIKE = /^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$|^0x[0-9a-f]+$|^0o[0-7]+$|^\.(?:inf|nan)$/i;
const PLAIN_SCALAR = /^[\p{L}\p{N}][\p{L}\p{N} _.,()'’–—-]*$/u;

/**
 * A YAML value: a number as it is, a string plain where YAML reads it back as the same string, and
 * double-quoted (JSON, which is valid YAML) otherwise. Obsidian reads both.
 */
export function yamlScalar(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const plain = PLAIN_SCALAR.test(value) && !/\s$/.test(value) && !RESERVED_SCALAR.test(value) && !NUMBER_LIKE.test(value);
  return plain ? value : JSON.stringify(value);
}

/**
 * A downloaded lesson's note (`createLessonNote`): the properties the plugin writes (`title` only
 * when it differs from the note's name; `lessonId`, `lessonStatus`, `revision`, `lastSynced` and
 * `syncStatus` are the plugin's own) and the lesson's text. `notePath` is where it goes (from
 * `uniqueNotePath`), `syncedAt` the moment it counts as synced.
 */
export function lessonNote(lesson: VaultLesson, notePath: string, syncedAt: string): string {
  const basename = notePath.split('/').pop()!.replace(/\.md$/, '');
  const properties: Array<[string, string | number | null | undefined]> = [
    ['title', lesson.title && lesson.title !== basename ? lesson.title : null],
    ['arc', lesson.arcTitle || null],
    ['shortDescription', typeof lesson.shortDescription === 'string' && lesson.shortDescription.trim() ? lesson.shortDescription : null],
    ['status', String(lesson.status ?? 'DRAFT').toLowerCase()],
    ['lessonId', lesson.id],
    ['slug', lesson.slug],
    ['lessonStatus', lesson.status],
    ['revision', typeof lesson.revision === 'number' ? lesson.revision : null],
    ['lastSynced', syncedAt],
    ['syncStatus', 'synced'],
  ];
  const yaml = properties
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
    .join('\n');
  const body = String(lesson.markdownContent ?? '').trim();
  return `---\n${yaml}\n---\n\n${body}\n`;
}

// ── Images (`restoreImages`) ────────────────────────────────────────────────────────────────────

const OBSIDIAN_EMBED_PATTERN = /!\[\[([^[\]\n]+)\]\]/g;
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i;

function cleanObsidianPath(raw: string) {
  return raw.split('|')[0]?.split('#')[0]?.trim() ?? '';
}

function isRemote(path: string) {
  return /^(https?:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:');
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `resolveRelativePath`: `relative` from `folder` (a leading `/` is the vault's top); null when it climbs out. */
function resolveRelativePath(folder: string, relative: string): string | null {
  const segments = relative.startsWith('/') || !folder ? [] : folder.split('/');
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

/**
 * Where the plugin puts one of a lesson's images in the vault (paths from the vault's top): an
 * `![[embed]]` into the folder's `_attachments/`, an `![](relative/path)` at that path from the
 * note's folder. Null for a remote image, or a path it refuses (hidden, not an image, outside).
 */
export function imagePath(folder: string, noteFolder: string, markdown: string, sourcePath: string): string | null {
  const source = sourcePath.trim();
  if (!source || isRemote(source)) return null;
  const embeds = new Set<string>();
  for (const match of Array.from(markdown.matchAll(OBSIDIAN_EMBED_PATTERN))) {
    embeds.add(cleanObsidianPath(match[1] ?? ''));
  }
  const decoded = safeDecode(source);
  const isEmbed = embeds.has(source);
  const attachments = `${folder}/${ATTACHMENTS_FOLDER}`;
  const target = isEmbed ? resolveRelativePath(attachments, decoded.replace(/^\/+/, '')) : resolveRelativePath(noteFolder, decoded);
  const unsafe =
    !target ||
    !IMAGE_FILE_PATTERN.test(target) ||
    target.split('/').some((segment) => segment.startsWith('.')) ||
    (isEmbed && !target.startsWith(`${attachments}/`));
  return unsafe ? null : target;
}
