import 'server-only';

import { LessonStatus, Permission } from '@prisma/client';

import { assetIdsInOrganization } from './asset-scope';
import { buildLessonAssetReferences } from './course-markdown';
import { buildAccessPlaceholderHtml } from './lesson-placeholder-html';
import { computeLessonSourceHash } from './lesson-source-hash';
import { applyLessonStatus, deleteLesson } from './lesson-publishing';
import { prisma } from './prisma';
import { createSlugCandidate } from './slugs';
import { isUniqueViolation, retryOnUniqueViolation } from './unique-retry';

// The read half lives in its own module so read-only routes don't pull this one's imports in.
// Re-exported here because the write routes need both halves anyway.
export {
  authorizeCurriculumSync,
  getCurriculumSyncManifest,
  isAssetInCurriculumVersion,
  CURRICULUM_VERSION_HEADER,
  GROUP_CURRICULUM_CLOSED,
  type CurriculumSyncAuth,
  type CurriculumSyncManifest,
  type CurriculumSyncManifestLesson,
  type CurriculumSyncLessonContent,
} from './curriculum-sync-read';

export type CreateSyncLessonInput = {
  title?: unknown;
  markdownContent?: unknown;
  arcId?: unknown;
  slug?: unknown;
  shortDescription?: unknown;
  status?: unknown;
  /** `[{ sourcePath, assetId }]` binding uploaded images to the markdown's image references. */
  assetBindings?: unknown;
  /**
   * Update only: the lesson revision the client last synced. When it no longer matches, the update
   * is refused as a conflict. Omitted means "overwrite whatever is there".
   */
  baseRevision?: unknown;
};

export type CreatedSyncLesson = {
  id: string;
  title: string;
  slug: string;
  arcId: string | null;
  status: LessonStatus;
  position: number;
  revision: number;
};

/** The server's side of a conflicting update, so the client can show or keep both versions. */
export type SyncLessonConflict = {
  revision: number;
  title: string;
  markdownContent: string;
  arcTitle: string | null;
  status: LessonStatus;
  updatedAt: string;
};

export type CreateSyncLessonResult =
  | { ok: true; courseId: string; lesson: CreatedSyncLesson }
  | { ok: false; status: number; error: string; conflict?: SyncLessonConflict };

const SYNC_LESSON_SELECT = {
  id: true,
  title: true,
  slug: true,
  arcId: true,
  status: true,
  position: true,
  revision: true,
} as const;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseLessonStatus(value: unknown): LessonStatus {
  return asString(value).toUpperCase() === LessonStatus.PUBLISHED
    ? LessonStatus.PUBLISHED
    : LessonStatus.DRAFT;
}

/**
 * Turns the request's `assetBindings` into a `sourcePath -> assetId` map, keeping only bindings
 * whose asset exists (an unknown id would violate the reference FK on insert) and belongs to the
 * course's organisation (another organisation's image id is dropped).
 */
async function resolveAssetBindings(value: unknown, courseId: string): Promise<Map<string, string>> {
  const bindings = new Map<string, string>();

  if (!Array.isArray(value)) {
    return bindings;
  }

  const requested = new Map<string, string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const sourcePath = asString((entry as { sourcePath?: unknown }).sourcePath).trim();
    const assetId = asString((entry as { assetId?: unknown }).assetId).trim();
    if (sourcePath && assetId) {
      requested.set(sourcePath, assetId);
    }
  }

  if (requested.size === 0) {
    return bindings;
  }

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { organizationId: true } });
  const validAssetIds = course
    ? await assetIdsInOrganization(Array.from(new Set(requested.values())), course.organizationId)
    : new Set<string>();

  for (const [sourcePath, assetId] of Array.from(requested)) {
    if (validAssetIds.has(assetId)) {
      bindings.set(sourcePath, assetId);
    }
  }

  return bindings;
}

/**
 * Creates a single new lesson in the requested curriculum version. Sync is create-only: an existing
 * slug is reported as a conflict rather than silently duplicated, so re-running the plugin is safe.
 * Arcs are not created here — the `arcId` must reference an arc of the version (authored in the
 * admin UI, or created first with `createSyncArc`).
 *
 * Mirrors the admin `createLessonAction` create path (slug/position/asset-reference/pre-rendered
 * HTML handling) but without uploaded image bindings; referenced images resolve once uploaded in the
 * admin.
 */
