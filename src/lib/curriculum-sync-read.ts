import 'server-only';

import { createHash } from 'node:crypto';

import { LessonStatus, Permission } from '@prisma/client';

import {
  API_TOKEN_FORBIDDEN,
  apiTokenAuthFailure,
  authenticateApiToken,
  bearerTokenFromRequest,
  touchApiToken,
  type ApiTokenAuthFailure,
} from './api-tokens';
import { can, GRANT_ENTITY_TYPES } from './permissions';
import { prisma } from './prisma';

/**
 * The read half of curriculum sync: authorization and the version snapshot.
 *
 * Deliberately separate from `curriculum-sync.ts`. The write helpers there reach the markdown
 * pipeline and the R2 client through `lesson-publishing`, and while the read-only routes
 * (`/api/sync/tasks`, `/api/sync/curriculum`) imported them from the same module, every one of
 * those routes shipped and cold-started `@aws-sdk/client-s3` it never called.
 */

/**
 * Authorizes a curriculum sync request against one curriculum version. Returns the resolved version
 * id on success, or an HTTP status + message the route maps to a JSON error.
 */
export type CurriculumSyncAuth =
  | { ok: true; versionId: string; courseId: string; organizationId: string; tokenId: string; userId: string }
  | (ApiTokenAuthFailure & { reason?: string });

/** 410 `reason` for a closed group curriculum; sync clients remove the folder when they see it. */
export const GROUP_CURRICULUM_CLOSED = 'group_curriculum_closed';

/** Header alternative to the `versionId` query parameter. */
export const CURRICULUM_VERSION_HEADER = 'x-curriculum-version-id';

function requestedVersionId(request: Request): string | null {
  const fromQuery = new URL(request.url).searchParams.get('versionId')?.trim();
  const fromHeader = request.headers.get(CURRICULUM_VERSION_HEADER)?.trim();

  return fromQuery || fromHeader || null;
}

/**
 * Checks the bearer token and requires every permission in `permissions` (e.g. `[READ, TASKS]` for
 * the task list) on the curriculum version the request names. A token acts as its owner, so the
 * version is always explicit (`?versionId=` or `X-Curriculum-Version-Id`); the owner's grants on the
 * version, its course, or `all` count, and super admins may do everything.
 */
export async function authorizeCurriculumSync(
  request: Request,
  permissions: Permission[]
): Promise<CurriculumSyncAuth> {
  const rawToken = bearerTokenFromRequest(request);

  if (!rawToken) {
    return { ok: false, status: 401, error: 'Missing bearer token.' };
  }

  // The token lookup and the version lookup don't depend on each other, so they go together. The
  // checks below still run in the original order, so every failure returns the same status it did
  // when these were sequential.
  const versionId = requestedVersionId(request);
  const [auth, version] = await Promise.all([
    authenticateApiToken(rawToken),
    versionId
      ? prisma.curriculumVersion.findUnique({
          where: { id: versionId },
          select: { id: true, courseId: true, ownerGroupId: true, archivedAt: true },
        })
      : Promise.resolve(null),
  ]);

  if (auth.state !== 'valid') {
    return apiTokenAuthFailure(auth.state);
  }

  if (!versionId) {
    return {
      ok: false,
      status: 400,
      error: 'Name the curriculum version: pass ?versionId=… or the X-Curriculum-Version-Id header.',
    };
  }

  if (!version) {
    return { ok: false, status: 404, error: 'Curriculum version no longer exists.' };
  }

  const resource = {
    type: GRANT_ENTITY_TYPES.CURRICULUM_VERSION,
    versionId: version.id,
    courseId: version.courseId,
    ownerGroupId: version.ownerGroupId,
  } as const;

  if (!can(auth.principal, resource, permissions)) {
    return API_TOKEN_FORBIDDEN;
  }

  // A closed group curriculum stays readable by learners but no longer syncs; clients remove it.
  if (version.archivedAt) {
    return {
      ok: false,
      status: 410,
      error: 'This group’s copy of the lessons is closed.',
      reason: GROUP_CURRICULUM_CLOSED,
    };
  }

  touchApiToken(auth.principal);

  return {
    ok: true,
    versionId: version.id,
    courseId: version.courseId,
    organizationId: auth.principal.organizationId,
    tokenId: auth.principal.tokenId,
    userId: auth.principal.userId,
  };
}

