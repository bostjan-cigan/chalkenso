import 'server-only';

import { TaskStatus, TaskWorkplace } from '@prisma/client';
import { improvementPlaces } from './improvement-targets';
import { prisma, type DbClient } from './prisma';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from './tasks';

/**
 * Improvements (tasks) move along by themselves as the work happens, each move shown with Undo:
 * To do → In progress when the work starts (a plan saved or drafted, a revision started for it), and
 * → Done when the approved changes are saved for every lesson it changes. Never by themselves:
 * Ignored, back to To do, or out of Done. Done this way, the feedback it came from is marked done
 * when the change reaches learners (`lesson-changes.ts`), not before.
 */

/** A move an improvement made by itself: for the notice, and for its Undo. */
export type ImprovementMove = { taskId: string; title: string; from: TaskStatus; to: TaskStatus };

/** The work on an improvement started: To do → In progress (once; any other status stays). */
export async function startImprovement(taskId: string): Promise<ImprovementMove | null> {
  const { count } = await prisma.task.updateMany({
    where: { id: taskId, status: TaskStatus.TODO },
    data: { status: TaskStatus.IN_PROGRESS, completedAt: null },
  });
  if (!count) return null;
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
  return { taskId, title: task?.title ?? '', from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS };
}

/**
 * Work on these improvements started in the app (a plan, a draft, changes saved): they're worked on
 * here, so the Obsidian vault shows them read-only. Only where nobody chose yet; the vault chooses
 * itself when it sends a plan, a tick or the agent's flag.
 */
export async function workHere(db: DbClient, taskIds: string[]) {
  const ids = taskIds.filter(Boolean);
  if (!ids.length) return;
  await db.task.updateMany({ where: { id: { in: ids }, workplace: null }, data: { workplace: TaskWorkplace.APP } });
}

/** The lessons an improvement changes: its own, and the main course's when its plan says so. */
export async function improvementLessons(db: DbClient, taskId: string) {
  return ((await improvementPlaces(db, taskId))?.targets ?? []).map((target) => target.lessonId);
}

/** The feedback an improvement uses on one lesson, with when each joined it. */
export async function improvementFeedbackLinks(db: DbClient, taskId: string, lessonId: string) {
  const links = await db.taskEntityLink.findMany({
    where: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
    select: { entityId: true, createdAt: true },
  });
  if (!links.length) return [];
  const comments = await db.curriculumComment.findMany({
    where: { id: { in: links.map((link) => link.entityId) }, lessonId },
    select: { id: true },
  });
  return links.filter((link) => comments.some((comment) => comment.id === link.entityId)).map((link) => ({ id: link.entityId, linkedAt: link.createdAt }));
}

/**
 * The approved changes are saved: done, when every lesson the improvement changes (its own, and
 * the main course's when its plan says so) has a saved change for it. Run inside the save's
 * transaction. Null when nothing moved.
 */
export async function finishImprovement(db: DbClient, taskId: string): Promise<ImprovementMove | null> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { status: true, title: true } });
  if (!task || task.status === TaskStatus.DONE || task.status === TaskStatus.IGNORED) return null;
  const lessons = await improvementLessons(db, taskId);
  if (!lessons.length) return null;
  const changed = await db.lessonChange.findMany({
    where: { taskId, lessonId: { in: lessons } },
    select: { lessonId: true },
    distinct: ['lessonId'],
  });
  if (changed.length < lessons.length) return null;
  await db.task.update({ where: { id: taskId }, data: { status: TaskStatus.DONE, completedAt: new Date() } });
  return { taskId, title: task.title, from: task.status, to: TaskStatus.DONE };
}
