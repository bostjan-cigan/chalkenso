import 'server-only';

import type { OrgRole } from '@prisma/client';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { ZipStream, type ZipSink } from '@/lib/zip-stream';
import { bufferedSink, exportFiles, wrap } from './archive';
import { writeCurriculums, writeImages } from './curriculums';
import { writeCourses, writeFeedback, writeGroups, writePublications, writeTasks, writeTeam, writeVersions } from './records';
import type { ExportContext, ExportPart, ExportScope } from './types';
import type { ExportWords, FeedbackWords } from './words';

/**
 * Writes one export as a stream of .zip bytes. Everything is read and written in order, one query
 * or file at a time, so the database sees one export as one quiet client and the server holds a few
 * pages of rows at most, whatever the organisation's size:
 *
 * 1. the lessons, as the Obsidian plugin keeps them (every version the person can read);
 * 2. courses, groups and rosters; the versions; feedback and notes; tasks; the team (admins);
 * 3. the edition's own parts (`serverExtensions.exportParts`);
 * 4. the text of every published revision, then the lessons' images: the two that can be big, so the
 *    time limit (`deadline`) leaves them out first, and README.txt says what was left out;
 * 5. README.txt, which describes every file that went in.
 */

export type ExportRun = {
  scope: ExportScope;
  locale: Locale;
  words: ExportWords;
  feedbackWords: FeedbackWords;
  /** The edition's role names (Owner, Manager, Instructor…), in the reader's language. */
  roles: Record<OrgRole, { label: string }>;
  parts: ExportPart[];
  /** When optional work (older texts, images) stops: a time (ms since 1970), or null for no limit. */
  deadline: number | null;
  now: Date;
};

const pad = (value: number) => String(value).padStart(2, '0');

/** 2026-10-18, in UTC. */
export function isoDay(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 2026-10-18 14:03, in UTC. */
export function isoMinute(date: Date) {
  return `${isoDay(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

const asDate = (value: Date | string | null | undefined) => (value ? (value instanceof Date ? value : new Date(value)) : null);

/** The export's top folder, and its file name without `.zip`: chalkenso-northwind-academy-2026-10-18. */
export function exportName(scope: Pick<ExportScope, 'organization'>, now: Date) {
  const slug = scope.organization.slug.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'organisation';
  return `chalkenso-${slug}-${isoDay(now)}`;
}

/** README.txt lists files in this order (the edition's parts after the shared ones). */
function rank(path: string, vaultFolder: string) {
  const order = ['courses.csv', 'groups.csv', 'group-learners.csv', 'history/versions.csv', 'history/publications.csv', 'history/', 'feedback.csv', 'tasks.csv', 'task-notes.csv', 'team.csv'];
  if (path.startsWith(`${vaultFolder}/`)) return 0;
  if (path === 'README.txt') return order.length + 2;
  const index = order.findIndex((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
  return index === -1 ? order.length + 1 : index + 1;
}

function underline(text: string, mark: string) {
  return `${text}\r\n${mark.repeat(Math.min(96, text.length))}`;
}

function readme(run: ExportRun, described: Array<{ path: string; text: string }>, leftOut: string[]) {
  const { scope, words: t, now, locale } = run;
  const date = new Intl.DateTimeFormat(INTL_LOCALES[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now);
  const time = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const organization = scope.organization.name;
  const sections = [
    underline(t('readme.title', { organization }), '='),
    wrap(
      `${t('readme.exported', { date, time, name: scope.person.name })} ${
        scope.admin ? t('readme.everything', { organization }) : t('readme.own', { name: scope.person.name, organization })
      }`
    ),
    wrap(t('readme.plain')),
    underline(t('readme.contents'), '-'),
    ...described
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => rank(a.path, scope.vaultFolder) - rank(b.path, scope.vaultFolder) || a.index - b.index)
      .map((entry) => `${entry.path}\r\n${wrap(entry.text, 96, '    ')}`),
    underline(t('readme.obsidianTitle'), '-'),
    wrap(t('readme.obsidian', { folder: scope.vaultFolder })),
    underline(t('readme.neverTitle'), '-'),
    wrap(t('readme.never')),
    ...(leftOut.length ? [underline(t('readme.leftOutTitle'), '-'), leftOut.map((line) => wrap(`- ${line}`)).join('\r\n')] : []),
  ];
  return `${sections.join('\r\n\r\n').replace(/\r?\n/g, '\r\n')}\r\n`;
}

/** Writes the export to `sink`, as described above. Run it inside the organisation's scope. */
export async function writeExport(run: ExportRun, sink: ZipSink) {
  const buffered = bufferedSink(sink);
  const zip = new ZipStream(buffered.write, run.now);
  const described: Array<{ path: string; text: string }> = [];
  const leftOut: string[] = [];
  const context: ExportContext = {
    scope: run.scope,
    files: exportFiles(zip, exportName(run.scope, run.now)),
    describe: (path, text) => described.push({ path, text }),
    leftOut: (text) => leftOut.push(text),
    hasTime: () => run.deadline === null || Date.now() < run.deadline,
    locale: run.locale,
    now: run.now,
    day: (value) => {
      const date = asDate(value);
      return date ? isoDay(date) : null;
    },
    time: (value) => {
      const date = asDate(value);
      return date ? isoMinute(date) : null;
    },
  };
  const { words: t, feedbackWords } = run;

  const { lessons, images } = await writeCurriculums(context, t);
  await writeCourses(context, t);
  await writeGroups(context, t);
  await writeVersions(context, t);
  await writeFeedback(context, t, feedbackWords);
  await writeTasks(context, t, feedbackWords);
  await writeTeam(context, t, run.roles);
  for (const part of run.parts) {
    await part.write(context);
  }
  await writePublications(context, t, feedbackWords, lessons);
  await writeImages(context, t, images);

  context.describe('README.txt', t('describe.readme'));
  await context.files.text('README.txt', readme(run, described, leftOut));
  await zip.finish();
  await buffered.flush();
}
