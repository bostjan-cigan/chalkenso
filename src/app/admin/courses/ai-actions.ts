'use server';

import { AiProposalKind, Permission } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { DEFAULT_REVISION_SUMMARY, backgroundAiKey, reviseLesson, type FeedbackItem } from '@/lib/ai';
import { partialTag, writtenShare } from '@/lib/ai-draft-progress';
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
import { startImprovement, workHere, type ImprovementMove } from '@/lib/task-flow';
import { improvementPlaces } from '@/lib/improvement-targets';
import { planBody } from '@/lib/plan-scope';
import { focusSections, lessonSections, sectionSpan, spliceSpan } from '@/lib/lesson-sections';
import { TASK_ENTITY_TYPE } from '@/lib/tasks';
import { serverExtensions } from '@/extensions/server';
import { courseContext } from './ai-context';

export type AiRevisionResult =
  | { ok: true; summary: string; markdown: string }
  | { ok: false; message: string };

// -------------------------------------------------------------------------------------------------
// Revisions of a saved lesson, drafted in the background (src/lib/ai-drafts.ts)
// -------------------------------------------------------------------------------------------------

export type LessonRevisionStart = { ok: true; draft: LessonDraftView; moved: ImprovementMove | null } | { ok: false; message: string };

/**
 * Starts revising a saved lesson in the background and returns at once: the draft is saved as it is
 * written, the page follows it, and it waits on the lesson if the person leaves. Nothing in the
 * lesson changes: the finished draft is reviewed as proposed changes. The text revised is the
 * editor's (possibly unsaved) text. Notes and a task's plan are read here, with the person's rights.
 */
