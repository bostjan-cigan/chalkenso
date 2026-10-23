'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { Permission } from '@prisma/client';
import { displayName, getCurrentUserSession } from '@/lib/admin-auth';
import { canWorkOnFeedback, instructorNoteContext, loadVersionRef, requireVersionEdit } from '@/lib/crm-access';
import { createInstructorNote } from '@/lib/curriculum-comments';
import { prisma } from '@/lib/prisma';
import { takeUpFeedback } from '@/lib/lesson-improvement';

/**
 * Text selected in a lesson's Edit mode: "Add a note" saves an instructor note on it; "Improve with
 * AI…" saves the same note and uses it in the lesson's improvement (planned with AI in Improve mode next).
 * For whoever edits the lesson and may note it; improving also needs work on its feedback.
 */
export async function noteOnSelectionAction(input: {
  lessonId: string;
  passage: string;
  context: string | null;
  body: string;
  improve: boolean;
}): Promise<{ ok: true; taskId: string | null; commentId: string } | { ok: false; message: string }> {
  const t = await getTranslations('editor.selection');
  const lesson = await prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { curriculumVersionId: true } });
  const versionRef = lesson ? await loadVersionRef(lesson.curriculumVersionId) : null;
  if (!lesson || !versionRef) return { ok: false, message: t('failed') };
  const viewer = await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  const context = await instructorNoteContext(viewer, versionRef, null);
  if (!context.ok) return { ok: false, message: t('notAllowed') };
  const ref = { courseId: versionRef.courseId, groupIds: versionRef.ownerGroupId ? [versionRef.ownerGroupId] : [] };
  if (input.improve && !canWorkOnFeedback(viewer, ref, 'tasks')) return { ok: false, message: t('notAllowed') };
  const session = await getCurrentUserSession();
  const body = input.body.trim() || (input.improve ? t('defaultBody') : '');
  const note = await createInstructorNote({
    userId: viewer.id,
    authorName: session ? displayName(session.user) : '',
    lessonId: input.lessonId,
    selectedText: input.passage,
    context: input.context,
    body,
    groupId: context.groupId,
  });
  if (!note.ok) return { ok: false, message: note.error };
  let taskId: string | null = null;
  if (input.improve) {
    const made = await takeUpFeedback({ commentId: note.comment.id, createdById: viewer.id });
    if (made.ok) taskId = made.taskId;
  }
  revalidatePath('/admin', 'layout');
  return { ok: true, taskId, commentId: note.comment.id };
}

/**
 * "Something else to change" in a lesson's Improve mode (and Insights' Improve): a change nobody wrote
 * feedback about, said in a sentence or two. It's saved as the person's note on the lesson and used
 * in the lesson's improvement, like feedback. For whoever edits the lesson and works on its feedback.
 */
export async function addToImprovementAction(lessonId: string, why: string): Promise<{ ok: true; taskId: string; commentId: string } | { ok: false; message: string }> {
  const t = await getTranslations('editor.improvements');
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { title: true, courseId: true, curriculumVersionId: true },
  });
  const versionRef = lesson ? await loadVersionRef(lesson.curriculumVersionId) : null;
  if (!lesson || !versionRef) return { ok: false, message: t('failed') };
  const viewer = await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  const ref = { courseId: lesson.courseId, groupIds: versionRef.ownerGroupId ? [versionRef.ownerGroupId] : [] };
  if (!canWorkOnFeedback(viewer, ref, 'tasks')) return { ok: false, message: t('readOnly') };
  const body = why.trim();
  if (!body) return { ok: false, message: t('sayWhat') };
  const context = await instructorNoteContext(viewer, versionRef, null);
  if (!context.ok) return { ok: false, message: t('readOnly') };
  const session = await getCurrentUserSession();
  // About the whole lesson: its title is the passage.
  const note = await createInstructorNote({
    userId: viewer.id,
    authorName: session ? displayName(session.user) : '',
    lessonId,
    selectedText: lesson.title,
    body: body.slice(0, 4000),
    groupId: context.groupId,
  });
  if (!note.ok) return { ok: false, message: note.error };
  const used = await takeUpFeedback({ commentId: note.comment.id, createdById: viewer.id });
  if (!used.ok) return { ok: false, message: t('failed') };
  revalidatePath('/admin', 'layout');
  return { ok: true, taskId: used.taskId, commentId: note.comment.id };
}
