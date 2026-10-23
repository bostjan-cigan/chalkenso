import 'server-only';

import type { Prisma } from '@prisma/client';

import { resolveLessonMarkdownAssetUrls } from './course-markdown';
import { transformObsidianCallouts } from './content/callouts';
import { getCachedGroupAssetUrls } from './group-asset-url-cache';
import { resolveLessonWikilinks } from './lesson-wikilinks';
import { renderCourseMarkdownToHtml } from './markdown';
import { computeLessonSourceHash, parsePublishedAssetBindings } from './lesson-source-hash';
import { prisma } from './prisma';
import { getSignedR2ObjectUrl } from './r2';

/** Preview links have no group cache row, so their asset URLs are signed per lesson load. */
const PREVIEW_ASSET_URL_TTL_SECONDS = 60 * 60 * 6;

type AccessLessonAssetReference = {
  asset: {
    id: string;
    r2Key: string;
  } | null;
  assetId: string | null;
  sourcePath: string;
};

export type RenderedAccessLesson = {
  html: string;
  id: string;
  position: number;
  title: string;
};

type AccessRenderParams = {
  curriculumVersionId: string;
  /** Null for draft preview links (no group-scoped URL cache). */
  groupId: string | null;
  lessonId: string;
  /**
   * `published` (learners): the lesson's published snapshot; never-published lessons are not found.
   * `working` (draft preview links): the current working copy, drafts included.
   */
  text: 'published' | 'working';
};

// Moved to `lesson-source-hash.ts` so read-only callers can skip this module's heavy imports;
// re-exported here because plenty of code already reaches for them through this path.
export {
  computeLessonSourceHash,
  parsePublishedAssetBindings,
  type PublishedAssetBinding,
} from './lesson-source-hash';

// Rendering placeholder HTML doesn't need R2, so it lives in its own module; re-exported here
// for the read path below and for existing callers.
export {
  LESSON_ACCESS_ASSET_PLACEHOLDER_BASE,
  buildAccessPlaceholderHtml,
  lessonAccessAssetPlaceholderUrl,
  renderLessonMarkdownToHtml,
} from './lesson-placeholder-html';

import {
  LESSON_ACCESS_ASSET_PLACEHOLDER_BASE,
  buildAccessPlaceholderHtml,
  renderLessonMarkdownToHtml,
} from './lesson-placeholder-html';

/**
 * Resolves wikilink placeholders against the lessons a reader of this version can open: the
 * published ones for learners, all of them for previews.
 */
export async function resolveLessonLinksForVersion(
  html: string,
  curriculumVersionId: string,
  text: 'published' | 'working'
) {
  if (!html.includes('lesson-links.invalid')) {
    return html;
  }

  const lessons = await prisma.lesson.findMany({
    where: {
      curriculumVersionId,
      ...(text === 'published' ? { publishedAt: { not: null } } : {}),
    },
    orderBy: { position: 'asc' },
    select: { id: true, slug: true, title: true, publishedTitle: true },
  });

  return resolveLessonWikilinks(
    html,
    lessons.map((lesson) => ({
      id: lesson.id,
      slug: lesson.slug,
      title: text === 'published' ? lesson.publishedTitle ?? lesson.title : lesson.title,
    }))
  );
}

/**
 * Matches any asset placeholder in one pass, so hydration costs a single scan of the document
 * rather than one full re-scan per image.
 */
const LESSON_ACCESS_ASSET_PLACEHOLDER_PATTERN = new RegExp(
  `${LESSON_ACCESS_ASSET_PLACEHOLDER_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([A-Za-z0-9%._~-]+)`,
  'g'
);

async function hydrateAccessLessonHtml(
  html: string,
  references: AccessLessonAssetReference[],
  groupId: string | null
) {
  // Distinct assets only: one image may be referenced many times in a lesson.
  const r2KeyByAssetId = new Map<string, string>();
  for (const reference of references) {
    if (reference.asset?.id && reference.asset.r2Key) {
      r2KeyByAssetId.set(reference.asset.id, reference.asset.r2Key);
    }
  }

  if (r2KeyByAssetId.size === 0) {
    return html;
  }

  const assets = Array.from(r2KeyByAssetId, ([assetId, r2Key]) => ({ assetId, r2Key }));

  // Group links read a shared cache table, so they resolve in a fixed number of queries; preview
  // links have no cache row and sign locally, which costs no round-trip at all. Either way every
  // asset is resolved before the first replacement, rather than one blocking lookup per image.
  const urlByAssetId = groupId
    ? await getCachedGroupAssetUrls(groupId, assets)
    : new Map(
        await Promise.all(
          assets.map(
            async ({ assetId, r2Key }) =>
              [
                assetId,
                await getSignedR2ObjectUrl(r2Key, PREVIEW_ASSET_URL_TTL_SECONDS),
              ] as const
          )
        )
      );

  return replaceLessonAssetPlaceholders(html, (assetId) => urlByAssetId.get(assetId));
}

/**
 * A lesson's published snapshot rendered to placeholder HTML (asset and wikilink placeholders not
 * yet resolved), cached on the lesson row. Shared by learner links and the public `/courses` pages.
 */
