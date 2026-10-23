import 'server-only';

import { LessonStatus, Prisma } from '@prisma/client';
import { noteRawWrite, type DbClient } from './prisma';
import { buildAccessPlaceholderHtml } from './lesson-placeholder-html';
import { computeLessonSourceHash, type PublishedAssetBinding } from './lesson-source-hash';
import { settleLessonChanges } from './lesson-changes';
import { serverExtensions } from '@/extensions/server';

export { parsePublishedAssetBindings, type PublishedAssetBinding } from './lesson-source-hash';

/**
 * Lessons have a working copy (what authors edit) and a published snapshot (what learners see).
 * Publishing copies the working copy into the snapshot; saving as a draft leaves the snapshot — and
 * so what learners see — untouched until the lesson is published again.
 */

type Db = DbClient;

/** What a snapshot is taken from: the working copy plus the HTML cached when it was saved. */
const SNAPSHOT_SOURCE_SELECT = {
  id: true,
  title: true,
  shortDescription: true,
  markdownContent: true,
  status: true,
  revision: true,
  accessRenderedHtml: true,
  accessHtmlSourceHash: true,
  assetReferences: {
    orderBy: { position: 'asc' },
    select: { sourcePath: true, assetId: true },
  },
} satisfies Prisma.LessonSelect;

type SnapshotSource = Prisma.LessonGetPayload<{ select: typeof SNAPSHOT_SOURCE_SELECT }>;

/**
 * What publishing one lesson writes. Its HTML comes from the working copy's cache (written on every
 * save, from the same markdown and references) when that is still current. Otherwise it is rendered
 * here, or — with `renderStale: false` — left empty for the lesson page to render on its first
 * visit, so publishing many lessons never waits on the markdown pipeline.
 */
function snapshotOf(lesson: SnapshotSource, { renderStale }: { renderStale: boolean }) {
  const bindings: PublishedAssetBinding[] = lesson.assetReferences.flatMap((reference) =>
    reference.assetId ? [{ sourcePath: reference.sourcePath, assetId: reference.assetId }] : []
  );
  const cacheIsCurrent =
    Boolean(lesson.accessRenderedHtml) &&
    lesson.accessHtmlSourceHash ===
      computeLessonSourceHash(lesson.markdownContent, lesson.assetReferences);
  const renderedHtml = cacheIsCurrent
    ? lesson.accessRenderedHtml
    : renderStale
      ? buildAccessPlaceholderHtml(lesson.markdownContent, bindings)
      : null;

  // Status is part of the content revision: when publishing flips a draft (e.g. publishing the
  // whole version), bump it so sync clients see the change instead of treating the lesson as
  // unchanged. Saves that already set PUBLISHED have bumped it themselves.
  const revision =
    lesson.status === LessonStatus.PUBLISHED ? lesson.revision : lesson.revision + 1;

  return {
    bindings,
    cacheIsCurrent,
    renderedHtml,
    revision,
    htmlSourceHash: renderedHtml ? computeLessonSourceHash(lesson.markdownContent, bindings) : null,
  };
}

/** The update that publishes one lesson (`snapshotOf`). */
function snapshotUpdate(lesson: SnapshotSource, options: { renderStale: boolean }) {
  const snapshot = snapshotOf(lesson, options);
  return {
    where: { id: lesson.id },
    data: {
      status: LessonStatus.PUBLISHED,
      revision: snapshot.revision,
      publishedAt: new Date(),
      publishedRevision: snapshot.revision,
      publishedTitle: lesson.title,
      publishedShortDescription: lesson.shortDescription,
      publishedMarkdownContent: lesson.markdownContent,
      publishedAssetBindings: snapshot.bindings,
      publishedHtmlSourceHash: snapshot.htmlSourceHash,
      publishedRenderedHtml: snapshot.renderedHtml,
    },
  } satisfies Prisma.LessonUpdateArgs;
}

/** The person publishing (their user id), when there is one: the version history says who. */
export type PublishedBy = string | null | undefined;

/**
 * Who published, as the version history keeps it: their id and their name then (copied in, so the
 * history reads the same after they are renamed or leave).
 */
