'use server';

import { Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { canEditVersion, canWorkOnFeedback, loadCommentRef, loadVersionRef, requireCommentWork, requireCrmAccess } from '@/lib/crm-access';
import { deleteComment, reopenComment, resolveComment, respondToComment } from '@/lib/curriculum-comments';
import { isFeedbackUsed, stopUsingFeedback, takeUpFeedback } from '@/lib/lesson-improvement';
import { prisma } from '@/lib/prisma';
import { improveLesson } from '../improvement-run';

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

/** At most this many notes in one bulk action, and lessons drafted at once. */
const BULK_NOTES = 100;
const BULK_LESSONS = 10;

const idList = (ids: unknown) =>
  Array.from(new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()) : [])).slice(0, BULK_NOTES);

/**
 * "Leave out": these notes get the person's reply (required: whoever gave the feedback hears why)
 * and are done. One used in an improvement comes out of it first; one a saved change already
 * answers is left (it's done when the change reaches learners). Each is checked for the right to
 * work on it; the others are counted as skipped.
 */
export async function leaveOutFeedbackAction(commentIds: string[], reply: string): Promise<{ ok: true; left: number; skipped: number } | { ok: false; error: string }> {
  const text = String(reply ?? '').trim();
  const t = await getTranslations('courses.actions');
  if (!text) return { ok: false, error: t('replyRequired') };
  const viewer = await requireCrmAccess(() => true);
  let left = 0;
  let skipped = 0;
  for (const id of idList(commentIds)) {
    const ref = await loadCommentRef(id);
    if (!ref || !canWorkOnFeedback(viewer, ref, 'comments')) {
      skipped += 1;
      continue;
    }
    if ((await isFeedbackUsed(prisma, id)) && !(await stopUsingFeedback(id))) {
      skipped += 1;
      continue;
    }
    await respondToComment(id, text);
    await resolveComment(id);
    left += 1;
  }
  refreshFeedback();
  return { ok: true, left, skipped };
}

/**
 * "Fix with AI" on notes picked on the Feedback list: each joins its lesson's improvement, and each
 * lesson's plan and changes are drafted in one background run (up to ten lessons at once; the rest
 * are left planned to start later). Returns the lessons, in lesson order, to review one after another.
 */
export async function fixWithAiAction(commentIds: string[], { draft = true }: { draft?: boolean } = {}): Promise<
  | { ok: true; lessons: Array<{ lessonId: string; href: string; state: 'drafting' | 'waiting' | 'skipped' }>; skipped: number }
  | { ok: false; error: string }
> {
  const t = await getTranslations('courses.actions');
  const viewer = await requireCrmAccess(() => true);
  const ids = idList(commentIds);
  if (!ids.length) return { ok: false, error: t('noFeedbackPicked') };
  let skipped = 0;
  const lessonIds = new Set<string>();
  for (const id of ids) {
    const ref = await loadCommentRef(id);
    if (!ref || !canWorkOnFeedback(viewer, ref, 'comments')) {
      skipped += 1;
      continue;
    }
    const taken = await takeUpFeedback({ commentId: id, createdById: viewer.id });
    if (!taken.ok) {
      skipped += 1;
      continue;
    }
    const comment = await prisma.curriculumComment.findUnique({ where: { id }, select: { lessonId: true } });
    if (comment) lessonIds.add(comment.lessonId);
  }
  const lessons = await prisma.lesson.findMany({
    where: { id: { in: Array.from(lessonIds) } },
    orderBy: [{ curriculumVersionId: 'asc' }, { position: 'asc' }],
    select: { id: true, courseId: true, curriculumVersionId: true },
  });
  const out: Array<{ lessonId: string; href: string; state: 'drafting' | 'waiting' | 'skipped' }> = [];
  let started = 0;
  for (const lesson of lessons) {
    const href = `/admin/courses/${lesson.courseId}/lessons/${lesson.id}/improvements`;
    const versionRef = await loadVersionRef(lesson.curriculumVersionId);
    if (!versionRef || !canEditVersion(viewer, versionRef, [Permission.WRITE])) {
      out.push({ lessonId: lesson.id, href, state: 'skipped' });
      continue;
    }
    // Without AI the notes are only taken up: each lesson's improvement is planned there by hand.
    if (!draft || started >= BULK_LESSONS) {
      out.push({ lessonId: lesson.id, href, state: 'waiting' });
      continue;
    }
    const run = await improveLesson(viewer, { curriculumVersionId: lesson.curriculumVersionId, lessonId: lesson.id, takeUpNew: false });
    if (run?.ok) started += 1;
    out.push({ lessonId: lesson.id, href, state: run?.ok ? 'drafting' : 'waiting' });
  }
  refreshFeedback();
  return { ok: true, lessons: out, skipped };
}
