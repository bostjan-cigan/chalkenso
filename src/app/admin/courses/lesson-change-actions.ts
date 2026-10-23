'use server';

import { revalidatePath } from 'next/cache';
import { AiProposalStatus, LessonStatus, Permission, TaskStatus } from '@prisma/client';
import { requireUser } from '@/lib/admin-auth';
import { canWorkOnFeedback, loadTaskRef, requireVersionEdit } from '@/lib/crm-access';
import { forgetLessonChange } from '@/lib/lesson-changes';
import { takeBackNextImprovements } from '@/lib/lesson-improvement';
import { takeBackCarry } from './carry-to-course';
import { publishLessonSnapshot } from '@/lib/lesson-publishing';
import { prisma } from '@/lib/prisma';
import { updateTaskStatus } from '@/lib/tasks';

/**
 * Undo after a save finished something: the improvement goes back to where it was, the feedback
 * the change marked done is open again, a later publish won't mark it done, what it carried to the
 * main course's lesson comes back out of the draft there, feedback it sent on to the next
 * improvement comes back, and the drafts that went in wait for review again (for a few minutes
 * after the save). The lesson's text stays as saved: the Improve view saves the text from
 * before as well.
 */
export async function undoLessonChangeAction(changeId: string, taskFrom: string | null): Promise<void> {
  const change = await prisma.lessonChange.findUnique({
    where: { id: changeId },
    select: { taskId: true, lessonId: true, proposalIds: true, createdAt: true, lesson: { select: { curriculumVersionId: true } } },
  });
  if (!change) return;
  const viewer = await requireVersionEdit(change.lesson.curriculumVersionId, [Permission.WRITE]);
  const from = (Object.values(TaskStatus) as string[]).includes(taskFrom ?? '') ? (taskFrom as TaskStatus) : null;
  const ref = change.taskId ? await loadTaskRef(change.taskId) : null;
  const canWork = Boolean(change.taskId && ref && canWorkOnFeedback(viewer, ref, 'tasks'));
  if (change.taskId && canWork && from) {
    await updateTaskStatus(change.taskId, from, { resolveSources: false });
    revalidatePath('/admin/tasks');
    revalidatePath(`/admin/tasks/${change.taskId}`);
  }
  await forgetLessonChange(prisma, changeId);
  // What the save carried to the main course's lesson comes back out of the draft waiting there.
  if (await takeBackCarry({ changeId, copyLessonId: change.lessonId })) revalidatePath('/admin', 'layout');
  // Feedback the save sent on to the next improvement comes back (finished or not, e.g. waiting for
  // the main course): with the change forgotten, this is the lesson's open improvement again.
  if (change.taskId && canWork) await takeBackNextImprovements(prisma, { taskId: change.taskId, lessonId: change.lessonId, since: change.createdAt });
  if (change.proposalIds.length) {
    await prisma.aiProposal.updateMany({
      where: { id: { in: change.proposalIds }, status: AiProposalStatus.USED, decidedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
      data: { status: AiProposalStatus.OPEN, decidedAt: null },
    });
  }
}

/**
 * "Publish both" in the Improvements list: lessons saved with improvements' changes that learners
 * don't see yet are published (each checked for the right to edit it), which also marks their
 * feedback done. Returns how many were published.
 */
export async function publishLessonsAction(lessonIds: string[]): Promise<number> {
  const user = await requireUser();
  const ids = Array.from(new Set(lessonIds.filter((id) => typeof id === 'string'))).slice(0, 50);
  let published = 0;
  for (const lessonId of ids) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true, curriculumVersionId: true } });
    if (!lesson) continue;
    await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
    await prisma.$transaction(async (tx) => {
      await tx.lesson.update({ where: { id: lessonId }, data: { status: LessonStatus.PUBLISHED } });
      await publishLessonSnapshot(tx, lessonId, user.id);
    });
    published += 1;
    revalidatePath(`/admin/courses/${lesson.courseId}/lessons/${lessonId}`);
  }
  revalidatePath('/admin', 'layout');
  return published;
}