// Deliberately not re-exported from here: `sync-assets` imports the R2 client, and routing it
// through this module pulled `@aws-sdk/client-s3` into every read-only sync route. Import it from
// `@/lib/sync-assets` directly.

export type CurriculumSyncManifestLesson = {
  id: string;
  title: string;
  slug: string;
  arcId: string | null;
  status: LessonStatus;
  position: number;
  shortDescription: string | null;
  updatedAt: string;
  /** Content revision; sent back as `baseRevision` when updating, to detect concurrent edits. */
  revision: number;
  /** For lessons in a group curriculum: the core lesson this copy was made from (null otherwise). */
  baseLessonId: string | null;
};

/** Lesson content, included only when the manifest is requested with `include=content`. */
export type CurriculumSyncLessonContent = {
  arcTitle: string | null;
  markdownContent: string;
  /** Image references that have an uploaded asset, keyed by the exact markdown source path. */
  assets: { sourcePath: string; assetId: string; filename: string }[];
};

export type CurriculumSyncManifest = {
  /**
   * Server time this snapshot was taken. Clients store it and send it back as `?since=` next time;
   * only lessons changed after it carry their body in the response.
   */
  syncedAt: string;
  /** Identifies this exact lesson/arc state; send back as `If-None-Match` to get a 304. */
  etag: string;
  version: {
    id: string;
    label: string;
    version: number;
    status: string;
    course: { id: string; title: string; slug: string };
    /** Set for a group curriculum: the group it belongs to. */
    group: { id: string; name: string } | null;
    /** Set for a group curriculum: the core version it was copied from. */
    baseVersion: { id: string; label: string } | null;
  };
  /**
   * Arcs are authored in the admin UI or created with `POST /api/sync/arcs`; the plugin references
   * them by id when creating lessons.
   */
  arcs: {
    id: string;
    title: string;
    description: string | null;
    position: number;
  }[];
  /** Existing lessons (with their content when requested), so clients can diff against local notes. */
  lessons: (CurriculumSyncManifestLesson & Partial<CurriculumSyncLessonContent>)[];
};

/**
 * Identifies the lesson/arc state a manifest describes, so an unchanged sync can be answered with
 * a 304 instead of the whole snapshot. Built from the light list only — revisions and timestamps
 * already move whenever anything a client cares about changes.
 */
function curriculumManifestEtag(version: {
  id: string;
  arcs: { id: string; position: number; title: string }[];
  lessons: { id: string; revision: number; updatedAt: Date }[];
}) {
  const hash = createHash('sha256');
  hash.update(version.id);
  for (const arc of version.arcs) {
    hash.update(`\x01${arc.id}:${arc.position}:${arc.title}`);
  }
  for (const lesson of version.lessons) {
    hash.update(`\x02${lesson.id}:${lesson.revision}:${lesson.updatedAt.getTime()}`);
  }
  return `"${hash.digest('hex')}"`;
}

/**
 * Full read-side snapshot of a curriculum version: its arcs and lessons. With `includeContent`, each
 * lesson also carries its markdown, arc title and uploaded image references, which is everything a
 * client needs to recreate the notes.
 */
