'use server';

import { Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireCommentWork } from '@/lib/crm-access';
import { deleteComment, reopenComment, resolveComment, respondToComment } from '@/lib/curriculum-comments';
import { isFeedbackUsed, stopUsingFeedback, takeUpFeedback } from '@/lib/lesson-improvement';
import { prisma } from '@/lib/prisma';

function getValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

/** Feedback shows on groups, courses, lessons, Home and the task board: refresh them all. */
function refreshFeedback() {
  revalidatePath('/admin', 'layout');
}

/**
 * Save an admin reply on a comment (visible to the commenter on their lesson). A reply to feedback
 * that isn't used in an improvement is its answer: it's marked done (`done`). Used feedback stays
 * open until its change reaches learners.
 */
export async function respondToCommentAction(commentId: string, response: string): Promise<{ done: boolean }> {
  const id = commentId.trim();
  if (!id) {
    return { done: false };
  }

  await requireCommentWork(id);

  await respondToComment(id, response.trim());
  const done = Boolean(response.trim()) && !(await isFeedbackUsed(prisma, id));
  if (done) await resolveComment(id);
  refreshFeedback();
  return { done };
}

/** Mark a comment done (resolved), with or without a task. */
export async function resolveCommentAction(formData: FormData) {
  const commentId = getValue(formData, 'commentId');
  if (!commentId) {
    return;
  }

  await requireCommentWork(commentId);
  await resolveComment(commentId);
  refreshFeedback();
}

/** Open a done comment again. */
export async function reopenCommentAction(formData: FormData) {
  const commentId = getValue(formData, 'commentId');
  if (!commentId) {
    return;
  }

  await requireCommentWork(commentId);
  await reopenComment(commentId);
  refreshFeedback();
}

/** Permanently delete any comment (admin-only; unlike the reader delete, not scoped to a link). */
export async function deleteCommentAction(formData: FormData) {
  const commentId = getValue(formData, 'commentId');
  if (!commentId) {
    return;
  }

  await requireCommentWork(commentId, [Permission.DELETE]);
  await deleteComment(commentId);
  refreshFeedback();
}

/**
 * "Use": the feedback joins its lesson's one open improvement (started for it when there's none),
 * whose plan, AI draft and save cover all the feedback used there. The person stays where they are;
 * the improvement's id comes back for a link, and whether its changes are drafted already (then this
 * one waits for the next draft). The feedback stays open until the change reaches learners.
 */
export async function takeUpFeedbackAction(
  commentId: string
): Promise<{ ok: true; taskId: string; created: boolean; afterDraft: boolean } | { ok: false; error: string }> {
  const id = commentId.trim();
  const t = await getTranslations('courses.actions');
  if (!id) {
    return { ok: false, error: t('noFeedbackPicked') };
  }
  // Working on the feedback (its course or group, with Feedback & tasks on); the improvement inherits both.
  const user = await requireCommentWork(id);
  const result = await takeUpFeedback({ commentId: id, createdById: user.id });
  refreshFeedback();
  // Its only refusal: the feedback is gone.
  if (!result.ok) {
    return { ok: false, error: t('commentNotFound') };
  }
  return result;
}

/** "Don't use": the feedback leaves its lesson's open improvement and waits to be decided again. */
export async function stopUsingFeedbackAction(commentId: string): Promise<{ ok: boolean }> {
  await requireCommentWork(commentId);
  const result = await stopUsingFeedback(commentId);
  refreshFeedback();
  return { ok: Boolean(result) };
}
