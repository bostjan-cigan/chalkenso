import 'server-only';

import { CurriculumCommentStatus, Permission, type Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { isAiConfigured } from '@/lib/ai';
import { accessScope, canEditVersion, commentScopeWhere, loadVersionRef, taskScopeWhere, type CrmViewer } from '@/lib/crm-access';
import { feedbackSincePlan } from '@/lib/feedback-rounds';
import { improvementLabel } from '@/lib/improvement-label';
import { improvementRecords } from '@/lib/improvement-record';
import { prisma } from '@/lib/prisma';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE, TASK_KIND } from '@/lib/tasks';
import { revisionPathsFor, type RevisionPathView } from '../revision-path/path-data';

/** One improvement as the Improvements list shows it. */
export type ImprovementRow = {
  id: string;
  title: string;
  /** What the list calls it: its title, or what its feedback asks when the title is just its lesson's name. */
  label: string;
  /** Where it is worked on: the lesson's Improvements view, with it selected (else its own page). */
  workHref: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'IGNORED';
  /** The lessons it changes, as "Lesson 3 · Docker volumes" (several: "Lessons 4, 5 and 6"). */
  lessons: Array<{ position: number; title: string }>;
  assignee: string | null;
  mine: boolean;
  path: RevisionPathView | null;
  /** A finished one: whether learners see what it changed (since when), or it waits as a draft or for review. */
  outcome: { state: 'seen' | 'draft' | 'waiting' | 'none'; since: string | null } | null;
  /** How much feedback it uses (one improvement per lesson gathers what the team acts on). */
  feedbackCount: number;
  /** It has a plan, and feedback joined after it was written: the plan is to update first. */
  planStale: boolean;
};

/**
 * The improvements in `where` (a group's, a course's), within what the viewer may see, newest first,
 * each with where it is. Done ones only the most recent, the rest all (there are few open).
 */
export async function loadImprovements(viewer: CrmViewer, where: Prisma.TaskWhereInput): Promise<ImprovementRow[]> {
  const tasks = await prisma.task.findMany({
    where: { AND: [taskScopeWhere(accessScope(viewer, 'tasks')), { kind: TASK_KIND.curriculum }, where] },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      plan: true,
      planUpdatedAt: true,
      assigneeId: true,
      assignee: { select: { firstName: true, lastName: true, identifier: true } },
      entityLinks: {
        where: { OR: [{ entityType: TASK_ENTITY_TYPE.lesson }, { entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source }] },
        orderBy: { createdAt: 'asc' },
        select: { entityType: true, entityId: true, createdAt: true },
      },
    },
  });
  // What each was made from: its first piece of feedback the viewer may see (to name it by).
  const sourceIds = tasks.flatMap((task) => task.entityLinks.filter((link) => link.entityType === TASK_ENTITY_TYPE.curriculumComment).map((link) => link.entityId));
  const sources = sourceIds.length
    ? await prisma.curriculumComment.findMany({
        where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { id: { in: sourceIds } }] },
        select: { id: true, body: true },
      })
    : [];
  const sourceBody = new Map(sources.map((source) => [source.id, source.body]));
  const lessonLinks = (task: (typeof tasks)[number]) => task.entityLinks.filter((link) => link.entityType === TASK_ENTITY_TYPE.lesson);
  const lessonIds = Array.from(new Set(tasks.flatMap((task) => lessonLinks(task).map((link) => link.entityId))));
  const [lessons, paths, records] = await Promise.all([
    prisma.lesson.findMany({ where: { id: { in: lessonIds } }, select: { id: true, position: true, title: true } }),
    revisionPathsFor(
      tasks.filter((task) => lessonLinks(task).length),
      await isAiConfigured()
    ),
    improvementRecords(
      viewer,
      tasks.filter((task) => task.status === 'DONE').slice(0, 50).map((task) => task.id)
    ),
  ]);
  const outcomeOf = (taskId: string): ImprovementRow['outcome'] => {
    const record = records.get(taskId);
    if (!record?.saved.length) return { state: record?.waiting.length ? 'waiting' : 'none', since: null };
    if (record.saved.some((saved) => !saved.seen)) return { state: 'draft', since: null };
    return { state: 'seen', since: record.saved.map((saved) => saved.seenSince ?? saved.savedAt).sort().at(-1) ?? null };
  };
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  return tasks.map((task) => {
    const lessons = lessonLinks(task)
      .map((link) => lessonById.get(link.entityId))
      .filter((lesson): lesson is NonNullable<typeof lesson> => Boolean(lesson));
    const firstSource = task.entityLinks.find((link) => link.entityType === TASK_ENTITY_TYPE.curriculumComment && sourceBody.has(link.entityId));
    const path = paths.get(task.id) ?? null;
    return {
    id: task.id,
    title: task.title,
    label: improvementLabel(task.title, lessons.map((lesson) => lesson.title), firstSource ? sourceBody.get(firstSource.entityId) : null, task.plan),
    workHref: path?.targets.find((target) => target.href)?.href ?? `/admin/tasks/${task.id}`,
    status: task.status,
    lessons: lessonLinks(task)
      .map((link) => lessonById.get(link.entityId))
      .filter((lesson): lesson is NonNullable<typeof lesson> => Boolean(lesson))
      .sort((a, b) => a.position - b.position)
      .map((lesson) => ({ position: lesson.position, title: lesson.title })),
    assignee: task.assignee ? [task.assignee.firstName, task.assignee.lastName].filter(Boolean).join(' ') || task.assignee.identifier : null,
    mine: task.assigneeId === viewer.id,
    path,
    outcome: task.status === 'DONE' ? outcomeOf(task.id) : null,
    feedbackCount: task.entityLinks.filter((link) => link.entityType === TASK_ENTITY_TYPE.curriculumComment && sourceBody.has(link.entityId)).length,
    planStale:
      feedbackSincePlan(
        task.plan,
        task.planUpdatedAt,
        task.entityLinks.flatMap((link) => (link.entityType === TASK_ENTITY_TYPE.curriculumComment ? [{ id: link.entityId, linkedAt: link.createdAt }] : []))
      ).length > 0,
    };
  });
}