export async function publisherFields(db: Db, userId: PublishedBy): Promise<{ publishedById: string | null; publisherName: string | null }> {
  if (!userId) {
    return { publishedById: null, publisherName: null };
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, identifier: true } });
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.identifier : null;
  return { publishedById: userId, publisherName: name };
}

/**
 * Keeps the text of every published revision (`LessonPublication`), so insights can say what changed
 * and whether it helped, and the version history who published it. Publishing the same revision
 * again keeps the first record.
 */
async function recordPublication(db: Db, update: ReturnType<typeof snapshotUpdate>, publishedBy: PublishedBy) {
  const { data } = update;
  await db.lessonPublication.upsert({
    where: { lessonId_revision: { lessonId: update.where.id, revision: data.revision } },
    create: {
      lessonId: update.where.id,
      revision: data.revision,
      title: data.publishedTitle,
      markdownContent: data.publishedMarkdownContent,
      publishedAt: data.publishedAt,
      ...(await publisherFields(db, publishedBy)),
    },
    update: {},
  });
}

/** Publishes the lesson's current working copy: learners see it from now on. */
export async function publishLessonSnapshot(db: Db, lessonId: string, publishedBy?: PublishedBy) {
  const lesson = await db.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: SNAPSHOT_SOURCE_SELECT,
  });

  const update = snapshotUpdate(lesson, { renderStale: true });
  const updated = await db.lesson.update({ ...update, select: { curriculumVersionId: true } });
  await recordPublication(db, update, publishedBy);
  // Changes that now reach learners: the feedback they answer is done.
  await settleLessonChanges(db, [lessonId]);
  serverExtensions.onLessonsPublished(updated.curriculumVersionId, [lessonId]);
}

/**
 * Publishes every lesson of a version (used when the version itself is published), in a handful of
 * statements whatever its size: one read, one update that copies each working copy into its
 * snapshot inside the database (no lesson text travels back), one for the timestamps and one for the
 * publication records. No markdown is rendered on the way. Run it inside a transaction.
 */
export async function publishVersionLessons(db: Db, versionId: string, publishedBy?: PublishedBy) {
  // Lock the version's lessons first, so what is read below is exactly what gets published: an edit
  // or a sync arriving meanwhile waits for this transaction instead of slipping in between.
  await db.$executeRaw`
    SELECT 1 FROM "courses"."lessons" WHERE "curriculum_version_id" = ${versionId} FOR UPDATE
  `;
  const lessons = await db.lesson.findMany({
    where: { curriculumVersionId: versionId },
    select: SNAPSHOT_SOURCE_SELECT,
  });

  if (lessons.length) {
    const snapshots = lessons.map((lesson) => ({ lesson, ...snapshotOf(lesson, { renderStale: false }) }));
    const rows = snapshots.map(
      (snapshot) =>
        Prisma.sql`(${snapshot.lesson.id}, ${snapshot.revision}::int, ${JSON.stringify(snapshot.bindings)}::jsonb, ${snapshot.cacheIsCurrent}::boolean, ${snapshot.htmlSourceHash}::text)`
    );
    // Raw because each row copies its own columns; the ids come from the scoped read above.
    const published = await db.$executeRaw`
      UPDATE "courses"."lessons" AS lesson
      SET
        "status" = 'PUBLISHED',
        "revision" = snapshot."revision",
        "published_revision" = snapshot."revision",
        "published_title" = lesson."title",
        "published_short_description" = lesson."short_description",
        "published_markdown_content" = lesson."markdown_content",
        "published_asset_bindings" = snapshot."bindings",
        "published_rendered_html" = CASE WHEN snapshot."cache_current" THEN lesson."access_rendered_html" END,
        "published_html_source_hash" = snapshot."html_hash"
      FROM (VALUES ${Prisma.join(rows)}) AS snapshot("id", "revision", "bindings", "cache_current", "html_hash")
      WHERE lesson."id" = snapshot."id"
    `;
    await noteRawWrite(
      'Lesson',
      'updateMany',
      {
        data: { status: true, revision: true, publishedRevision: true, publishedTitle: true, publishedMarkdownContent: true },
        where: { curriculumVersionId: versionId },
      },
      published
    );

    // The timestamps through Prisma, like every other write of them (`updatedAt` comes with it). By
    // id: a lesson added meanwhile has no snapshot and must not look published.
    const publishedAt = new Date();
    await db.lesson.updateMany({
      where: { id: { in: lessons.map((lesson) => lesson.id) } },
      data: { publishedAt },
    });

    // Publishing the same revision again keeps the first record (`recordPublication`).
    const publisher = await publisherFields(db, publishedBy);
    await db.lessonPublication.createMany({
      data: snapshots.map((snapshot) => ({
        lessonId: snapshot.lesson.id,
        revision: snapshot.revision,
        title: snapshot.lesson.title,
        markdownContent: snapshot.lesson.markdownContent,
        publishedAt,
        ...publisher,
      })),
      skipDuplicates: true,
    });
    await settleLessonChanges(db, lessons.map((lesson) => lesson.id));
  }

  serverExtensions.onLessonsPublished(versionId, lessons.map((lesson) => lesson.id));
  return lessons.length;
}

