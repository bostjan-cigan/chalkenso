import 'server-only';

import { AiProposalKind, AiProposalStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { proposeChanges } from '@/app/admin/courses/components/workspace/revision';
import { stillWorking } from '@/lib/ai-draft-progress';
import { currentDraft, isEmptyCarriedDraft } from '@/lib/ai-drafts';
import { improvementPlacesFor } from '@/lib/improvement-targets';
import { planBody } from '@/lib/plan-scope';
import { prisma } from '@/lib/prisma';
import { deriveRevisionPath, type PathAction, type PathStep, type PathTarget, type StepState } from '@/lib/revision-path';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from '@/lib/tasks';

/** One step as the bar shows it. */
export type PathStepView = { step: PathStep; state: StepState; label: string; detail: string | null };

/** An improvement's path, with its words and links, for `RevisionPathBar`. */
export type RevisionPathView = {
  taskId: string;
  title: string;
  steps: PathStepView[];
  /** The one thing to do next: a link, or a state with nothing to click ("Writing changes…"). */
  next: { label: string; href: string | null } | null;
  finished: boolean;
  /** Its lessons saved with its changes that learners don't see yet (for "Publish all"). */
  unpublishedLessonIds: string[];
  /** Each lesson it changes (several lessons, or a group's copy and the main course), and where each is. */
  targets: Array<{
    lessonId: string;
    label: string;
    state: string;
    href: string | null;
    done: boolean;
    /** Where the lesson is, for lists that summarise by lesson: still to change, AI writing, changes to review, saved as a draft, or learners see it. */
    phase: 'toChange' | 'writing' | 'review' | 'saved' | 'live';
    /** Changes to review, when its draft is ready. */
    toReview: number;
    /** The lesson alone ("Lesson 4 · Docker volumes"), and the group whose copy it is (null: the main course's). */
    lessonLabel: string;
    copyOf: string | null;
    /** The main course's lesson, changed for a group's improvement whose plan says so. */
    course: boolean;
  }>;
};

type TaskFacts = { id: string; title: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'IGNORED'; plan: string | null };

/**
 * An improvement's path, read from what is saved: its plan and plan draft, and for each lesson it
 * changes, the drafts made for it, the change saved for it, and what learners see. Read with the
 * caller's rights (the database is scoped to the organisation; callers have checked the task).
 */
export async function loadRevisionPath(taskId: string, aiEnabled: boolean): Promise<RevisionPathView | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, title: true, status: true, plan: true } });
  if (!task) return null;
  return (await revisionPathsFor([task], aiEnabled)).get(taskId) ?? null;
}