/** A lesson's open work, as the Improvements list sums it up: one row per lesson. */
export type LessonWork = {
  lessonId: string;
  /** "Lesson 3 · Authentication". */
  label: string;
  /** The group whose copy the lesson is (null: the main course's), to tell places apart when the list mixes them. */
  copyOf: string | null;
  /** The lesson's Improve mode (null: the viewer can't edit the lesson). */
  href: string | null;
  improvements: number;
  /** The feedback its open improvements use. */
  used: number;
  toReview: number;
  plansToWrite: number;
  /** Plans written before more feedback joined. */
  plansToUpdate: number;
  /** Plans ready, with nothing drafted yet. */
  plansReady: number;
  writing: boolean;
  /** Saved with changes learners don't see yet. */
  unpublished: boolean;
  newFeedback: number;
  /** Something here is the viewer's (an improvement assigned to them). */
  mine: boolean;
  /** Its one next step: changes to review, feedback to decide, a plan to write or update, changes to draft, something to improve, or publishing. */
  next: { kind: 'review' | 'decide' | 'plan' | 'update' | 'draft' | 'improve' | 'publish'; href: string | null };
};

/** Open feedback no improvement covers yet, per lesson, within `where` and what the viewer may see. */
export async function newFeedbackByLesson(viewer: CrmViewer, where: Prisma.CurriculumCommentWhereInput) {
  const comments = await prisma.curriculumComment.findMany({
    where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), where, { status: CurriculumCommentStatus.OPEN }] },
    orderBy: { createdAt: 'asc' },
    take: 300,
    select: { id: true, lessonId: true },
  });
  if (!comments.length) return [];
  const covered = new Set(
    (
      await prisma.taskEntityLink.findMany({
        where: { entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: { in: comments.map((comment) => comment.id) } },
        select: { entityId: true },
      })
    ).map((link) => link.entityId)
  );
  const byLesson = new Map<string, string[]>();
  for (const comment of comments) {
    if (!covered.has(comment.id)) byLesson.set(comment.lessonId, [...(byLesson.get(comment.lessonId) ?? []), comment.id]);
  }
  if (!byLesson.size) return [];
  const [lessons, t] = await Promise.all([
    prisma.lesson.findMany({
      where: { id: { in: Array.from(byLesson.keys()) } },
      select: { id: true, title: true, position: true, courseId: true, curriculumVersionId: true },
    }),
    getTranslations('tasks.path'),
  ]);
  return Promise.all(
    lessons.map(async (lesson) => {
      const ids = byLesson.get(lesson.id) ?? [];
      const ref = await loadVersionRef(lesson.curriculumVersionId);
      const editable = Boolean(ref && canEditVersion(viewer, ref, [Permission.WRITE]));
      return {
        lessonId: lesson.id,
        label: t('targets.lesson', { position: lesson.position, title: lesson.title }),
        copyOf: ref?.ownerGroupId ? (await prisma.courseGroup.findUnique({ where: { id: ref.ownerGroupId }, select: { name: true } }))?.name ?? null : null,
        count: ids.length,
        href: editable ? `/admin/courses/${lesson.courseId}/lessons/${lesson.id}/improvements?note=${ids[0]}` : null,
      };
    })
  );
}

