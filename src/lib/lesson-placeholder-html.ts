import 'server-only';

import { transformObsidianCallouts } from './content/callouts';
import { resolveLessonMarkdownAssetUrls } from './course-markdown';
import { renderCourseMarkdownToHtml } from './markdown';

/**
 * Turning lesson markdown into HTML with placeholder image URLs — the half of lesson rendering that
 * runs when a lesson is *written*.
 *
 * Split out from `access-lesson-render.ts`, which also holds the read-time hydration that swaps
 * those placeholders for signed URLs and therefore imports the R2 client. Write paths need the
 * markdown pipeline but never R2, so keeping them apart stops `@aws-sdk/client-s3` shipping with
 * every lesson write route.
 */

/** Synthetic origin; replaced with signed URLs at read time. */
export const LESSON_ACCESS_ASSET_PLACEHOLDER_BASE = 'https://lesson-assets.invalid/a/';

export function lessonAccessAssetPlaceholderUrl(assetId: string) {
  return `${LESSON_ACCESS_ASSET_PLACEHOLDER_BASE}${encodeURIComponent(assetId)}`;
}

export function buildAccessPlaceholderHtml(
  markdownContent: string,
  references: { assetId: string | null | undefined; sourcePath: string }[]
) {
  const assetUrlsBySourcePath = new Map<string, string>();

  for (const reference of references) {
    const assetId = reference.assetId?.trim();

    if (assetId) {
      assetUrlsBySourcePath.set(reference.sourcePath, lessonAccessAssetPlaceholderUrl(assetId));
    }
  }

  return renderLessonMarkdownToHtml(
    resolveLessonMarkdownAssetUrls(markdownContent, assetUrlsBySourcePath)
  );
}

/** The lesson pipeline: course markdown plus Obsidian callouts and wikilink placeholders. */
export function renderLessonMarkdownToHtml(markdown: string) {
  return renderCourseMarkdownToHtml(markdown, {
    hastTransforms: [transformObsidianCallouts],
    wikilinks: true,
  });
}
