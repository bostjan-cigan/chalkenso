import 'server-only';

import { CurriculumCommentStatus, type Prisma } from '@prisma/client';
import type { DbClient } from './prisma';

/**
 * Lesson changes (`LessonChange`): what a save did when it came from proposed changes or finished
 * an improvement, and the feedback it answers. That feedback is marked done once the revision
 * reaches learners: right away when the save publishes, or at the next publish, whichever way it
 * happens (the workspace, publishing a version, Obsidian). Every publish goes through
 * `lesson-publishing.ts`, which calls `settleLessonChanges`.
 */

/** A change waiting to reach learners, as written at save time. */
export type NewLessonChange = {
  lessonId: string;
  revision: number;
  taskId: string | null;
  proposalIds: string[];
  commentIds: string[];
  applied: number;
  skipped: number;
  createdById: string | null;
  /** What it changed (the changed blocks), for "What changed" later. */
  changes?: Prisma.InputJsonValue;
};

export async function recordLessonChange(db: DbClient, change: NewLessonChange) {
  return db.lessonChange.create({ data: change, select: { id: true } });
}

/**
 * Marks done the feedback of the changes that have reached learners: unsettled changes of these
 * lessons at or below the lesson's published revision. Returns what was settled, with the feedback
 * each one marked done (it may have been done already). Run it in the publishing transaction.
 */
export async function settleLessonChanges(db: DbClient, lessonIds: string[]) {
  if (!lessonIds.length) return [];
  const pending = await db.lessonChange.findMany({
    where: { lessonId: { in: lessonIds }, settledAt: null },
    select: { id: true, lessonId: true, revision: true, commentIds: true, taskId: true },
  });
  if (!pending.length) return [];
  const lessons = await db.lesson.findMany({
    where: { id: { in: Array.from(new Set(pending.map((change) => change.lessonId))) } },
    select: { id: true, publishedRevision: true, publishedAt: true },
  });
  const published = new Map(lessons.map((lesson) => [lesson.id, lesson.publishedAt ? lesson.publishedRevision ?? -1 : -1]));
  const due = pending.filter((change) => (published.get(change.lessonId) ?? -1) >= change.revision);
  const now = new Date();
  const settled: Array<{ id: string; lessonId: string; taskId: string | null; resolvedCommentIds: string[] }> = [];
  for (const change of due) {
    const open = change.commentIds.length
      ? await db.curriculumComment.findMany({
          where: { id: { in: change.commentIds }, lessonId: change.lessonId, status: CurriculumCommentStatus.OPEN },
          select: { id: true },
        })
      : [];
    const resolvedCommentIds = open.map((comment) => comment.id);
    if (resolvedCommentIds.length) {
      await db.curriculumComment.updateMany({
        where: { id: { in: resolvedCommentIds } },
        data: { status: CurriculumCommentStatus.RESOLVED, resolvedAt: now },
      });
    }
    await db.lessonChange.update({ where: { id: change.id }, data: { settledAt: now, resolvedCommentIds } });
    settled.push({ id: change.id, lessonId: change.lessonId, taskId: change.taskId, resolvedCommentIds });
  }
  return settled;
}

/**
 * Undo for a change's bookkeeping (not its text): the feedback it marked done is open again, and
 * the feedback it would still mark done no longer will.
 */
export async function forgetLessonChange(db: DbClient, changeId: string) {
  const change = await db.lessonChange.findUnique({ where: { id: changeId }, select: { resolvedCommentIds: true } });
  if (!change) return;
  if (change.resolvedCommentIds.length) {
    await db.curriculumComment.updateMany({
      where: { id: { in: change.resolvedCommentIds }, status: CurriculumCommentStatus.RESOLVED },
      data: { status: CurriculumCommentStatus.OPEN, resolvedAt: null },
    });
  }
  await db.lessonChange.update({ where: { id: changeId }, data: { commentIds: [], resolvedCommentIds: [], taskId: null } });
}

/** What a save (or "Mark done") did, for the editor's notice and its Undo. */
export type SavedLessonChange = {
  id: string;
  /** The improvement it finished, and its status before (for Undo). */
  task: { id: string; title: string; from: string } | null;
  /** The improvement it belongs to (finished or not), to show what it changed. */
  taskId: string | null;
  /** The feedback marked done now (the save published the change). */
  resolvedCommentIds: string[];
  /** Feedback that will be marked done when the change is published (a draft save). */
  waitsForPublish: boolean;
};

/** A recorded change as the editor reports it. */
export async function savedLessonChange(
  db: DbClient,
  changeId: string,
  task: { taskId: string; title: string; from: string } | null
): Promise<SavedLessonChange | null> {
  const row = await db.lessonChange.findUnique({
    where: { id: changeId },
    select: { settledAt: true, commentIds: true, resolvedCommentIds: true, taskId: true },
  });
  if (!row) return null;
  return {
    id: changeId,
    task: task ? { id: task.taskId, title: task.title, from: task.from } : null,
    taskId: row.taskId,
    resolvedCommentIds: row.resolvedCommentIds,
    waitsForPublish: !row.settledAt && row.commentIds.length > 0,
  };
}