export type NewFeedbackLesson = Awaited<ReturnType<typeof newFeedbackByLesson>>[number];

const NEXT_ORDER: Record<LessonWork['next']['kind'], number> = { review: 0, decide: 1, plan: 2, update: 3, draft: 4, improve: 5, publish: 6 };

/**
 * The lessons with open work, from the improvements and the new feedback: per lesson, what waits
 * there and its one next step. What needs the viewer comes first, then by next step.
 */
export function lessonWork(rows: ImprovementRow[], feedback: NewFeedbackLesson[]): LessonWork[] {
  const lessons = new Map<string, LessonWork & { hrefs: Partial<Record<LessonWork['next']['kind'], string>> }>();
  const base = (href: string | null) => (href ? href.split('?')[0] : null);
  const entry = (lessonId: string, label: string, copyOf: string | null, href: string | null) => {
    let found = lessons.get(lessonId);
    if (!found) {
      found = {
        lessonId,
        label,
        copyOf,
        href: base(href),
        improvements: 0,
        used: 0,
        toReview: 0,
        plansToWrite: 0,
        plansToUpdate: 0,
        plansReady: 0,
        writing: false,
        unpublished: false,
        newFeedback: 0,
        mine: false,
        next: { kind: 'improve', href: null },
        hrefs: {},
      };
      lessons.set(lessonId, found);
    }
    found.href ??= base(href);
    return found;
  };
  for (const row of rows) {
    if (!row.path) continue;
    const open = row.status === 'TODO' || row.status === 'IN_PROGRESS';
    const plan = row.path.steps.find((step) => step.step === 'plan')?.state;
    const needsPlan = open && plan !== 'done' && plan !== 'skipped';
    for (const target of row.path.targets) {
      if (!open && target.phase !== 'saved') continue;
      const lesson = entry(target.lessonId, target.lessonLabel, target.copyOf, target.href);
      if (target.phase === 'saved') lesson.unpublished = true;
      if (!open) continue;
      lesson.improvements += 1;
      lesson.used += row.feedbackCount;
      lesson.mine ||= row.mine;
      if (target.phase === 'review') {
        lesson.toReview += target.toReview;
        lesson.hrefs.review ??= target.href ?? undefined;
      } else if (target.phase === 'writing') {
        lesson.writing = true;
      } else if (target.phase === 'toChange') {
        if (needsPlan) {
          lesson.plansToWrite += 1;
          lesson.hrefs.plan ??= target.href ?? undefined;
        } else if (row.planStale) {
          lesson.plansToUpdate += 1;
          lesson.hrefs.update ??= target.href ?? undefined;
        } else if (plan === 'done') {
          lesson.plansReady += 1;
          lesson.hrefs.draft ??= target.href ?? undefined;
        }
        lesson.hrefs.improve ??= target.href ?? undefined;
      }
    }
  }
  for (const item of feedback) {
    const lesson = entry(item.lessonId, item.label, item.copyOf, item.href);
    lesson.newFeedback += item.count;
    lesson.hrefs.decide ??= item.href ?? undefined;
    lesson.hrefs.improve ??= item.href ?? undefined;
  }
  return Array.from(lessons.values())
    .map(({ hrefs, ...lesson }) => {
      // Feedback is decided before planning, so the plan covers it.
      const kind: LessonWork['next']['kind'] = lesson.toReview
        ? 'review'
        : lesson.newFeedback
          ? 'decide'
          : lesson.plansToWrite
            ? 'plan'
            : lesson.plansToUpdate
              ? 'update'
              : lesson.plansReady
                ? 'draft'
                : lesson.improvements
                  ? 'improve'
                  : 'publish';
      return { ...lesson, next: { kind, href: kind === 'publish' ? null : hrefs[kind] ?? lesson.href } };
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine) || NEXT_ORDER[a.next.kind] - NEXT_ORDER[b.next.kind] || a.label.localeCompare(b.label));
}
