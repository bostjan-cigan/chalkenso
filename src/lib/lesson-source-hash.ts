import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { COURSE_MARKDOWN_RENDER_VERSION } from './markdown-version';

/**
 * The cheap half of lesson rendering: identifying a lesson's source, with no markdown pipeline and
 * no R2 client behind it. Sync routes that only read lessons import from here, so they don't load
 * `@aws-sdk/client-s3` and `rehype-highlight` on every cold start just to hash a string.
 */

/** `[{ sourcePath, assetId }]` stored in `Lesson.publishedAssetBindings`. */
export type PublishedAssetBinding = { sourcePath: string; assetId: string };

export function parsePublishedAssetBindings(
  value: Prisma.JsonValue | null
): PublishedAssetBinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const { sourcePath, assetId } = entry as Record<string, unknown>;
    return typeof sourcePath === 'string' && typeof assetId === 'string'
      ? [{ sourcePath, assetId }]
      : [];
  });
}

export function computeLessonSourceHash(
  markdownContent: string,
  references: { assetId: string | null; sourcePath: string }[]
) {
  const refPart = [...references]
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
    .map((reference) => `${reference.sourcePath}\x00${reference.assetId ?? ''}`)
    .join('\x01');

  return createHash('sha256')
    .update(COURSE_MARKDOWN_RENDER_VERSION)
    .update('\n')
    .update(markdownContent)
    .update('\n')
    .update(refPart)
    .digest('hex');
}
