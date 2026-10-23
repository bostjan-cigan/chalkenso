import 'server-only';

import { CurriculumCommentStatus, CurriculumVersionStatus, Prisma } from '@prisma/client';
import { PUBLISHED_SNAPSHOT_SELECT } from './lesson-publishing';
import { noteRawWrite, prisma, type DbClient } from './prisma';
import { isUniqueViolation, retryOnUniqueViolation } from './unique-retry';

/**
 * Group curricula: a feedback-driven group gets its own copy of the curriculum (a regular
 * `CurriculumVersion` with `ownerGroupId` + `baseVersionId`, lessons with `baseLessonId`). Because it
 * is an ordinary version, lessons, arcs, access links, comments, tasks, rendering and sync all work
 * on it unchanged; this module only creates, removes and summarizes those copies.
 */

type Transaction = DbClient;

/**
 * Deep-copies a version's arcs and lessons (with asset references and cached render output) into
 * another version of the same course. With `linkToSource`, each copied lesson remembers the lesson
 * it came from (`baseLessonId`). Returns source lesson id → copied lesson id.
 */
export async function copyVersionContent(
  transaction: Transaction,
  input: { sourceVersionId: string; targetVersionId: string; courseId: string; linkToSource: boolean }
): Promise<Map<string, string>> {
  const source = await transaction.curriculumVersion.findFirst({
    where: { id: input.sourceVersionId, courseId: input.courseId },
    select: {
      arcs: {
        orderBy: { position: 'asc' },
        select: { id: true, title: true, description: true, position: true },
      },
      lessons: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          accessHtmlSourceHash: true,
          accessRenderedHtml: true,
          arcId: true,
          markdownContent: true,
          position: true,
          shortDescription: true,
          slug: true,
          status: true,
          title: true,
          revision: true,
          ...PUBLISHED_SNAPSHOT_SELECT,
          assetReferences: {
            orderBy: { position: 'asc' },
            select: { altText: true, assetId: true, position: true, sourcePath: true },
          },
        },
      },
    },
  });

  // Bulk inserts, not one query per row: this runs inside an interactive transaction, and on a
  // remote database a round trip per lesson outlasts its timeout. Arcs and lessons are unique by
  // position within a version, so the new ids are matched back to their source by position.
  const arcs = source?.arcs ?? [];
  const lessons = source?.lessons ?? [];

  // Recreate arcs first so copied lessons can be remapped onto the new arc ids.
  const createdArcs = arcs.length
    ? await transaction.lessonArc.createManyAndReturn({
        data: arcs.map((arc) => ({
          curriculumVersionId: input.targetVersionId,
          title: arc.title,
          description: arc.description,
          position: arc.position,
        })),
        select: { id: true, position: true },
      })
    : [];
  const newArcIdByPosition = new Map(createdArcs.map((arc) => [arc.position, arc.id]));
  const newArcIdBySourceArcId = new Map<string, string>();
  for (const arc of arcs) {
    const newArcId = newArcIdByPosition.get(arc.position);
    if (newArcId) {
      newArcIdBySourceArcId.set(arc.id, newArcId);
    }
  }

  const createdLessons = lessons.length
    ? await transaction.lesson.createManyAndReturn({
        data: lessons.map((lesson) => ({
          accessHtmlSourceHash: lesson.accessHtmlSourceHash,
          accessRenderedHtml: lesson.accessRenderedHtml,
          arcId: lesson.arcId ? (newArcIdBySourceArcId.get(lesson.arcId) ?? null) : null,
          baseLessonId: input.linkToSource ? lesson.id : null,
          courseId: input.courseId,
          curriculumVersionId: input.targetVersionId,
          markdownContent: lesson.markdownContent,
          position: lesson.position,
          shortDescription: lesson.shortDescription,
          slug: lesson.slug,
          status: lesson.status,
          title: lesson.title,
          // What learners of the copy see starts as what learners of the source see.
          publishedAt: lesson.publishedAt,
          // The copy starts at revision 1; keep "has unpublished changes" if the source had them.
          publishedRevision: lesson.publishedAt
            ? lesson.publishedRevision === lesson.revision
              ? 1
              : 0
            : null,
          publishedTitle: lesson.publishedTitle,
          publishedShortDescription: lesson.publishedShortDescription,
          publishedMarkdownContent: lesson.publishedMarkdownContent,
          publishedAssetBindings: lesson.publishedAssetBindings ?? Prisma.JsonNull,
          publishedRenderedHtml: lesson.publishedRenderedHtml,
          publishedHtmlSourceHash: lesson.publishedHtmlSourceHash,
        })),
        select: { id: true, position: true },
      })
    : [];
  const newLessonIdByPosition = new Map(createdLessons.map((lesson) => [lesson.position, lesson.id]));

  const newLessonIdBySourceLessonId = new Map<string, string>();
  const assetReferences: Prisma.LessonAssetReferenceCreateManyInput[] = [];
  for (const lesson of lessons) {
    const newLessonId = newLessonIdByPosition.get(lesson.position);
    if (!newLessonId) {
      continue;
    }
    newLessonIdBySourceLessonId.set(lesson.id, newLessonId);
    for (const reference of lesson.assetReferences) {
      assetReferences.push({
        lessonId: newLessonId,
        altText: reference.altText,
        assetId: reference.assetId,
        position: reference.position,
        sourcePath: reference.sourcePath,
      });
    }
  }

  if (assetReferences.length) {
    await transaction.lessonAssetReference.createMany({ data: assetReferences });
  }

  // The copy's publication history starts with what its learners see from day one.
  const publications: Prisma.LessonPublicationCreateManyInput[] = [];
  for (const lesson of lessons) {
    const newLessonId = newLessonIdBySourceLessonId.get(lesson.id);
    if (newLessonId && lesson.publishedAt && lesson.publishedRevision === lesson.revision) {
      publications.push({
        lessonId: newLessonId,
        revision: 1,
        title: lesson.publishedTitle ?? lesson.title,
        markdownContent: lesson.publishedMarkdownContent ?? lesson.markdownContent,
        publishedAt: lesson.publishedAt,
      });
    }
  }
  if (publications.length) {
    await transaction.lessonPublication.createMany({ data: publications });
  }

  // The course map's corrections to each lesson come along (taught here, used here, only mentioned).
  const overrides = await transaction.lessonConceptOverride.findMany({
    where: { lessonId: { in: Array.from(newLessonIdBySourceLessonId.keys()) } },
    select: { lessonId: true, conceptId: true, role: true, createdById: true },
  });
  if (overrides.length) {
    await transaction.lessonConceptOverride.createMany({
      data: overrides.map((override) => ({ ...override, lessonId: newLessonIdBySourceLessonId.get(override.lessonId)! })),
      skipDuplicates: true,
    });
  }
  // And what was dismissed on its map stays dismissed. Its improvement notes stay with the old
  // version's notes.
  const dismissals = await transaction.courseMapDismissal.findMany({
    where: { lessonId: { in: Array.from(newLessonIdBySourceLessonId.keys()) } },
    select: { lessonId: true, issueKey: true, createdById: true },
  });
  if (dismissals.length) {
    await transaction.courseMapDismissal.createMany({
      data: dismissals.map((dismissal) => ({ ...dismissal, lessonId: newLessonIdBySourceLessonId.get(dismissal.lessonId)! })),
      skipDuplicates: true,
    });
  }

  return newLessonIdBySourceLessonId;
}

