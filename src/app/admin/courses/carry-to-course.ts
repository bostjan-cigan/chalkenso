import 'server-only';

import { AiProposalKind, AiProposalStatus, Permission, TaskStatus, type Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { canEditVersion, loadVersionRef, type CrmViewer } from '@/lib/crm-access';
import { improvementPlaces } from '@/lib/improvement-targets';
import { prisma } from '@/lib/prisma';
import { proposeTaskForCore, TASK_ENTITY_TYPE } from '@/lib/tasks';
import { proposeChanges, transplantChanges } from './components/workspace/revision';

/**
 * What saving a group's copy did for the main course, when the improvement's plan says "group and
 * main course": the same changes waiting on the course's lesson as proposed changes (`drafted`),
 * none of them fitting there (`differs`: the course's lesson differs in those places), or, for
 * someone who can't edit the course, a suggestion for the course carrying the plan and the changes
 * (`suggested`). Nothing is applied to the course by itself.
 */
export type CourseCarry =
  | { kind: 'drafted'; href: string; placed: number; unplaced: number }
  | { kind: 'differs'; href: string; unplaced: number }
  | { kind: 'suggested'; taskId: string; placed: number; unplaced: number };

/**
 * One save of the group's copy carried into the draft: its recorded change, the copy's text before
 * and after, what didn't fit or went where the text differs, whether it made the draft (and the
 * course's suggestion). Undo of that save takes it back out (`takeBackCarry`).
 */
type Carry = { changeId: string; before: string; after: string; unplaced: number; nearby: number; created: boolean; suggestionCreated: boolean };

type CarriedPayload = {
  markdown?: string;
  base?: string;
  why?: { taskId?: string | null; planTitle?: string | null; fromCopy?: { group: string; lessonId: string }; unplaced?: number; nearby?: number };
  carries?: Carry[];
};

/** The draft's summary: where its changes came from, what didn't fit, and what to check. */
async function carriedSummary(group: string, unplaced: number, nearby: number) {
  const t = await getTranslations('editor.carried');
  return [unplaced ? t('summaryWithLeft', { group, count: unplaced }) : t('summary', { group }), nearby ? t('nearby', { count: nearby }) : '']
    .filter(Boolean)
    .join(' ');
}

/**
 * Carries the changes a save made to a group's copy (`before` → `after`) onto the main course's
 * lesson the copy was made from, without AI: where the same text is there, or text that's alike
 * (`transplantChanges`), into the open draft there for the same improvement, or a new one.
 * Run after the save, with the saver's rights (the course needs WRITE on its version; otherwise
 * the course gets a suggestion). The draft records the carry by the save's change (`changeId`), so
 * Undo can take it back. Null when there is nothing to carry.
 */
export async function carryToCourse(input: {
  taskId: string;
  lessonId: string;
  before: string;
  after: string;
  /** The change the save recorded (its Undo takes the carry back). */
  changeId: string | null;
  viewer: CrmViewer;
  userId: string;
  organizationId: string;
}): Promise<CourseCarry | null> {
  const places = await improvementPlaces(prisma, input.taskId);
  if (!places?.groupId || places.scope !== 'group and core' || places.groupOnly) return null;
  const courseLessonId = places.courseLessons[input.lessonId];
  if (!courseLessonId) return null;
  const [courseLesson, task, group] = await Promise.all([
    prisma.lesson.findUnique({
      where: { id: courseLessonId },
      select: { courseId: true, curriculumVersionId: true, markdownContent: true, revision: true },
    }),
    prisma.task.findUnique({ where: { id: input.taskId }, select: { title: true } }),
    prisma.courseGroup.findUnique({ where: { id: places.groupId }, select: { name: true } }),
  ]);
  if (!courseLesson || !task) return null;
  const versionRef = await loadVersionRef(courseLesson.curriculumVersionId);
  const canEdit = Boolean(versionRef && canEditVersion(input.viewer, versionRef, [Permission.WRITE]));

  // The course's part belongs to its suggestion once there is one; without the right to edit the
  // course, this save makes it.
  let ownerId = places.suggestionId;
  const suggestionCreated = !ownerId && !canEdit;
  if (!ownerId && !canEdit) {
    const proposed = await proposeTaskForCore({ taskId: input.taskId, createdById: input.userId });
    if (!proposed.ok) return null;
    ownerId = proposed.taskId;
  }
  ownerId ??= input.taskId;

  const existing = await prisma.aiProposal.findFirst({
    where: { kind: AiProposalKind.LESSON_REVISION, via: 'app', status: AiProposalStatus.OPEN, targetId: courseLessonId, taskId: ownerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, payload: true },
  });
  const payload = (existing?.payload ?? {}) as CarriedPayload;
  const current = existing ? String(payload.markdown ?? courseLesson.markdownContent) : courseLesson.markdownContent;
  const carried = transplantChanges(input.before, input.after, current);
  if (!carried.total) return null;
  const lessonHref = `/admin/courses/${courseLesson.courseId}/lessons/${courseLessonId}/improvements?i=${ownerId}`;
  const unplaced = carried.unplaced.length;
  const suggested = (placed: number) =>
    ownerId !== input.taskId && !canEdit ? ({ kind: 'suggested', taskId: ownerId as string, placed, unplaced } as const) : null;

  // Nothing went in (or the course already has it all): no draft. What didn't fit is listed on the
  // course's lesson ("Didn't fit"), to make by hand there. A draft an earlier carry left empty goes.
  if (!proposeChanges(current, carried.text).length) {
    if (existing && !proposeChanges(String(payload.base ?? courseLesson.markdownContent), current).length) {
      await prisma.aiProposal.update({ where: { id: existing.id }, data: { status: AiProposalStatus.DISCARDED, decidedAt: new Date() } });
    }
    return suggested(0) ?? (unplaced ? { kind: 'differs', href: lessonHref, unplaced } : null);
  }

  const groupName = group?.name ?? '';
  const totalUnplaced = (payload.why?.unplaced ?? 0) + unplaced;
  // Changes that went where the course's text differs a little: the reviewer is told to check them.
  const totalNearby = (payload.why?.nearby ?? 0) + carried.nearby;
  const summary = await carriedSummary(groupName, totalUnplaced, totalNearby);
  const why = { taskId: ownerId, planTitle: task.title, fromCopy: { group: groupName, lessonId: input.lessonId }, unplaced: totalUnplaced, nearby: totalNearby };
  const carries: Carry[] = [
    ...(payload.carries ?? []),
    ...(input.changeId
      ? [{ changeId: input.changeId, before: input.before, after: input.after, unplaced, nearby: carried.nearby, created: !existing, suggestionCreated }]
      : []),
  ];
  if (existing) {
    await prisma.aiProposal.update({
      where: { id: existing.id },
      data: { payload: { ...payload, markdown: carried.text, why, carries } as Prisma.InputJsonValue, summary },
    });
  } else {
    await prisma.aiProposal.create({
      data: {
        organizationId: input.organizationId,
        kind: AiProposalKind.LESSON_REVISION,
        status: AiProposalStatus.OPEN,
        targetType: 'lesson',
        targetId: courseLessonId,
        taskId: ownerId,
        baseRevision: courseLesson.revision,
        payload: { markdown: carried.text, base: courseLesson.markdownContent, why, carries } as Prisma.InputJsonValue,
        summary,
        via: 'app',
        createdById: input.userId,
      },
    });
  }
  return suggested(carried.placed) ?? { kind: 'drafted', href: lessonHref, placed: carried.placed, unplaced };
}

/**
 * Undo of a group copy's save: what it carried to the main course's lesson comes back out of the
 * draft waiting there. A draft that save made, with nothing carried into it since, goes (and the
 * course's suggestion it made, while nothing was done on it); otherwise the copy's change is carried
 * the other way, so later saves' changes stay. A draft already saved on the course is left: that's
 * the course's own change now. Returns how many drafts changed.
 */
export async function takeBackCarry(input: { changeId: string; copyLessonId: string }) {
  const drafts = await prisma.aiProposal.findMany({
    where: {
      kind: AiProposalKind.LESSON_REVISION,
      via: 'app',
      status: AiProposalStatus.OPEN,
      payload: { path: ['why', 'fromCopy', 'lessonId'], equals: input.copyLessonId },
    },
    select: { id: true, payload: true, taskId: true },
  });
  let changed = 0;
  for (const draft of drafts) {
    const payload = (draft.payload ?? {}) as CarriedPayload;
    const carry = payload.carries?.find((one) => one.changeId === input.changeId);
    if (!carry) continue;
    const rest = (payload.carries ?? []).filter((one) => one !== carry);
    const base = String(payload.base ?? '');
    const markdown = carry.created && !rest.length ? base : transplantChanges(carry.after, carry.before, String(payload.markdown ?? base)).text;
    changed += 1;
    if (!proposeChanges(base, markdown).length) {
      await prisma.aiProposal.update({ where: { id: draft.id }, data: { status: AiProposalStatus.DISCARDED, decidedAt: new Date() } });
      if (carry.suggestionCreated && draft.taskId) await dropUntouchedSuggestion(draft.taskId);
      continue;
    }
    const unplaced = Math.max(0, (payload.why?.unplaced ?? 0) - carry.unplaced);
    const nearby = Math.max(0, (payload.why?.nearby ?? 0) - carry.nearby);
    await prisma.aiProposal.update({
      where: { id: draft.id },
      data: {
        payload: { ...payload, markdown, why: { ...payload.why, unplaced, nearby }, carries: rest } as Prisma.InputJsonValue,
        summary: await carriedSummary(payload.why?.fromCopy?.group ?? '', unplaced, nearby),
      },
    });
  }
  return changed;
}

/** A course's suggestion a carry made, while nobody worked on it (still To do, no plan of its own, no other draft): it goes. */
async function dropUntouchedSuggestion(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, proposals: { where: { status: { in: [AiProposalStatus.OPEN, AiProposalStatus.WORKING, AiProposalStatus.PENDING, AiProposalStatus.USED] } }, select: { id: true } } },
  });
  if (!task || task.status !== TaskStatus.TODO || task.proposals.length) return;
  if (await prisma.lessonChange.count({ where: { taskId } })) return;
  await prisma.taskEntityLink.deleteMany({ where: { entityType: TASK_ENTITY_TYPE.task, entityId: taskId } });
  await prisma.task.delete({ where: { id: taskId } });
}