export async function startLessonRevisionAction(input: {
  curriculumVersionId: string;
  lessonId: string;
  title: string;
  markdown: string;
  instruction: string;
  /** Feedback and notes picked for this revision (from the lesson's margin). */
  noteIds?: string[];
  /** An improvement whose plan the revision applies (the lesson's Improvements view). */
  taskId?: string | null;
  /** The lesson's revision the editor's text started from. */
  baseRevision?: number | null;
}): Promise<LessonRevisionStart> {
  const viewer = await requireVersionEdit(input.curriculumVersionId, [Permission.WRITE]);
  const t = await getTranslations('editor.ai');
  const lesson = await prisma.lesson.findFirst({
    where: { id: input.lessonId, curriculumVersionId: input.curriculumVersionId },
    select: { id: true },
  });
  if (!lesson) {
    return { ok: false, message: t('lessonNotFound') };
  }
  if (!input.markdown.trim()) {
    return { ok: false, message: t('writeFirst') };
  }

  // The task's plan, only for a task that changes this lesson and that the person may work on.
  let task: { id: string; title: string; plan: string; lessons: number; notes: string } | null = null;
  if (input.taskId) {
    const ref = await loadTaskRef(input.taskId);
    const places = ref && canWorkOnFeedback(viewer, ref, 'tasks') ? await improvementPlaces(prisma, input.taskId) : null;
    const found = places?.targets.some((target) => target.lessonId === lesson.id)
      ? await prisma.task.findUnique({ where: { id: input.taskId }, select: { id: true, title: true, plan: true, aiNotes: true } })
      : null;
    if (found && planBody(found.plan)) task = { id: found.id, title: found.title, plan: planBody(found.plan), lessons: places?.targets.length ?? 1, notes: found.aiNotes?.trim() ?? '' };
  }

  // The notes, read with the person's own rights; learners are numbered, never named.
  const noteIds = (input.noteIds ?? []).slice(0, 20);
  const comments = noteIds.length
    ? await prisma.curriculumComment.findMany({
        where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { id: { in: noteIds }, lessonId: lesson.id }] },
        orderBy: { createdAt: 'asc' },
        select: { id: true, proposerName: true, selectedText: true, body: true, isInstructorNote: true },
      })
    : [];
  let learner = 0;
  const notes: FeedbackItem[] = comments.map((comment) => ({
    kind: comment.isInstructorNote ? 'instructor' : 'learner',
    author: comment.isInstructorNote ? String(comment.proposerName ?? '').slice(0, 120) : `Learner ${(learner += 1)}`,
    passage: String(comment.selectedText ?? '').slice(0, 2000),
    body: String(comment.body ?? '').slice(0, 4000),
  }));

  // The request as the AI gets it (its words, in English): what was typed, and the task's plan.
  const parts = [input.instruction.trim().slice(0, 4000)];
  if (task) parts.push(`Apply this revision plan (task “${task.title}”):\n\n${task.plan}`);
  // The instructor's own words about the improvement (its notes for AI).
  if (task?.notes) parts.push(`The instructor's notes for this change (follow them where they fit the plan):\n${task.notes.slice(0, 4000)}`);
  // One plan for several lessons (or copies): only its part about this one.
  if (task && task.lessons > 1) parts.push(`The plan covers more than one lesson: change only what it says about this lesson (“${input.title || 'this lesson'}”), and nothing if it says nothing about it.`);
  if (!parts[0] && !task && notes.length) parts.push('Address these notes from class. Keep each change small.');
  const instruction = parts.filter(Boolean).join('\n\n');
  const evidence = await serverExtensions.lessonEvidence(lesson.id);
  if (!instruction && !evidence) {
    return { ok: false, message: t('errors.noRequest') };
  }

  const ai = await backgroundAiKey();
  if (!ai.ok) {
    return { ok: false, message: ai.message };
  }
  const organizationId = (await getCurrentUserSession())?.user.organization?.id;
  if (!organizationId) {
    return { ok: false, message: t('lessonNotFound') };
  }
  const context = await courseContext(input.curriculumVersionId);
  const base = input.markdown;
  // For an improvement, only the sections it is about (its feedback's passages, what its plan
  // names): the AI rewrites that part, which goes back into the lesson around it.
  let span: { start: number; end: number } | null = null;
  let headings: string[] = [];
  if (task) {
    const links = await prisma.taskEntityLink.findMany({
      where: { taskId: task.id, entityType: TASK_ENTITY_TYPE.curriculumComment },
      select: { entityId: true },
    });
    const sources = links.length
      ? await prisma.curriculumComment.findMany({
          where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { lessonId: lesson.id, id: { in: links.map((link) => link.entityId) } }] },
          select: { selectedText: true },
        })
      : [];
    const focus = focusSections(base, { passages: sources.map((source) => source.selectedText ?? ''), plan: task.plan });
    span = sectionSpan(base, focus);
    if (span && span.end - span.start >= base.replace(/\r\n/g, '\n').length) span = null;
    const sections = lessonSections(base);
    headings = focus.map((index) => sections[index]?.heading ?? (input.title || 'Introduction'));
  }
  const piece = span ? base.replace(/\r\n/g, '\n').slice(span.start, span.end) : base;
  const row = await startAppDraft({
    organizationId,
    userId: viewer.id,
    kind: AiProposalKind.LESSON_REVISION,
    targetType: 'lesson',
    targetId: lesson.id,
    taskId: task?.id ?? null,
    baseRevision: input.baseRevision ?? null,
    run: async (progress, signal) => {
      const revision = await reviseLesson(
        {
          courseTitle: context?.courseTitle ?? 'Untitled course',
          courseSummary: context?.courseSummary,
          outline: context?.outline,
          lessonTitle: input.title || 'Untitled lesson',
          markdown: piece,
          instruction,
          evidence,
          notes,
          part: span ? { headings } : null,
        },
        {
          key: ai.key,
          userId: viewer.id,
          signal,
          // The text is rewritten whole (the lesson, or its part): how much is written says how far it is.
          onProgress: (next) =>
            progress(next.stage === 'writing' ? { stage: 'writing', text: '', share: writtenShare(partialTag(next.text, 'lesson'), piece) } : next),
        }
      );
      // Its diagrams cleaned and named apart from the lesson's images and other drafts' (one it
      // can't keep is left out, embed and all).
      const { markdown, diagrams } = cleanDraftDiagrams({
        markdown: span ? spliceSpan(base, span, revision.markdown) : revision.markdown,
        base,
        diagrams: revision.diagrams,
        taken: await openDiagramPaths(lesson.id),
      });
      return {
        payload: {
          markdown,
          base,
          ...(diagrams.length ? { diagrams } : {}),
          why: { instruction: input.instruction.trim().slice(0, 4000), noteIds: comments.map((comment) => comment.id), taskId: task?.id ?? null, planTitle: task?.title ?? null },
        },
        summary: revision.summary === DEFAULT_REVISION_SUMMARY ? null : revision.summary,
      };
    },
  });
  const draft = await lessonDraftView(row, viewer.id);
  if (!draft) return { ok: false, message: (await getTranslations('editor.ai.errors'))('generic') };
  // Revising the lesson for an improvement is the work started, here.
  if (task) await workHere(prisma, [task.id]);
  const moved = task ? await startImprovement(task.id) : null;
  return { ok: true, draft, moved };
}

/** "Discard" on any of a lesson's revisions in its Improve mode (drafted here or by someone's Claude). */
export async function discardLessonDraftAction(draftId: string): Promise<void> {
  const row = await loadLessonRevision(draftId);
  const lesson = row ? await prisma.lesson.findUnique({ where: { id: row.targetId }, select: { curriculumVersionId: true } }) : null;
  if (!lesson) return;
  await requireVersionEdit(lesson.curriculumVersionId, [Permission.WRITE]);
  await discardLessonRevision(draftId);
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

/** How far a lesson revision is (the page polls it while it runs); null once used or discarded. */
export async function lessonRevisionDraftAction(draftId: string): Promise<LessonDraftView | null> {
  const found = await lessonDraftAccess(draftId);
  if (!found) return null;
  const view = await lessonDraftView(found.row, found.viewer.id);
  // The summary is the AI's (in the lesson's language); our stand-in for a missing one is translated.
  return view && !view.summary && view.state === 'ready' ? { ...view, summary: (await getTranslations('editor.ai'))('revisedAsRequested') } : view;
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