export async function createSyncLesson(
  versionId: string,
  input: CreateSyncLessonInput,
  /** The token's owner: the version history says who published it. */
  publishedBy?: string
): Promise<CreateSyncLessonResult> {
  const title = asString(input.title).trim();
  const markdownContent = asString(input.markdownContent);

  if (!title) {
    return { ok: false, status: 400, error: 'title is required.' };
  }

  if (!markdownContent.trim()) {
    return { ok: false, status: 400, error: 'markdownContent is required.' };
  }

  const version = await prisma.curriculumVersion.findUnique({
    where: { id: versionId },
    select: { id: true, courseId: true },
  });

  if (!version) {
    return { ok: false, status: 404, error: 'Curriculum version no longer exists.' };
  }

  let arcId: string | null = null;
  const requestedArcId = asString(input.arcId).trim();

  if (requestedArcId) {
    const arc = await prisma.lessonArc.findFirst({
      where: { id: requestedArcId, curriculumVersionId: versionId },
      select: { id: true },
    });

    if (!arc) {
      return {
        ok: false,
        status: 400,
        error: 'arcId does not belong to this curriculum version.',
      };
    }

    arcId = arc.id;
  }

  const slug = createSlugCandidate(asString(input.slug).trim() || title);

  const existing = await prisma.lesson.findUnique({
    where: {
      curriculumVersionId_slug: { curriculumVersionId: versionId, slug },
    },
    select: { id: true },
  });

  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `A lesson with slug "${slug}" already exists in this version.`,
    };
  }

  const assetBindings = await resolveAssetBindings(input.assetBindings, version.courseId);
  const assetReferences = buildLessonAssetReferences(markdownContent, assetBindings);
  const accessRefs = assetReferences.map((reference) => ({
    assetId: reference.assetId ?? null,
    sourcePath: reference.sourcePath,
  }));
  const accessHash = computeLessonSourceHash(markdownContent, accessRefs);
  const accessHtml = buildAccessPlaceholderHtml(markdownContent, accessRefs);

  const shortDescription = asString(input.shortDescription).trim() || null;

  let lesson: CreatedSyncLesson;
  try {
    // Appended last. Two creates at once can pick the same position (it is unique per version): the
    // one that loses tries again. Created and published in one step, so a failure leaves nothing.
    lesson = await retryOnUniqueViolation(
      () =>
        prisma.$transaction(async (transaction) => {
          const lastLesson = await transaction.lesson.findFirst({
            where: { curriculumVersionId: versionId },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          const created = await transaction.lesson.create({
            data: {
              accessHtmlSourceHash: accessHash,
              accessRenderedHtml: accessHtml,
              arcId,
              assetReferences: assetReferences.length
                ? { create: assetReferences }
                : undefined,
              courseId: version.courseId,
              curriculumVersionId: versionId,
              markdownContent,
              position: (lastLesson?.position ?? 0) + 1,
              shortDescription,
              slug,
              status: parseLessonStatus(input.status),
              title,
            },
            select: SYNC_LESSON_SELECT,
          });

          // `lessonStatus: published` makes it visible to learners right away; a draft stays hidden.
          await applyLessonStatus(transaction, created.id, created.status, publishedBy);
          return created;
        }),
      { fields: ['position'] }
    );
  } catch (error) {
    // The same slug created a moment ago (the check above came first): the same answer as the check.
    if (isUniqueViolation(error, ['slug'])) {
      return {
        ok: false,
        status: 409,
        error: `A lesson with slug "${slug}" already exists in this version.`,
      };
    }
    throw error;
  }

  return { ok: true, courseId: version.courseId, lesson };
}

export type CreateSyncArcInput = {
  title?: unknown;
  description?: unknown;
};

export type SyncArc = { id: string; title: string; description: string | null; position: number };

/** 409 `reason` when the version already has an arc with that title; the response carries it. */
export const ARC_EXISTS = 'arc_exists';

export type CreateSyncArcResult =
  | { ok: true; courseId: string; arc: SyncArc }
  | { ok: false; status: number; error: string; reason?: string; arc?: SyncArc };

const SYNC_ARC_SELECT = { id: true, title: true, description: true, position: true } as const;

/**
 * Creates an arc (a part of the course) at the end of the version, so the plugin can create a
 * vault's parts before syncing their lessons. A title the version already has (ignoring case) is
 * reported with that arc instead of making a second one, so re-running the plugin is safe.
 */
export async function createSyncArc(versionId: string, input: CreateSyncArcInput): Promise<CreateSyncArcResult> {
  const title = asString(input.title).trim();
  const description = asString(input.description).trim() || null;

  if (!title) {
    return { ok: false, status: 400, error: 'title is required.' };
  }

  const version = await prisma.curriculumVersion.findUnique({
    where: { id: versionId },
    select: { id: true, courseId: true },
  });

  if (!version) {
    return { ok: false, status: 404, error: 'Curriculum version no longer exists.' };
  }

  const existing = await prisma.lessonArc.findFirst({
    where: { curriculumVersionId: versionId, title: { equals: title, mode: 'insensitive' } },
    orderBy: { position: 'asc' },
    select: SYNC_ARC_SELECT,
  });

  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `An arc titled "${existing.title}" already exists in this version.`,
      reason: ARC_EXISTS,
      arc: existing,
    };
  }

  // Appended last. Two requests at once can pick the same position (it is unique per version):
  // the one that loses tries again.
  const arc = await retryOnUniqueViolation(
    async () => {
      const last = await prisma.lessonArc.findFirst({
        where: { curriculumVersionId: versionId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      return prisma.lessonArc.create({
        data: { curriculumVersionId: versionId, title, description, position: (last?.position ?? 0) + 1 },
        select: SYNC_ARC_SELECT,
      });
    },
    { fields: ['position'] }
  );
  return { ok: true, courseId: version.courseId, arc };
}

function parseBaseRevision(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 'invalid';
}

async function loadSyncLessonConflict(lessonId: string): Promise<SyncLessonConflict | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      revision: true,
      title: true,
      markdownContent: true,
      status: true,
      updatedAt: true,
      arc: { select: { title: true } },
    },
  });

  if (!lesson) {
    return null;
  }

  return {
    revision: lesson.revision,
    title: lesson.title,
    markdownContent: lesson.markdownContent,
    arcTitle: lesson.arc?.title ?? null,
    status: lesson.status,
    updatedAt: lesson.updatedAt.toISOString(),
  };
}