/** The paths of several improvements at once (the Improvements list), in a fixed number of queries. */
export async function revisionPathsFor(tasks: TaskFacts[], aiEnabled: boolean): Promise<Map<string, RevisionPathView>> {
  const ids = tasks.map((task) => task.id);
  if (!ids.length) return new Map();
  const [t, places, sources, changes, planDrafts] = await Promise.all([
    getTranslations('tasks.path'),
    improvementPlacesFor(prisma, ids),
    prisma.taskEntityLink.groupBy({
      by: ['taskId'],
      where: { taskId: { in: ids }, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
      _count: { _all: true },
    }),
    prisma.lessonChange.findMany({
      where: { taskId: { in: ids } },
      orderBy: { revision: 'desc' },
      select: { taskId: true, lessonId: true, revision: true },
    }),
    Promise.all(ids.map(async (id) => [id, await currentDraft(AiProposalKind.TASK_PLAN, id)] as const)),
  ]);
  const lessonIds = Array.from(new Set(Array.from(places.values()).flatMap((place) => place.targets.map((target) => target.lessonId))));
  const groupIds = Array.from(new Set(Array.from(places.values()).flatMap((place) => (place.groupId ? [place.groupId] : []))));
  const [lessons, drafts, groups] = await Promise.all([
    prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      select: { id: true, courseId: true, position: true, title: true, markdownContent: true, publishedRevision: true, publishedAt: true },
    }),
    prisma.aiProposal.findMany({
      where: {
        kind: AiProposalKind.LESSON_REVISION,
        taskId: { in: ids },
        targetId: { in: lessonIds },
        status: { in: [AiProposalStatus.OPEN, AiProposalStatus.WORKING, AiProposalStatus.PENDING] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, taskId: true, targetId: true, status: true, payload: true, via: true, createdAt: true, updatedAt: true },
    }),
    groupIds.length ? prisma.courseGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }) : [],
  ]);
  const groupName = new Map(groups.map((group) => [group.id, group.name]));
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const feedbackCount = new Map(sources.map((row) => [row.taskId, row._count._all]));

  const nextOf = (
    action: PathAction | null,
    taskHref: string,
    lessonHref: (lessonId: string) => string | null,
    editorHref: (lessonId: string) => string | null
  ): RevisionPathView['next'] => {
    if (!action) return null;
    switch (action.kind) {
      case 'writePlan':
        return { label: t('next.writePlan'), href: `${taskHref}#plan` };
      case 'planDrafting':
        return { label: t('next.planDrafting'), href: null };
      case 'reviewPlanDraft':
        return { label: t('next.reviewPlanDraft'), href: `${taskHref}#plan` };
      case 'revise':
        return { label: t('next.revise'), href: lessonHref(action.lessonId) };
      case 'edit':
        return { label: t('next.edit'), href: lessonHref(action.lessonId) };
      case 'writing':
        return { label: t('next.writing'), href: lessonHref(action.lessonId) };
      case 'reviewChanges':
        return {
          label: action.count ? t('next.reviewChanges', { count: action.count }) : t('next.reviewDraft'),
          href: lessonHref(action.lessonId),
        };
      case 'publish':
        return { label: t('next.publish'), href: editorHref(action.lessonId) };
      case 'startAgain':
        return { label: t('next.startAgain'), href: `${taskHref}#status` };
    }
  };

  const result = new Map<string, RevisionPathView>();
  for (const task of tasks) {
    const place = places.get(task.id);
    const targetIds = (place?.targets ?? []).map((target) => target.lessonId);
    const targets: PathTarget[] = targetIds.flatMap((lessonId) => {
      const lesson = lessonById.get(lessonId);
      if (!lesson) return [];
      const draft = drafts.find(
        (row) => row.taskId === task.id && row.targetId === lessonId && (row.status === AiProposalStatus.OPEN || stillWorking(row))
      );
      let draftState: PathTarget['draft'] = null;
      if (draft && !(draft.status === AiProposalStatus.OPEN && isEmptyCarriedDraft(draft.payload))) {
        const payload = (draft.payload ?? {}) as { markdown?: string; base?: string };
        draftState =
          draft.status !== AiProposalStatus.OPEN
            ? { state: 'working', count: null }
            : { state: 'ready', count: proposeChanges(payload.base ?? lesson.markdownContent, payload.markdown ?? '').length };
      }
      const change = changes.find((row) => row.taskId === task.id && row.lessonId === lessonId);
      return [
        {
          lessonId,
          draft: draftState,
          changedRevision: change?.revision ?? null,
          publishedRevision: lesson.publishedAt ? lesson.publishedRevision : null,
        },
      ];
    });
    const planDraft = planDrafts.find(([id]) => id === task.id)?.[1] ?? null;
    const path = deriveRevisionPath({
      status: task.status,
      hasPlan: Boolean(planBody(task.plan)),
      planDraft:
        planDraft?.status === AiProposalStatus.OPEN ? 'ready' : planDraft && stillWorking(planDraft) ? 'working' : null,
      aiEnabled,
      targets,
    });

    const taskHref = `/admin/tasks/${task.id}`;
    // Worked on in the lesson's Improvements view, with this improvement selected (its drafts show there).
    const lessonHref = (lessonId: string) => {
      const lesson = lessonById.get(lessonId);
      if (!lesson) return null;
      return `/admin/courses/${lesson.courseId}/lessons/${lessonId}/improvements?i=${task.id}`;
    };
    const savedCount = targets.filter((target) => target.changedRevision !== null).length;
    const sourceCount = feedbackCount.get(task.id) ?? 0;
    const detail = (step: PathStep, state: StepState): string | null => {
      if (state === 'skipped') return t('skipped');
      if (step === 'feedback') return sourceCount ? t('feedbackCount', { count: sourceCount }) : t('brief');
      if (step === 'plan') {
        if (state === 'done') return t('planWritten');
        return path.next?.kind === 'planDrafting' ? t('drafting') : path.next?.kind === 'reviewPlanDraft' ? t('draftReady') : null;
      }
      if (step === 'changes') {
        if (state === 'done') return targets.length > 1 ? t('lessonsSaved', { count: savedCount, total: targets.length }) : t('saved');
        if (state !== 'current') return null;
        if (path.next?.kind === 'writing') return t('writing');
        if (path.next?.kind === 'reviewChanges') return path.next.count ? t('toReview', { count: path.next.count }) : t('draftReady');
        return targets.length > 1 ? t('lessonsSaved', { count: savedCount, total: targets.length }) : null;
      }
      if (state === 'done') return t('learnersSee');
      return state === 'current' ? t('savedAsDraft') : null;
    };
    // Publishing happens in the lesson editor.
    const editorHref = (lessonId: string) => {
      const lesson = lessonById.get(lessonId);
      return lesson ? `/admin/courses/${lesson.courseId}/lessons/${lessonId}` : null;
    };
    const next = nextOf(path.next, taskHref, lessonHref, editorHref);
    // Each lesson by name, and which copy: "Spring group's copy · Lesson 4", "Main course · Lesson 4".
    const targetViews = targets.map((target) => {
      const lesson = lessonById.get(target.lessonId);
      const copy = place?.targets.find((candidate) => candidate.lessonId === target.lessonId)?.copy ?? 'own';
      const lessonLabel = t('targets.lesson', { position: lesson?.position ?? 0, title: lesson?.title ?? '' });
      const group = place?.groupId ? groupName.get(place.groupId) : undefined;
      const label =
        copy === 'course' ? t('targets.course', { lesson: lessonLabel }) : group && place?.targets.some((other) => other.copy === 'course') ? t('targets.copy', { group, lesson: lessonLabel }) : lessonLabel;
      const reachedNow = target.changedRevision !== null && target.publishedRevision !== null && target.publishedRevision >= target.changedRevision;
      const state =
        target.changedRevision !== null
          ? reachedNow
            ? t('learnersSee')
            : t('savedAsDraft')
          : target.draft?.state === 'working'
            ? t('writing')
            : target.draft?.state === 'ready'
              ? target.draft.count
                ? t('toReview', { count: target.draft.count })
                : t('draftReady')
              : t('targets.toChange');
      const phase =
        target.changedRevision !== null
          ? reachedNow
            ? ('live' as const)
            : ('saved' as const)
          : target.draft?.state === 'working'
            ? ('writing' as const)
            : target.draft?.state === 'ready'
              ? ('review' as const)
              : ('toChange' as const);
      return {
        lessonId: target.lessonId,
        label,
        state,
        href: lessonHref(target.lessonId),
        done: target.changedRevision !== null,
        phase,
        toReview: target.draft?.state === 'ready' ? Math.max(1, target.draft.count ?? 0) : 0,
        lessonLabel,
        copyOf: copy === 'own' && group ? group : null,
        course: copy === 'course',
      };
    });
    result.set(task.id, {
      taskId: task.id,
      title: task.title,
      steps: path.steps.map(({ step, state }) => ({ step, state, label: t(`steps.${step}`), detail: detail(step, state) })),
      next,
      finished: path.finished,
      unpublishedLessonIds: targets
        .filter((target) => target.changedRevision !== null && !(target.publishedRevision !== null && target.publishedRevision >= target.changedRevision))
        .map((target) => target.lessonId),
      targets: targetViews,
    });
  }
  return result;
}

