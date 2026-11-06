'use server';

import { AiProposalKind, AiProposalStatus, Permission, type Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  discardLessonRevision,
  lessonDraftIds,
  lessonDraftView,
  loadDraft,
  loadLessonRevision,
  openDiagramPaths,
  reopenLessonRevision,
  settleDraft,
  startAppDraft,
  type LessonDraftView,
} from '@/lib/ai-drafts';
import { cleanDraftDiagrams } from '@/lib/draft-diagrams';
import { accessScope, canWorkOnFeedback, commentScopeWhere, loadTaskRef, requireVersionEdit, taskScopeWhere } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { finishImprovement, startImprovement, workHere, type ImprovementMove } from '@/lib/task-flow';
import { improvementPlaces } from '@/lib/improvement-targets';
import { planBody } from '@/lib/plan-scope';
import { focusSections, lessonSections, sectionSpan, spliceSpan } from '@/lib/lesson-sections';
import { TASK_ENTITY_TYPE } from '@/lib/tasks';
import { serverExtensions } from '@/extensions/server';
import { improveLesson, startLessonRevision, type LessonRevisionInput, type LessonRevisionStart } from './improvement-run';

export type AiRevisionResult =
  | { ok: true; summary: string; markdown: string }
  | { ok: false; message: string };

// -------------------------------------------------------------------------------------------------
// Revisions of a saved lesson, drafted in the background (improvement-run.ts)
// -------------------------------------------------------------------------------------------------

export type { LessonRevisionStart } from './improvement-run';

/**
 * Starts revising a saved lesson in the background and returns at once (see `startLessonRevision`):
 * the text revised is the editor's (possibly unsaved) text, with the person's rights on its version.
 */
export async function startLessonRevisionAction(input: LessonRevisionInput): Promise<LessonRevisionStart> {
  const viewer = await requireVersionEdit(input.curriculumVersionId, [Permission.WRITE]);
  return startLessonRevision(viewer, input);
}

/**
 * "Improve this lesson": its new feedback joins its improvement (but what the person leaves out),
 * and one run writes the plan (when there's none, or feedback joined since) and drafts the changes.
 */
export async function improveLessonAction(input: { curriculumVersionId: string; lessonId: string; leaveOut?: string[] }): Promise<LessonRevisionStart> {
  const viewer = await requireVersionEdit(input.curriculumVersionId, [Permission.WRITE]);
  const leaveOut = Array.isArray(input.leaveOut) ? input.leaveOut.filter((id): id is string => typeof id === 'string').slice(0, 200) : [];
  const started = await improveLesson(viewer, { curriculumVersionId: input.curriculumVersionId, lessonId: input.lessonId, leaveOut });
  if (started) {
    revalidatePath('/admin/tasks');
    return started;
  }
  return { ok: false, message: (await getTranslations('editor.improvements'))('nothingToImprove') };
}

/**
 * "Discard" on any of a lesson's revisions in its Improve mode (drafted here or by someone's Claude).
 * What a group's Publish left on the main course's lesson ("Leave the rest") may be the improvement's
 * last part: it's done then, with the move for the notice's Undo.
 */
export async function discardLessonDraftAction(draftId: string): Promise<{ moved: ImprovementMove | null }> {
  const row = await loadLessonRevision(draftId);
  const lesson = row ? await prisma.lesson.findUnique({ where: { id: row.targetId }, select: { curriculumVersionId: true } }) : null;
  if (!row || !lesson) return { moved: null };
  const viewer = await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  await discardLessonRevision(draftId);
  const ref = row.taskId ? await loadTaskRef(row.taskId) : null;
  if (!row.taskId || !ref || !canWorkOnFeedback(viewer, ref, 'tasks')) return { moved: null };
  const moved = await finishImprovement(prisma, row.taskId);
  if (moved) {
    revalidatePath('/admin/tasks');
    revalidatePath(`/admin/tasks/${row.taskId}`);
  }
  return { moved };
}