/** Far above any real position: where lessons wait while the ones after a deleted lesson move down. */
const POSITION_SHIFT = 1_000_000;

/**
 * Deletes a lesson (its comments and image references cascade) and closes the gap in the positions
 * after it. The one place lessons are deleted, from the workspace or from Obsidian, so a lesson
 * learners could read is always reported as unpublished. Run it inside a transaction.
 */
export async function deleteLesson(db: Db, lesson: { id: string; curriculumVersionId: string; position: number }) {
  const deleted = await db.lesson.delete({
    where: { id: lesson.id },
    select: { id: true, slug: true, publishedAt: true },
  });

  // Every later lesson moves down one, in two statements whatever their number: up out of the way
  // first, then down past where they were. (version, position) is unique and checked row by row, so
  // a single "minus one" could collide with the next lesson halfway through.
  const after = { curriculumVersionId: lesson.curriculumVersionId, position: { gt: lesson.position } };
  await db.lesson.updateMany({ where: after, data: { position: { increment: POSITION_SHIFT } } });
  await db.lesson.updateMany({ where: after, data: { position: { decrement: POSITION_SHIFT + 1 } } });

  if (deleted.publishedAt) {
    serverExtensions.onLessonsUnpublished(lesson.curriculumVersionId, [{ id: deleted.id, slug: deleted.slug }]);
  }
}

/**
 * Reports a version that went back to draft: the lessons learners read in it are no longer
 * published there. Call it after the version's status changed.
 */
export async function reportVersionUnpublished(db: Db, versionId: string) {
  const lessons = await db.lesson.findMany({
    where: { curriculumVersionId: versionId, publishedAt: { not: null } },
    orderBy: { position: 'asc' },
    select: { id: true, slug: true },
  });
  serverExtensions.onLessonsUnpublished(versionId, lessons);
}

/**
 * Publishes the lesson when it was saved as PUBLISHED (by `publishedBy`); a DRAFT save keeps the old
 * snapshot.
 */
export async function applyLessonStatus(db: Db, lessonId: string, status: LessonStatus, publishedBy?: PublishedBy) {
  if (status === LessonStatus.PUBLISHED) {
    await publishLessonSnapshot(db, lessonId, publishedBy);
  }
}

/** Snapshot columns, for copying a lesson together with what its learners see. */
export const PUBLISHED_SNAPSHOT_SELECT = {
  publishedAt: true,
  publishedRevision: true,
  publishedTitle: true,
  publishedShortDescription: true,
  publishedMarkdownContent: true,
  publishedAssetBindings: true,
  publishedRenderedHtml: true,
  publishedHtmlSourceHash: true,
} as const;

/** Whether learners are looking at an older text than the working copy. */
export function hasUnpublishedChanges(lesson: {
  revision: number;
  publishedAt: Date | null;
  publishedRevision: number | null;
}) {
  return Boolean(lesson.publishedAt) && (lesson.publishedRevision ?? 0) < lesson.revision;
}
