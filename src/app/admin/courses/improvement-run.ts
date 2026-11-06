import 'server-only';

import { AiProposalKind, AiProposalStatus, CurriculumCommentStatus, type Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { DEFAULT_REVISION_SUMMARY, backgroundAiKey, draftRevisionPlan, reviseLesson, type FeedbackItem } from '@/lib/ai';
import { partialTag } from '@/lib/ai-draft-progress';
import { lessonDraftView, loadLessonRevision, openDiagramPaths, settleDraft, startAppDraft, type LessonDraftView } from '@/lib/ai-drafts';
import { accessScope, canWorkOnFeedback, commentScopeWhere, loadCommentRef, loadTaskRef, type CrmViewer } from '@/lib/crm-access';
import { cleanDraftDiagrams } from '@/lib/draft-diagrams';
import { feedbackSincePlan } from '@/lib/feedback-rounds';
import { improvementPlaces } from '@/lib/improvement-targets';
import { lessonImprovement, takeUpFeedback } from '@/lib/lesson-improvement';
import { focusSections, lessonSections, sectionSpan, spliceSpan } from '@/lib/lesson-sections';
import { parsePlanScope, planBody, withPlanScope } from '@/lib/plan-scope';
import { prisma } from '@/lib/prisma';
import { revisionLive } from '@/lib/revision-progress';
import { startImprovement, workHere, type ImprovementMove } from '@/lib/task-flow';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from '@/lib/tasks';
import { serverExtensions } from '@/extensions/server';
import { courseContext, planContext, type PlanContext } from './ai-context';

/**
 * Revising a saved lesson with AI, in the background (src/lib/ai-drafts.ts): the draft is saved as
 * it is written, the page follows it, and it waits on the lesson if the person leaves. Nothing in
 * the lesson changes: the finished draft is reviewed as proposed changes. For an improvement with no
 * plan yet (or feedback that joined after it), the same run writes the plan first and keeps it on
 * the improvement ("Improve this lesson"). Server-only: every caller has checked the person's
 * rights on the lesson's version (`requireVersionEdit`); the rest is checked here.
 */

export type LessonRevisionStart = { ok: true; draft: LessonDraftView; moved: ImprovementMove | null } | { ok: false; message: string };

export type LessonRevisionInput = {
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
  /** The whole lesson is rewritten, not only the sections the improvement is about. */
  whole?: boolean;
  /**
   * A draft waiting on this lesson to go on from (changes carried from a group's copy, with what
   * didn't fit to place): AI revises its text, the new draft is reviewed against the same lesson and
   * takes its place once finished, and until then it still waits. A turn of the improvement's
   * thread goes on from the attempt the person looks at the same way.
   */
  continues?: string | null;
  /** A turn of the thread: what the person asks of that attempt, in their words ("shorter"). */
  request?: string | null;
  /** That attempt as they kept it: the changes they skipped taken out, their own edits in. */
  from?: string | null;
  /** The changes they skipped in it, for AI to leave out. */
  skipped?: Array<{ section?: unknown; before?: unknown; after?: unknown }> | null;
};

/** The plan to write first, read in the request: what it's drafted from, and the plan it replaces (the save is guarded by it). */
export type PlanFirst = { context: PlanContext; planUpdatedAt: Date | null; scope: ReturnType<typeof parsePlanScope>; isGroup: boolean };

export async function startLessonRevision(viewer: CrmViewer, input: LessonRevisionInput, { planFirst = null }: { planFirst?: PlanFirst | null } = {}): Promise<LessonRevisionStart> {
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
  const earlier = input.continues ? await loadLessonRevision(input.continues) : null;
  // Only an attempt waiting on this lesson, for the same improvement.
  const going =
    earlier && earlier.targetId === lesson.id && earlier.status === AiProposalStatus.OPEN && (earlier.taskId ?? null) === (input.taskId ?? earlier.taskId ?? null)
      ? (earlier.payload as Record<string, unknown> | null)
      : null;
  const request = going ? String(input.request ?? '').trim().slice(0, 1000) : '';
  const from = request && typeof input.from === 'string' && input.from.trim() && input.from.length <= 400_000 ? input.from : null;
  const skipped = request ? cleanSkipped(input.skipped) : [];

  // The improvement, only one that changes this lesson and that the person may work on; its plan
  // (written first, when that's asked for).
  let task: { id: string; title: string; plan: string; lessons: number; notes: string; toCourse: boolean } | null = null;
  if (input.taskId) {
    const ref = await loadTaskRef(input.taskId);
    const places = ref && canWorkOnFeedback(viewer, ref, 'tasks') ? await improvementPlaces(prisma, input.taskId) : null;
    const found = places?.targets.some((target) => target.lessonId === lesson.id)
      ? await prisma.task.findUnique({ where: { id: input.taskId }, select: { id: true, title: true, plan: true, aiNotes: true } })
      : null;
    // A group's change that goes into the main course too: other groups read it there.
    const toCourse = Boolean(places?.groupId && places.courseLessons[lesson.id] && places.scope === 'group and core' && !places.groupOnly && !places.suggestionId);
    if (found && (planBody(found.plan) || planFirst)) {
      task = { id: found.id, title: found.title, plan: planBody(found.plan), lessons: places?.targets.filter((target) => target.copy === 'own').length ?? 1, notes: found.aiNotes?.trim() ?? '', toCourse };
    }
  }
  if (planFirst && !task) {
    return { ok: false, message: t('lessonNotFound') };
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
  const instructionWith = (plan: string) => {
    const parts = [input.instruction.trim().slice(0, 4000)];
    if (task && plan) parts.push(`Apply this revision plan (task “${task.title}”):\n\n${plan}`);
    // The instructor's own words about the improvement (its notes for AI).
    if (task?.notes) parts.push(`The instructor's notes for this change (follow them where they fit the plan):\n${task.notes.slice(0, 4000)}`);
    if (task?.toCourse) parts.push('This change also goes into the main course, which every group reads: keep it free of what only this group needs (its name, dates, people, its own examples).');
    // One plan for several lessons (or copies): only its part about this one.
    if (task && task.lessons > 1) parts.push(`The plan covers more than one lesson: change only what it says about this lesson (“${input.title || 'this lesson'}”), and nothing if it says nothing about it.`);
    if (!parts[0] && !plan && notes.length) parts.push('Address these notes from class. Keep each change small.');
    // A turn of the thread with nothing else to go on: what's asked now is the request.
    if (request && !parts.some(Boolean) && !notes.length) parts.push(request);
    return parts.filter(Boolean).join('\n\n');
  };
  const evidence = await serverExtensions.lessonEvidence(lesson.id);
  if (!planFirst && !instructionWith(task?.plan ?? '') && !evidence) {
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
  const base = from ?? (typeof going?.markdown === 'string' ? going.markdown : input.markdown);
  // The thread so far, for a turn: each earlier attempt's request and what it did, oldest first.
  const conversation = request && earlier ? { turns: await earlierTurns(earlier), skipped, followUp: request } : null;
  // For an improvement, only the sections it is about (its feedback's passages, what its plan
  // names): the AI rewrites that part, which goes back into the lesson around it. A turn of the
  // thread revises the whole draft: what's asked can be about any part of it.
  const focused = Boolean(task && !input.whole && !conversation);
  const passages = focused && task ? await improvementPassages(viewer, task.id, lesson.id) : [];
  const spanWith = (plan: string) => {
    if (!focused) return { span: null, headings: [] as string[] };
    const focus = focusSections(base, { passages, plan });
    let span = sectionSpan(base, focus);
    if (span && span.end - span.start >= base.replace(/\r\n/g, '\n').length) span = null;
    const sections = lessonSections(base);
    return { span, headings: focus.map((index) => sections[index]?.heading ?? (input.title || 'Introduction')) };
  };

  const row = await startAppDraft({
    organizationId,
    userId: viewer.id,
    kind: AiProposalKind.LESSON_REVISION,
    targetType: 'lesson',
    targetId: lesson.id,
    taskId: task?.id ?? null,
    baseRevision: input.baseRevision ?? null,
    request: request || null,
    continuesId: going && earlier ? earlier.id : null,
    run: async (progress, signal) => {
      let plan = task?.plan ?? '';
      if (planFirst && task) {
        // The plan first, shown as it's written, then kept on the improvement (not over a plan
        // the person changed meanwhile).
        progress({ stage: 'planning', text: '' });
        const drafted = await draftRevisionPlan(planFirst.context, {
          key: ai.key,
          userId: viewer.id,
          signal,
          onProgress: (next) => progress({ stage: 'planning', text: next.stage === 'writing' ? partialTag(next.text, 'plan') : '' }),
        });
        plan = planBody(drafted.plan);
        const scope = planFirst.isGroup ? (planFirst.scope ?? drafted.scope) : null;
        await prisma.task.updateMany({
          where: { id: task.id, planUpdatedAt: planFirst.planUpdatedAt },
          data: { plan: withPlanScope(drafted.plan, scope), planUpdatedAt: new Date() },
        });
      }
      const instruction = instructionWith(plan);
      const { span, headings } = spanWith(plan);
      const piece = span ? base.replace(/\r\n/g, '\n').slice(span.start, span.end) : base;
      let answer = '';
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
          conversation,
        },
        {
          key: ai.key,
          userId: viewer.id,
          signal,
          // The text is rewritten whole (the lesson, or its part), in order: which of its sections are
          // written says how far it is. Its text stays here; once it's all there, what follows is checked.
          onProgress: (next) => {
            if (next.stage !== 'writing') return progress(next);
            answer = next.text;
            const live = revisionLive(answer, piece);
            progress(answer.includes('</lesson>') ? { stage: 'finishing', live } : { stage: 'writing', text: '', live });
          },
        }
      );
      progress({ stage: 'finishing', live: revisionLive(answer, piece) });
      // Its diagrams cleaned and named apart from the lesson's images and other drafts' (one it
      // can't keep is left out, embed and all).
      const { markdown, diagrams } = cleanDraftDiagrams({
        markdown: span ? spliceSpan(base, span, revision.markdown) : revision.markdown,
        base,
        diagrams: revision.diagrams,
        taken: await openDiagramPaths(lesson.id),
      });
      // Going on from a waiting draft: reviewed against the same lesson, keeping where its changes
      // came from (and how Undo on the group's copy takes them back). It waits no longer.
      const why = (going?.why ?? {}) as Record<string, unknown>;
      if (going && input.continues) await settleDraft(input.continues, 'discarded');
      return {
        payload: {
          markdown,
          base: typeof going?.base === 'string' ? going.base : base,
          ...(going?.carries ? { carries: going.carries } : {}),
          ...(diagrams.length ? { diagrams } : {}),
          why: {
            ...(why.fromCopy ? { fromCopy: why.fromCopy, check: why.check ?? [], nearby: why.nearby ?? 0 } : {}),
            instruction: input.instruction.trim().slice(0, 4000),
            noteIds: comments.map((comment) => comment.id),
            taskId: task?.id ?? null,
            planTitle: task?.title ?? null,
            ...(skipped.length ? { skipped } : {}),
          },
        } as Prisma.InputJsonValue,
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

/** The passages of an improvement's feedback on a lesson, read with the person's rights: what its focus follows. */
async function improvementPassages(viewer: CrmViewer, taskId: string, lessonId: string) {
  const links = await prisma.taskEntityLink.findMany({
    where: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment },
    select: { entityId: true },
  });
  if (!links.length) return [];
  const sources = await prisma.curriculumComment.findMany({
    where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { lessonId, id: { in: links.map((link) => link.entityId) } }] },
    select: { selectedText: true },
  });
  return sources.map((source) => source.selectedText ?? '');
}

/**
 * "Improve this lesson": the lesson's new feedback joins its improvement (all of it but what the
 * person leaves out), and one run plans it (when there's no plan, or feedback joined since) and
 * drafts the changes. The caller checked `requireVersionEdit` on the lesson's version. Null when
 * there's nothing to improve.
 */
export async function improveLesson(
  viewer: CrmViewer,
  input: {
    curriculumVersionId: string;
    lessonId: string;
    leaveOut?: string[];
    /** A plan to keep (a round's): only the changes are drafted. */
    plan?: string | null;
    /** False: the feedback was taken up already (picked on the Feedback list); the rest stays new. */
    takeUpNew?: boolean;
  }
): Promise<LessonRevisionStart | null> {
  const lesson = await prisma.lesson.findFirst({
    where: { id: input.lessonId, curriculumVersionId: input.curriculumVersionId },
    select: { id: true, title: true, markdownContent: true, revision: true },
  });
  if (!lesson) return null;
  const leaveOut = new Set(input.leaveOut ?? []);
  // The lesson's new feedback (open, used by no improvement yet), each checked for the right to work on it.
  const open = await prisma.curriculumComment.findMany({
    where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { lessonId: lesson.id, status: CurriculumCommentStatus.OPEN }] },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const used = new Set(
    (
      await prisma.taskEntityLink.findMany({
        where: { entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source, entityId: { in: open.map((comment) => comment.id) } },
        select: { entityId: true },
      })
    ).map((link) => link.entityId)
  );
  for (const comment of input.takeUpNew === false ? [] : open) {
    if (used.has(comment.id) || leaveOut.has(comment.id)) continue;
    const ref = await loadCommentRef(comment.id);
    if (!ref || !canWorkOnFeedback(viewer, ref, 'tasks')) continue;
    await takeUpFeedback({ commentId: comment.id, createdById: viewer.id });
  }
  const taskId = await lessonImprovement(prisma, lesson.id);
  const ref = taskId ? await loadTaskRef(taskId) : null;
  if (!taskId || !ref || !canWorkOnFeedback(viewer, ref, 'tasks')) return null;

  // A plan given (a round's): kept as it is, and only the changes are drafted.
  if (typeof input.plan === 'string' && planBody(input.plan)) {
    const current = await prisma.task.findUnique({ where: { id: taskId }, select: { plan: true } });
    await prisma.task.update({ where: { id: taskId }, data: { plan: withPlanScope(input.plan, parsePlanScope(input.plan) ?? parsePlanScope(current?.plan)), planUpdatedAt: new Date() } });
  }
  const [task, links] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { plan: true, planUpdatedAt: true, description: true, aiNotes: true } }),
    prisma.taskEntityLink.findMany({
      where: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
      select: { entityId: true, createdAt: true },
    }),
  ]);
  if (!task) return null;
  const onLesson = await prisma.curriculumComment.findMany({ where: { id: { in: links.map((link) => link.entityId) }, lessonId: lesson.id }, select: { id: true } });
  const noteIds = onLesson.map((comment) => comment.id);
  const sincePlan = feedbackSincePlan(task.plan, task.planUpdatedAt, links.map((link) => ({ id: link.entityId, linkedAt: link.createdAt })));
  // Plan first: none yet, or feedback joined after it (the plan is updated, keeping what still applies).
  let planFirst: PlanFirst | null = null;
  if (!planBody(task.plan) || sincePlan.length) {
    const prepared = await planContext({
      lessonId: lesson.id,
      sourceCommentIds: links.map((link) => link.entityId),
      asked: task.description ?? null,
      notes: task.aiNotes ?? null,
      currentPlan: planBody(task.plan) || null,
      newCommentIds: sincePlan,
    });
    if (!prepared.ok) return { ok: false, message: prepared.message };
    const places = await improvementPlaces(prisma, taskId);
    planFirst = { context: prepared.context, planUpdatedAt: task.planUpdatedAt, scope: parsePlanScope(task.plan), isGroup: Boolean(places?.groupId) };
  }
  return startLessonRevision(
    viewer,
    {
      curriculumVersionId: input.curriculumVersionId,
      lessonId: lesson.id,
      title: lesson.title,
      markdown: lesson.markdownContent,
      instruction: '',
      noteIds,
      taskId,
      baseRevision: lesson.revision,
    },
    { planFirst }
  );
}