/** Where group-scoped comments are found: left through a member link or the group's public link. */
function groupCommentFilter(groupId: string): Prisma.CurriculumCommentWhereInput {
  return {
    OR: [
      { member: { groupId } },
      { accessLink: { groupId } },
      { accessLink: { member: { groupId } } },
    ],
  };
}

/**
 * What happened, as the key of its message in `groups.curriculum` (the group page says it in the
 * viewer's language).
 */
export type GroupCurriculumResult =
  | { ok: true; code: 'enabled' | 'disabled' | 'closed' | 'reopened' }
  | { ok: false; code: 'notFound' | 'alreadyCopied' | 'pickVersion' | 'noCopy' | 'baseGone' | 'hasChanges' };

/**
 * Makes a group feedback-driven: copies its current core version into the group's own curriculum,
 * points the group and all of its access links at the copy (links keep working — nothing is
 * revoked), and moves the group's not-yet-triaged (open) comments onto the copied lessons. Comments
 * already turned into tasks stay with the core, where that work was planned.
 */
export async function enableGroupCurriculum(groupId: string): Promise<GroupCurriculumResult> {
  const group = await prisma.courseGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      courseId: true,
      groupCurriculum: { select: { id: true } },
      curriculumVersion: { select: { id: true, ownerGroupId: true } },
    },
  });

  if (!group) {
    return { ok: false, code: 'notFound' };
  }
  if (group.groupCurriculum) {
    return { ok: false, code: 'alreadyCopied' };
  }
  const baseVersion = group.curriculumVersion;
  if (!baseVersion || baseVersion.ownerGroupId) {
    return { ok: false, code: 'pickVersion' };
  }

  // Read before the transaction: it only needs ids, and the transaction should hold its connection
  // for writes alone.
  const openComments = await prisma.curriculumComment.findMany({
    where: {
      curriculumVersionId: baseVersion.id,
      status: CurriculumCommentStatus.OPEN,
      ...groupCommentFilter(group.id),
    },
    select: { id: true },
  });

  try {
    // Two copies made at the same moment can take the same negative ordinal: the loser takes the next.
    await retryOnUniqueViolation(
      () =>
        prisma.$transaction(
          async (transaction) => {
            // Group curricula take negative ordinals so the core numbering stays contiguous.
            const lowest = await transaction.curriculumVersion.findFirst({
              where: { courseId: group.courseId, version: { lt: 0 } },
              orderBy: { version: 'asc' },
              select: { version: true },
            });
            const now = new Date();

            const fork = await transaction.curriculumVersion.create({
              data: {
                courseId: group.courseId,
                label: group.name,
                version: (lowest?.version ?? 0) - 1,
                status: CurriculumVersionStatus.PUBLISHED,
                publishedAt: now,
                ownerGroupId: group.id,
                baseVersionId: baseVersion.id,
              },
              select: { id: true },
            });

            await copyVersionContent(transaction, {
              sourceVersionId: baseVersion.id,
              targetVersionId: fork.id,
              courseId: group.courseId,
              linkToSource: true,
            });

            await transaction.courseGroup.update({
              where: { id: group.id },
              data: { feedbackDriven: true, curriculumVersionId: fork.id },
            });

            await transaction.accessLink.updateMany({
              where: {
                curriculumVersionId: baseVersion.id,
                OR: [{ groupId: group.id }, { member: { groupId: group.id } }],
              },
              data: { curriculumVersionId: fork.id },
            });

            // Each open comment moves to the copy of its lesson, all in one statement (the copied
            // lesson remembers its source in `base_lesson_id`). Ids come from the scoped read above.
            if (openComments.length) {
              const moved = await transaction.$executeRaw`
                UPDATE "courses"."curriculum_comments" AS moved
                SET
                  "curriculum_version_id" = ${fork.id},
                  "lesson_id" = copied."id",
                  "updated_at" = CURRENT_TIMESTAMP
                FROM "courses"."lessons" AS copied
                WHERE moved."id" IN (${Prisma.join(openComments.map((openComment) => openComment.id))})
                  AND moved."curriculum_version_id" = ${baseVersion.id}
                  AND moved."status" = 'OPEN'
                  AND copied."curriculum_version_id" = ${fork.id}
                  AND copied."base_lesson_id" = moved."lesson_id"
              `;
              await noteRawWrite(
                'CurriculumComment',
                'updateMany',
                { data: { curriculumVersionId: true, lessonId: true }, where: { curriculumVersionId: baseVersion.id } },
                moved
              );
            }
          },
          { timeout: 30_000 }
        ),
      { fields: ['version'] }
    );
  } catch (error) {
    // Someone else made the group's copy a moment before (one copy per group).
    if (isUniqueViolation(error, ['ownerGroupId'])) {
      return { ok: false, code: 'alreadyCopied' };
    }
    throw error;
  }

  return { ok: true, code: 'enabled' };
}

