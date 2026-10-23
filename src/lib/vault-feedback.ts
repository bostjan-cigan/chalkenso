import 'server-only';

import { CurriculumCommentStatus, TaskWorkplace } from '@prisma/client';
import { resolveComment, respondToComment } from './curriculum-comments';
import { isFeedbackUsed, takeUpFeedback } from './lesson-improvement';
import { prisma } from './prisma';
import { startImprovement } from './task-flow';
import { updateTaskPlan } from './tasks';

/**
 * The Obsidian vault's two moves on feedback, the same as the app's: use it (it joins the lesson's
 * improvement, which the vault then plans and finishes) or answer it (a reply, and it's done). The
 * sync routes check the token; these check the feedback belongs to the version it names. Work the
 * vault sends takes the improvement over (it's the vault's, "In Obsidian" in the app, until the
 * app's "Work on it here" takes it back); what's already finished is left alone.
 */

/** The open pieces of feedback among `commentIds` that are on the version (and the lesson, when given). */
async function openFeedbackOf(versionId: string, commentIds: string[], lessonId?: string) {
  if (!commentIds.length) return [];
  const comments = await prisma.curriculumComment.findMany({
    where: {
      id: { in: commentIds },
      curriculumVersionId: versionId,
      status: CurriculumCommentStatus.OPEN,
      ...(lessonId ? { lessonId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return comments.map((comment) => comment.id);
}

/** Uses the open feedback (it joins its lesson's open improvement, started for it when there's none). */
export async function takeUpFromVault(input: { versionId: string; commentIds: string[]; userId: string; lessonId?: string }) {
  const taskIds: string[] = [];
  for (const commentId of await openFeedbackOf(input.versionId, input.commentIds, input.lessonId)) {
    const used = await takeUpFeedback({ commentId, createdById: input.userId });
    if (used.ok && !taskIds.includes(used.taskId)) taskIds.push(used.taskId);
  }
  return taskIds;
}

export type VaultPlanResult = { ok: true; taskId: string } | { ok: false; status: number; error: string };

/**
 * A plan written in the vault for a lesson's open feedback: the feedback joins the lesson's open
 * improvement (or starts one), which gets the plan, is the vault's to work on and is in progress.
 */
export async function planFromVault(input: { versionId: string; lessonId: string; plan: string; commentIds: string[]; userId: string }): Promise<VaultPlanResult> {
  const [taskId] = await takeUpFromVault({ versionId: input.versionId, commentIds: input.commentIds, userId: input.userId, lessonId: input.lessonId });
  if (!taskId) {
    return { ok: false, status: 400, error: 'None of that feedback is open on this lesson.' };
  }
  await prisma.task.update({ where: { id: taskId }, data: { workplace: TaskWorkplace.VAULT } });
  await updateTaskPlan(taskId, input.plan);
  await startImprovement(taskId);
  return { ok: true, taskId };
}

export type VaultAnswerResult = { ok: true; done: boolean; skipped: boolean } | { ok: false; status: number; error: string };

/**
 * Feedback ticked in the vault, with or without a reply: the reply is saved, and feedback no
 * improvement uses is done. Used feedback closes with its improvement; feedback already done is left.
 */
export async function answerFromVault(input: { versionId: string; commentId: string; reply: string }): Promise<VaultAnswerResult> {
  const comment = await prisma.curriculumComment.findUnique({
    where: { id: input.commentId },
    select: { curriculumVersionId: true, status: true },
  });
  if (!comment || comment.curriculumVersionId !== input.versionId) {
    return { ok: false, status: 404, error: 'Feedback not found.' };
  }
  if (comment.status !== CurriculumCommentStatus.OPEN) {
    return { ok: true, done: true, skipped: true };
  }
  if (input.reply.trim()) await respondToComment(input.commentId, input.reply);
  const done = !(await isFeedbackUsed(prisma, input.commentId));
  if (done) await resolveComment(input.commentId);
  return { ok: true, done, skipped: false };
}