/**
 * "Use this one" in an improvement's thread: an earlier attempt waits for review again, in place of
 * the one waiting now (which stays in the thread, to come back to the same way).
 */
export async function takeUpAttemptAction(attemptId: string): Promise<{ ok: true; draft: LessonDraftView } | { ok: false }> {
  const row = await loadLessonRevision(attemptId);
  const lesson = row ? await prisma.lesson.findUnique({ where: { id: row.targetId }, select: { curriculumVersionId: true } }) : null;
  if (!row || !lesson || !row.taskId) return { ok: false };
  if (row.status !== AiProposalStatus.OPEN && row.status !== AiProposalStatus.DISCARDED) return { ok: false };
  if (typeof (row.payload as { markdown?: unknown } | null)?.markdown !== 'string') return { ok: false };
  const viewer = await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  const ref = await loadTaskRef(row.taskId);
  if (!ref || !canWorkOnFeedback(viewer, ref, 'tasks')) return { ok: false };
  await prisma.$transaction(async (tx) => {
    await tx.aiProposal.updateMany({
      where: { kind: AiProposalKind.LESSON_REVISION, targetId: row.targetId, taskId: row.taskId, status: AiProposalStatus.OPEN, id: { not: row.id } },
      data: { status: AiProposalStatus.DISCARDED, decidedAt: new Date() },
    });
    await tx.aiProposal.update({ where: { id: row.id }, data: { status: AiProposalStatus.OPEN, decidedAt: null } });
  });
  const reopened = await loadLessonRevision(row.id);
  const draft = reopened ? await lessonDraftView(reopened, viewer.id) : null;
  return draft ? { ok: true, draft } : { ok: false };
}

/** Undo for that Discard, for a few minutes. */
export async function reopenLessonDraftAction(draftId: string): Promise<void> {
  const row = await loadLessonRevision(draftId);
  const lesson = row ? await prisma.lesson.findUnique({ where: { id: row.targetId }, select: { curriculumVersionId: true } }) : null;
  if (!lesson) return;
  await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  await reopenLessonRevision(draftId);
}

/** A lesson revision drafted here, and the person's right to edit its lesson; null otherwise. */
async function lessonDraftAccess(draftId: string) {
  const row = await loadDraft(draftId, AiProposalKind.LESSON_REVISION);
  if (!row) return null;
  const lesson = await prisma.lesson.findUnique({ where: { id: row.targetId }, select: { curriculumVersionId: true } });
  if (!lesson) return null;
  const viewer = await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  return { row, viewer };
}

/** "Stop": the revision is no longer wanted, and the AI call stops at its next step. */
export async function stopLessonRevisionAction(draftId: string): Promise<void> {
  if (await lessonDraftAccess(draftId)) await settleDraft(draftId, 'stopped');
}

/**
 * The drafts about a lesson's Improve mode waiting or being written (`lessonDraftIds`): the page asks
 * every few seconds, to bring in what someone's Claude sent meanwhile. Only the improvements about
 * this lesson count.
 */
export async function lessonDraftIdsAction(lessonId: string, taskIds: string[]): Promise<string[]> {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { curriculumVersionId: true } });
  if (!lesson) return [];
  const viewer = await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  // Improvements about the lesson, or about a group's copy of it, that the person may see.
  const copies = taskIds.length ? await prisma.lesson.findMany({ where: { baseLessonId: lessonId }, select: { id: true } }) : [];
  const tasks = taskIds.length
    ? await prisma.task.findMany({
        where: {
          AND: [
            taskScopeWhere(accessScope(viewer, 'tasks')),
            { id: { in: taskIds.slice(0, 100) }, entityLinks: { some: { entityType: TASK_ENTITY_TYPE.lesson, entityId: { in: [lessonId, ...copies.map((copy) => copy.id)] } } } },
          ],
        },
        select: { id: true },
      })
    : [];
  return lessonDraftIds(lessonId, tasks.map((task) => task.id));
}