export type GroupCurriculumChanges = {
  /** Copied lessons whose title or text now differs from their core lesson. */
  changed: number;
  /** Lessons that exist only in the group curriculum. */
  added: number;
  /** Core lessons (present when the copy was made) that the group curriculum no longer has. */
  removed: number;
  /** Changed or added lessons, for listing. */
  lessons: { id: string; title: string; position: number; change: 'changed' | 'added' }[];
};

const NO_CHANGES: GroupCurriculumChanges = { changed: 0, added: 0, removed: 0, lessons: [] };

/** How a group curriculum differs from the core version it was copied from. */
export async function getGroupCurriculumChanges(
  forkVersionId: string
): Promise<GroupCurriculumChanges> {
  return (await getGroupCurriculumChangesByFork([forkVersionId])).get(forkVersionId) ?? NO_CHANGES;
}

/**
 * `getGroupCurriculumChanges` for many group curricula at once, in two queries whatever their
 * number. The texts are compared in the database, so no lesson's markdown is loaded to do it.
 */
export async function getGroupCurriculumChangesByFork(
  forkVersionIds: string[]
): Promise<Map<string, GroupCurriculumChanges>> {
  const result = new Map<string, GroupCurriculumChanges>();
  if (!forkVersionIds.length) {
    return result;
  }
  // Through the scoped client first: the queries below are raw (unscoped), so they only ever see
  // versions this request may see.
  const forks = await prisma.curriculumVersion.findMany({
    where: { id: { in: forkVersionIds } },
    select: { id: true },
  });
  if (!forks.length) {
    return result;
  }
  const ids = Prisma.join(forks.map((fork) => fork.id));

  const [lessonChanges, removedCounts] = await Promise.all([
    // Copied lessons whose title or text now differs from their core lesson, and lessons added to
    // the copy (no core lesson in the version it was copied from).
    prisma.$queryRaw<Array<{ forkId: string; id: string; title: string; position: number; added: boolean }>>`
      SELECT
        lesson."curriculum_version_id" AS "forkId",
        lesson."id",
        lesson."title",
        lesson."position",
        (base."id" IS NULL) AS "added"
      FROM "courses"."lessons" AS lesson
      JOIN "courses"."curriculum_versions" AS fork ON fork."id" = lesson."curriculum_version_id"
      LEFT JOIN "courses"."lessons" AS base
        ON base."id" = lesson."base_lesson_id"
        AND base."curriculum_version_id" = fork."base_version_id"
      WHERE lesson."curriculum_version_id" IN (${ids})
        AND (
          base."id" IS NULL
          OR base."title" <> lesson."title"
          OR base."markdown_content" <> lesson."markdown_content"
        )
      ORDER BY lesson."position" ASC
    `,
    // Core lessons that existed when the copy was made and that no copied lesson comes from.
    prisma.$queryRaw<Array<{ forkId: string; removed: number }>>`
      SELECT fork."id" AS "forkId", COUNT(base."id")::int AS "removed"
      FROM "courses"."curriculum_versions" AS fork
      JOIN "courses"."lessons" AS base
        ON base."curriculum_version_id" = fork."base_version_id"
        AND base."created_at" <= fork."created_at"
      WHERE fork."id" IN (${ids})
        AND NOT EXISTS (
          SELECT 1
          FROM "courses"."lessons" AS lesson
          WHERE lesson."curriculum_version_id" = fork."id"
            AND lesson."base_lesson_id" = base."id"
        )
      GROUP BY fork."id"
    `,
  ]);

  const removedByFork = new Map(removedCounts.map((row) => [row.forkId, row.removed]));
  for (const fork of forks) {
    const lessons: GroupCurriculumChanges['lessons'] = lessonChanges
      .filter((lesson) => lesson.forkId === fork.id)
      .map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
        change: lesson.added ? ('added' as const) : ('changed' as const),
      }));
    result.set(fork.id, {
      changed: lessons.filter((lesson) => lesson.change === 'changed').length,
      added: lessons.filter((lesson) => lesson.change === 'added').length,
      removed: removedByFork.get(fork.id) ?? 0,
      lessons,
    });
  }
  return result;
}

