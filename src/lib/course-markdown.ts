const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
const OBSIDIAN_IMAGE_PATTERN = /!\[\[([^[\]\n]+)\]\]/g;
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i;

export type MarkdownImageReference = {
  altText: string | null;
  index: number;
  needsUpload: boolean;
  sourcePath: string;
  syntax: 'markdown' | 'obsidian';
};

function cleanMarkdownPath(rawPath: string) {
  const trimmedPath = rawPath.trim();
  const withoutBrackets =
    trimmedPath.startsWith('<') && trimmedPath.endsWith('>')
      ? trimmedPath.slice(1, -1).trim()
      : trimmedPath;
  const titleMatch = withoutBrackets.match(/^(.*?)(?:\s+['"].+['"])\s*$/);

  return (titleMatch?.[1] ?? withoutBrackets).trim();
}

/**
 * Image title that carries an Obsidian embed size (`![[x.png|320]]`, `![[x.png|320x200]]`) through
 * markdown, for `transformImageSizes` (content/layout.ts) to turn into a width.
 */
export const IMAGE_SIZE_TITLE_PREFIX = 'obsidian-size:';

function obsidianEmbedSize(rawPath: string) {
  const size = rawPath.split('|')[1]?.trim() ?? '';
  return /^\d+(x\d+)?$/.test(size) ? size : null;
}

/** The alt text of an Obsidian embed (`![[x.svg|What it shows]]`): what follows the bar when it isn't a size. */
function obsidianAltText(rawPath: string) {
  const text = rawPath.split('|').slice(1).join('|').trim();
  return text && !/^\d+(x\d+)?$/.test(text) ? text : null;
}

function cleanObsidianPath(rawPath: string) {
  return rawPath.split('|')[0]?.split('#')[0]?.trim() ?? '';
}

export function isRemoteAssetPath(sourcePath: string) {
  const normalizedSourcePath = sourcePath.trim();

  return (
    /^(https?:)?\/\//i.test(normalizedSourcePath) ||
    normalizedSourcePath.startsWith('data:') ||
    normalizedSourcePath.startsWith('blob:')
  );
}

export function extractMarkdownImageReferences(markdownContent: string) {
  const references: MarkdownImageReference[] = [];
  const markdownImagePattern = new RegExp(MARKDOWN_IMAGE_PATTERN);
  const obsidianImagePattern = new RegExp(OBSIDIAN_IMAGE_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = markdownImagePattern.exec(markdownContent)) !== null) {
    const rawPath = cleanMarkdownPath(match[2] ?? '');

    if (!rawPath) {
      continue;
    }

    references.push({
      altText: match[1]?.trim() || null,
      index: match.index ?? 0,
      needsUpload: !isRemoteAssetPath(rawPath),
      sourcePath: rawPath,
      syntax: 'markdown',
    });
  }

  while ((match = obsidianImagePattern.exec(markdownContent)) !== null) {
    const rawPath = cleanObsidianPath(match[1] ?? '');

    if (!rawPath || !IMAGE_FILE_PATTERN.test(rawPath)) {
      continue;
    }

    references.push({
      altText: obsidianAltText(match[1] ?? ''),
      index: match.index ?? 0,
      needsUpload: !isRemoteAssetPath(rawPath),
      sourcePath: rawPath,
      syntax: 'obsidian',
    });
  }

  return references.sort((left, right) => left.index - right.index);
}

export function getPendingImageReferences(markdownContent: string) {
  const uniqueReferences = new Map<string, MarkdownImageReference>();

  for (const reference of extractMarkdownImageReferences(markdownContent)) {
    if (!reference.needsUpload || uniqueReferences.has(reference.sourcePath)) {
      continue;
    }

    uniqueReferences.set(reference.sourcePath, reference);
  }

  return Array.from(uniqueReferences.values());
}

export function buildLessonAssetReferences(
  markdownContent: string,
  assetIdsBySourcePath = new Map<string, string>()
) {
  return getPendingImageReferences(markdownContent).map((reference, index) => ({
    assetId: assetIdsBySourcePath.get(reference.sourcePath) ?? undefined,
    altText: reference.altText,
    position: index + 1,
    sourcePath: reference.sourcePath,
  }));
}

export function resolveLessonMarkdownAssetUrls(
  markdownContent: string,
  assetUrlsBySourcePath = new Map<string, string>(),
  /** Keep `![[x.png|320]]` sizes as an `IMAGE_SIZE_TITLE_PREFIX` title (content entries only). */
  options: { keepImageSize?: boolean } = {}
) {
  const markdownWithResolvedImages = markdownContent.replace(
    MARKDOWN_IMAGE_PATTERN,
    (fullMatch, rawAltText, rawPath) => {
      const sourcePath = cleanMarkdownPath(String(rawPath ?? ''));

      if (!sourcePath) {
        return fullMatch;
      }

      const resolvedPath = assetUrlsBySourcePath.get(sourcePath) ?? sourcePath;
      const altText = String(rawAltText ?? '').trim();

      return `![${altText}](${resolvedPath})`;
    }
  );

  return markdownWithResolvedImages.replace(
    OBSIDIAN_IMAGE_PATTERN,
    (fullMatch, rawPath) => {
      const sourcePath = cleanObsidianPath(String(rawPath ?? ''));

      if (!sourcePath || !IMAGE_FILE_PATTERN.test(sourcePath)) {
        return fullMatch;
      }

      const resolvedPath = assetUrlsBySourcePath.get(sourcePath) ?? sourcePath;
      const size = options.keepImageSize ? obsidianEmbedSize(String(rawPath ?? '')) : null;
      const altText = obsidianAltText(String(rawPath ?? '')) ?? '';

      return size ? `![${altText}](${resolvedPath} "${IMAGE_SIZE_TITLE_PREFIX}${size}")` : `![${altText}](${resolvedPath})`;
    }
  );
}