/** What the person skipped in the attempt a turn goes on from, capped: at most 20, each side 600 characters, 8,000 in all. */
function cleanSkipped(list: unknown): Array<{ section: string | null; before: string[]; after: string[] }> {
  if (!Array.isArray(list)) return [];
  let room = 8000;
  const out: Array<{ section: string | null; before: string[]; after: string[] }> = [];
  const side = (value: unknown) => {
    const text = (Array.isArray(value) ? value.filter((block): block is string => typeof block === 'string') : []).join('\n\n').slice(0, 600);
    room -= text.length;
    return text ? [text] : [];
  };
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const value = item as { section?: unknown; before?: unknown; after?: unknown };
    const change = { section: typeof value.section === 'string' ? value.section.slice(0, 200) : null, before: side(value.before), after: side(value.after) };
    if (room < 0) break;
    if (change.before.length || change.after.length) out.push(change);
  }
  return out;
}

/** The thread up to an attempt, oldest first (at most 6 turns): what each was asked for, and what it did. */
async function earlierTurns(latest: { id: string; request: string | null; summary: string | null; continuesId: string | null }) {
  const turns: Array<{ request: string; summary: string }> = [];
  let cursor: typeof latest | null = latest;
  const seen = new Set<string>();
  while (cursor && turns.length < 6 && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    turns.unshift({ request: (cursor.request ?? '').slice(0, 1000), summary: (cursor.summary ?? '').slice(0, 400) });
    cursor = cursor.continuesId
      ? await prisma.aiProposal.findFirst({ where: { id: cursor.continuesId, kind: AiProposalKind.LESSON_REVISION }, select: { id: true, request: true, summary: true, continuesId: true } })
      : null;
  }
  return turns;
}