/**
 * Undoes `enableGroupCurriculum` while the copy is still untouched: moves links and comments back
 * to the core version, deletes the copy and clears the flag. Once the group curriculum has been
 * edited (or has tasks), it is closed instead, so no group work is ever thrown away.
 */
export async function disableGroupCurriculum(groupId: string): Promise<GroupCurriculumResult> {
  const group = await prisma.courseGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      groupCurriculum: {
        select: {
          id: true,
          baseVersionId: true,
          lessons: { select: { id: true, revision: true, baseLessonId: true } },
        },
      },
    },
  });

  const fork = group?.groupCurriculum;
  if (!group || !fork) {
    return { ok: false, code: 'noCopy' };
  }
  if (!fork.baseVersionId) {
    return { ok: false, code: 'baseGone' };
  }

  const [changes, linkedTasks, baseLessons] = await Promise.all([
    getGroupCurriculumChanges(fork.id),
    prisma.taskEntityLink.count({
      where: { entityType: 'curriculum_version', entityId: fork.id },
    }),
    prisma.lesson.findMany({
      where: { curriculumVersionId: fork.baseVersionId },
      select: { id: true },
    }),
  ]);
  const baseLessonIds = new Set(baseLessons.map((lesson) => lesson.id));
  const untouched =
    changes.changed + changes.added + changes.removed === 0 &&
    fork.lessons.every(
      (lesson) =>
        lesson.revision === 1 && lesson.baseLessonId && baseLessonIds.has(lesson.baseLessonId)
    );

  if (!untouched || linkedTasks > 0) {
    return { ok: false, code: 'hasChanges' };
  }

  const baseVersionId = fork.baseVersionId;

  await prisma.$transaction(async (transaction) => {
    // Every comment goes back to the core lesson its copied lesson came from, in one statement
    // (`untouched` above guarantees each copied lesson has one).
    const moved = await transaction.$executeRaw`
      UPDATE "courses"."curriculum_comments" AS moved
      SET
        "curriculum_version_id" = ${baseVersionId},
        "lesson_id" = copied."base_lesson_id",
        "updated_at" = CURRENT_TIMESTAMP
      FROM "courses"."lessons" AS copied
      WHERE moved."curriculum_version_id" = ${fork.id}
        AND copied."id" = moved."lesson_id"
        AND copied."base_lesson_id" IS NOT NULL
    `;
    await noteRawWrite(
      'CurriculumComment',
      'updateMany',
      { data: { curriculumVersionId: true, lessonId: true }, where: { curriculumVersionId: fork.id } },
      moved
    );

    await transaction.accessLink.updateMany({
      where: { curriculumVersionId: fork.id },
      data: { curriculumVersionId: baseVersionId },
    });

    await transaction.courseGroup.update({
      where: { id: group.id },
      data: { feedbackDriven: false, curriculumVersionId: baseVersionId },
    });

    await transaction.curriculumVersion.delete({ where: { id: fork.id } });
  });

  return { ok: true, code: 'disabled' };
}

/**
 * Closes (group finished) or reopens a group curriculum. Closed copies stay readable for learners
 * and in the CRM, but stop syncing, so Obsidian removes the group's folder.
 */
export async function setGroupCurriculumClosed(
  groupId: string,
  closed: boolean
): Promise<GroupCurriculumResult> {
  const result = await prisma.curriculumVersion.updateMany({
    where: { ownerGroupId: groupId },
    data: { archivedAt: closed ? new Date() : null },
  });

  if (result.count === 0) {
    return { ok: false, code: 'noCopy' };
  }

  return { ok: true, code: closed ? 'closed' : 'reopened' };
}