export async function getCurriculumSyncManifest(
  versionId: string,
  {
    includeContent = false,
    since = null,
  }: { includeContent?: boolean; since?: Date | null } = {}
): Promise<CurriculumSyncManifest | null> {
  const version = await prisma.curriculumVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      label: true,
      version: true,
      status: true,
      course: {
        select: { id: true, title: true, slug: true },
      },
      ownerGroup: { select: { id: true, name: true } },
      baseVersion: { select: { id: true, label: true } },
      arcs: {
        orderBy: { position: 'asc' },
        select: { id: true, title: true, description: true, position: true },
      },
      lessons: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          arcId: true,
          status: true,
          position: true,
          shortDescription: true,
          updatedAt: true,
          revision: true,
          baseLessonId: true,
        },
      },
    },
  });

  if (!version) {
    return null;
  }

  const arcTitles = new Map(version.arcs.map((arc) => [arc.id, arc.title]));
  const syncedAt = new Date();

  // Bodies are the expensive part of this response, so they are fetched only for the lessons a
  // client doesn't already have. Without `since` that is every lesson, exactly as before.
  const contentLessonIds = includeContent
    ? version.lessons
        .filter((lesson) => !since || lesson.updatedAt > since)
        .map((lesson) => lesson.id)
    : [];

  const markdownByLesson = new Map<string, string>();
  const assetsByLesson = new Map<string, CurriculumSyncLessonContent['assets']>();

  if (contentLessonIds.length > 0) {
    const [bodies, references] = await Promise.all([
      prisma.lesson.findMany({
        where: { id: { in: contentLessonIds } },
        select: { id: true, markdownContent: true },
      }),
      // One read across the reference table, rather than a nested select that would re-read every
      // lesson row we already have.
      prisma.lessonAssetReference.findMany({
        where: { lessonId: { in: contentLessonIds }, assetId: { not: null } },
        orderBy: { position: 'asc' },
        select: {
          lessonId: true,
          sourcePath: true,
          asset: { select: { id: true, originalFilename: true } },
        },
      }),
    ]);

    for (const body of bodies) {
      markdownByLesson.set(body.id, body.markdownContent);
    }

    for (const reference of references) {
      if (!reference.asset) {
        continue;
      }
      const assets = assetsByLesson.get(reference.lessonId) ?? [];
      // First binding for a given source path wins, as before.
      if (!assets.some((asset) => asset.sourcePath === reference.sourcePath)) {
        assets.push({
          sourcePath: reference.sourcePath,
          assetId: reference.asset.id,
          filename: reference.asset.originalFilename,
        });
      }
      assetsByLesson.set(reference.lessonId, assets);
    }
  }

  return {
    syncedAt: syncedAt.toISOString(),
    etag: curriculumManifestEtag(version),
    version: {
      id: version.id,
      label: version.label,
      version: version.version,
      status: version.status,
      course: version.course,
      group: version.ownerGroup,
      baseVersion: version.baseVersion,
    },
    arcs: version.arcs,
    lessons: version.lessons.map((lesson) => {
      const base: CurriculumSyncManifestLesson = {
        id: lesson.id,
        title: lesson.title,
        slug: lesson.slug,
        arcId: lesson.arcId,
        status: lesson.status,
        position: lesson.position,
        shortDescription: lesson.shortDescription,
        updatedAt: lesson.updatedAt.toISOString(),
        revision: lesson.revision,
        baseLessonId: lesson.baseLessonId,
      };

      const markdownContent = markdownByLesson.get(lesson.id);

      if (markdownContent === undefined) {
        return base;
      }

      return {
        ...base,
        arcTitle: lesson.arcId ? (arcTitles.get(lesson.arcId) ?? null) : null,
        markdownContent,
        assets: assetsByLesson.get(lesson.id) ?? [],
      };
    }),
  };
}

/**
 * Whether `assetId` is referenced by a lesson of the version, i.e. whether a client syncing that
 * version may download it.
 */
export async function isAssetInCurriculumVersion(
  versionId: string,
  assetId: string
): Promise<boolean> {
  const reference = await prisma.lessonAssetReference.findFirst({
    where: { assetId, lesson: { curriculumVersionId: versionId } },
    select: { id: true },
  });

  return Boolean(reference);
}