function conflictResult(conflict: SyncLessonConflict | null): CreateSyncLessonResult {
  return {
    ok: false,
    status: 409,
    error: 'The lesson changed on the server since it was last synced.',
    conflict: conflict ?? undefined,
  };
}

/**
 * Updates an existing lesson in the requested curriculum version (the re-sync path). Replaces the
 * lesson's asset references from the new markdown + bindings, exactly like the admin editor. The
 * slug stays stable unless a different, free slug is explicitly supplied. With `baseRevision`, the
 * write only happens if the lesson is still at that revision; otherwise the server copy is returned
 * as a conflict and nothing changes.
 */
export async function updateSyncLesson(
  versionId: string,
  lessonId: string,
  input: CreateSyncLessonInput,
  /** The token's owner: the version history says who published it. */
  publishedBy?: string
): Promise<CreateSyncLessonResult> {
  const title = asString(input.title).trim();
  const markdownContent = asString(input.markdownContent);

  if (!title) {
    return { ok: false, status: 400, error: 'title is required.' };
  }
  if (!markdownContent.trim()) {
    return { ok: false, status: 400, error: 'markdownContent is required.' };
  }

  const baseRevision = parseBaseRevision(input.baseRevision);
  if (baseRevision === 'invalid') {
    return { ok: false, status: 400, error: 'baseRevision must be a positive integer.' };
  }

  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, curriculumVersionId: versionId },
    select: { id: true, courseId: true, slug: true, revision: true },
  });

  if (!lesson) {
    return { ok: false, status: 404, error: 'Lesson not found in this curriculum version.' };
  }

  if (baseRevision !== null && baseRevision !== lesson.revision) {
    return conflictResult(await loadSyncLessonConflict(lessonId));
  }

  let arcId: string | null = null;
  const requestedArcId = asString(input.arcId).trim();
  if (requestedArcId) {
    const arc = await prisma.lessonArc.findFirst({
      where: { id: requestedArcId, curriculumVersionId: versionId },
      select: { id: true },
    });
    if (!arc) {
      return {
        ok: false,
        status: 400,
        error: 'arcId does not belong to this curriculum version.',
      };
    }
    arcId = arc.id;
  }

  const requestedSlug = createSlugCandidate(asString(input.slug).trim() || lesson.slug);
  let slug = lesson.slug;
  if (requestedSlug !== lesson.slug) {
    const clash = await prisma.lesson.findUnique({
      where: {
        curriculumVersionId_slug: { curriculumVersionId: versionId, slug: requestedSlug },
      },
      select: { id: true },
    });
    if (clash && clash.id !== lessonId) {
      return {
        ok: false,
        status: 409,
        error: `A lesson with slug "${requestedSlug}" already exists in this version.`,
      };
    }
    slug = requestedSlug;
  }

  const assetBindings = await resolveAssetBindings(input.assetBindings, lesson.courseId);
  const assetReferences = buildLessonAssetReferences(markdownContent, assetBindings);
  const accessRefs = assetReferences.map((reference) => ({
    assetId: reference.assetId ?? null,
    sourcePath: reference.sourcePath,
  }));
  const accessHash = computeLessonSourceHash(markdownContent, accessRefs);
  const accessHtml = buildAccessPlaceholderHtml(markdownContent, accessRefs);
  const shortDescription = asString(input.shortDescription).trim() || null;

  const updated = await prisma.$transaction(async (transaction) => {
    // Guard on the revision read above, so a write that landed in between is not overwritten.
    const guarded = await transaction.lesson.updateMany({
      where: { id: lessonId, revision: lesson.revision },
      data: {
        accessHtmlSourceHash: accessHash,
        accessRenderedHtml: accessHtml,
        arcId,
        markdownContent,
        shortDescription,
        slug,
        status: parseLessonStatus(input.status),
        title,
        revision: { increment: 1 },
      },
    });

    if (guarded.count === 0) {
      return null;
    }

    await transaction.lessonAssetReference.deleteMany({ where: { lessonId } });

    const result = await transaction.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      select: SYNC_LESSON_SELECT,
    });

    if (assetReferences.length > 0) {
      await transaction.lessonAssetReference.createMany({
        data: assetReferences.map((reference) => ({
          altText: reference.altText,
          assetId: reference.assetId ?? null,
          lessonId,
          position: reference.position,
          sourcePath: reference.sourcePath,
        })),
      });
    }

    // PUBLISHED: learners get the new text; DRAFT: they keep the last published one.
    await applyLessonStatus(transaction, lessonId, result.status, publishedBy);

    return result;
  }).catch((error: unknown) => {
    // The new slug taken a moment ago by another lesson (the check above came first).
    if (slug !== lesson.slug && isUniqueViolation(error, ['slug'])) {
      return 'slug-taken' as const;
    }
    throw error;
  });

  if (updated === 'slug-taken') {
    return {
      ok: false,
      status: 409,
      error: `A lesson with slug "${slug}" already exists in this version.`,
    };
  }
  if (!updated) {
    return conflictResult(await loadSyncLessonConflict(lessonId));
  }

  return { ok: true, courseId: lesson.courseId, lesson: updated };
}

export type DeleteSyncLessonResult =
  | { ok: true; courseId: string }
  | { ok: false; status: number; error: string };

/**
 * Deletes a lesson of the version (its comments and asset references cascade) and closes the
 * position gap, exactly like the admin `deleteLessonInlineAction`.
 */
export async function deleteSyncLesson(
  versionId: string,
  lessonId: string
): Promise<DeleteSyncLessonResult> {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, curriculumVersionId: versionId },
    select: { id: true, courseId: true, curriculumVersionId: true, position: true },
  });

  if (!lesson) {
    return { ok: false, status: 404, error: 'Lesson not found in this curriculum version.' };
  }

  await prisma.$transaction((transaction) => deleteLesson(transaction, lesson));

  return { ok: true, courseId: lesson.courseId };
}