export async function getPublishedLessonPlaceholderHtml(curriculumVersionId: string, lessonId: string) {
  const lesson = await prisma.lesson.findFirst({
    where: { curriculumVersionId, id: lessonId, publishedAt: { not: null } },
    select: {
      id: true,
      position: true,
      publishedTitle: true,
      publishedMarkdownContent: true,
      publishedAssetBindings: true,
      publishedRenderedHtml: true,
      publishedHtmlSourceHash: true,
    },
  });

  if (!lesson) {
    return null;
  }

  const markdown = lesson.publishedMarkdownContent ?? '';
  const bindings = parsePublishedAssetBindings(lesson.publishedAssetBindings);
  const hash = computeLessonSourceHash(markdown, bindings);

  let placeholderHtml: string;

  if (lesson.publishedRenderedHtml && lesson.publishedHtmlSourceHash === hash) {
    placeholderHtml = lesson.publishedRenderedHtml;
  } else {
    placeholderHtml = buildAccessPlaceholderHtml(markdown, bindings);

    // Right after a publish every learner opening the lesson lands here at once: only the first
    // write goes through, the others find the hash already stored and skip the row.
    await prisma.$executeRaw`
      UPDATE "courses"."lessons"
      SET
        "published_rendered_html" = ${placeholderHtml},
        "published_html_source_hash" = ${hash}
      WHERE "id" = ${lessonId}
        AND ("published_html_source_hash" IS DISTINCT FROM ${hash} OR "published_rendered_html" IS NULL)
    `;
  }

  return { bindings, lesson, placeholderHtml };
}

/** Replaces every asset placeholder in one pass; unknown ids are left exactly as found. */
export function replaceLessonAssetPlaceholders(html: string, urlFor: (assetId: string) => string | undefined) {
  return html.replace(LESSON_ACCESS_ASSET_PLACEHOLDER_PATTERN, (match, encodedAssetId: string) => {
    try {
      return urlFor(decodeURIComponent(encodedAssetId)) ?? match;
    } catch {
      return match;
    }
  });
}

/** Renders a lesson's published snapshot (what learners see), caching the placeholder HTML. */
async function getRenderedPublishedLesson(
  params: AccessRenderParams
): Promise<RenderedAccessLesson | null> {
  const { curriculumVersionId, groupId, lessonId } = params;

  const rendered = await getPublishedLessonPlaceholderHtml(curriculumVersionId, lessonId);
  if (!rendered) {
    return null;
  }
  const { bindings, lesson, placeholderHtml } = rendered;

  const assets = bindings.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: Array.from(new Set(bindings.map((binding) => binding.assetId))) } },
        select: { id: true, r2Key: true },
      })
    : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const html = await hydrateAccessLessonHtml(
    placeholderHtml,
    bindings.map((binding) => ({
      asset: assetById.get(binding.assetId) ?? null,
      assetId: binding.assetId,
      sourcePath: binding.sourcePath,
    })),
    groupId
  );

  return {
    html: await resolveLessonLinksForVersion(html, curriculumVersionId, 'published'),
    id: lesson.id,
    position: lesson.position,
    title: lesson.publishedTitle ?? '',
  };
}

export async function getRenderedLessonForAccess(
  params: AccessRenderParams
): Promise<RenderedAccessLesson | null> {
  if (params.text === 'published') {
    return getRenderedPublishedLesson(params);
  }

  const { curriculumVersionId, groupId, lessonId } = params;

  const lesson = await prisma.lesson.findFirst({
    where: {
      curriculumVersionId,
      id: lessonId,
    },
    select: {
      accessHtmlSourceHash: true,
      accessRenderedHtml: true,
      assetReferences: {
        orderBy: {
          position: 'asc',
        },
        select: {
          asset: {
            select: {
              id: true,
              r2Key: true,
            },
          },
          assetId: true,
          sourcePath: true,
        },
      },
      id: true,
      markdownContent: true,
      position: true,
      title: true,
    },
  });

  if (!lesson) {
    return null;
  }

  const hashInputs = lesson.assetReferences.map((reference) => ({
    assetId: reference.assetId,
    sourcePath: reference.sourcePath,
  }));

  const liveHash = computeLessonSourceHash(lesson.markdownContent, hashInputs);

  let placeholderHtml: string;

  if (lesson.accessRenderedHtml && lesson.accessHtmlSourceHash === liveHash) {
    placeholderHtml = lesson.accessRenderedHtml;
  } else {
    placeholderHtml = buildAccessPlaceholderHtml(lesson.markdownContent, hashInputs);

    // Many readers of a preview at once: only the first write goes through (as for published text).
    await prisma.$executeRaw`
      UPDATE "courses"."lessons"
      SET
        "access_rendered_html" = ${placeholderHtml},
        "access_html_source_hash" = ${liveHash}
      WHERE "id" = ${lessonId}
        AND ("access_html_source_hash" IS DISTINCT FROM ${liveHash} OR "access_rendered_html" IS NULL)
    `;
  }

  const referencesForHydrate: AccessLessonAssetReference[] = lesson.assetReferences.map((reference) => ({
    asset: reference.asset,
    assetId: reference.assetId,
    sourcePath: reference.sourcePath,
  }));

  const html = await hydrateAccessLessonHtml(placeholderHtml, referencesForHydrate, groupId);

  return {
    html: await resolveLessonLinksForVersion(html, curriculumVersionId, 'working'),
    id: lesson.id,
    position: lesson.position,
    title: lesson.title,
  };
}
