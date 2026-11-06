import 'server-only';

import { AiProposalKind, AiProposalStatus, LessonStatus, Permission, TaskStatus, type Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { buildAccessPlaceholderHtml, computeLessonSourceHash } from '@/lib/access-lesson-render';
import { buildLessonAssetReferences } from '@/lib/course-markdown';
import { canEditVersion, loadVersionRef, type CrmViewer } from '@/lib/crm-access';
import { improvementPlaces } from '@/lib/improvement-targets';
import { parsePlanScope, withPlanScope, type PlanScope } from '@/lib/plan-scope';
import { forgetLessonChange, recordLessonChange } from '@/lib/lesson-changes';
import { hasUnpublishedChanges, publishLessonSnapshot } from '@/lib/lesson-publishing';
import { prisma, type DbClient } from '@/lib/prisma';
import { proposeTaskForCore, TASK_ENTITY_TYPE } from '@/lib/tasks';
import { proposeChanges, transplantChanges } from './components/workspace/revision';

/**
 * What saving a group's copy did for the main course, when the improvement's plan says "group and
 * main course". The same Publish put the changes that found the same text into the course's lesson
 * (`live`: published for its learners too; `saved`: in its working copy, which had unpublished
 * edits), with the rest (`waiting`) on its lesson to look at. Or, when none went in by itself: the
 * changes waiting there as proposed changes (`drafted`), none of them fitting there (`differs`), or,
 * for someone who can't edit the course, a suggestion for the course carrying the plan and the
 * changes (`suggested`).
 */
export type CourseCarry =
  | { kind: 'live' | 'saved'; href: string; placed: number; waiting: number }
  | { kind: 'drafted'; href: string; placed: number; unplaced: number }
  | { kind: 'differs'; href: string; unplaced: number }
  | { kind: 'suggested'; taskId: string; placed: number; unplaced: number };

/**
 * One save of the group's copy carried into the draft: its recorded change, the copy's text before
 * and after, what didn't fit or went where the text differs, whether it made the draft (and the
 * course's suggestion). Undo of that save takes it back out (`takeBackCarry`).
 */
type Carry = { changeId: string; before: string; after: string; unplaced: number; nearby: number; check?: string[]; created: boolean; suggestionCreated: boolean };

type CarriedPayload = {
  markdown?: string;
  base?: string;
  why?: { taskId?: string | null; planTitle?: string | null; fromCopy?: { group: string; lessonId: string }; unplaced?: number; nearby?: number; check?: string[] };
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
  // Which paragraphs those are: the review tags them, and they start skipped.
  const check = [...(payload.why?.check ?? []), ...carried.nearbyBlocks];
  const why = { taskId: ownerId, planTitle: task.title, fromCopy: { group: groupName, lessonId: input.lessonId }, unplaced: totalUnplaced, nearby: totalNearby, check };
  const carries: Carry[] = [
    ...(payload.carries ?? []),
    ...(input.changeId
      ? [{ changeId: input.changeId, before: input.before, after: input.after, unplaced, nearby: carried.nearby, check: carried.nearbyBlocks, created: !existing, suggestionCreated }]
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
    const check = (payload.why?.check ?? []).filter((block) => !carry.check?.includes(block));
    await prisma.aiProposal.update({
      where: { id: draft.id },
      data: {
        payload: { ...payload, markdown, why: { ...payload.why, unplaced, nearby, check }, carries: rest } as Prisma.InputJsonValue,
        summary: await carriedSummary(payload.why?.fromCopy?.group ?? '', unplaced, nearby),
      },
    });
  }
  return changed;
}

/**
 * The main course's part of one improvement's Publish on a group's copy, worked out before the save
 * (once its transaction is open, nothing may query outside it): the changes that find the same text
 * on the course's lesson go in with the same Publish (`text`), and what's alike there but differs,
 * or has nowhere to go, waits on its lesson as a draft (`rest`). It's published for the course's
 * learners when they read that lesson's latest text (no one's unpublished edits go live with it).
 */
export type CourseWrite = {
  taskId: string;
  taskTitle: string;
  group: string;
  courseLessonId: string;
  courseId: string;
  curriculumVersionId: string;
  /** The course lesson's revision and text it was worked out from (the write is guarded by it). */
  revision: number;
  before: string;
  text: string;
  placed: number;
  publish: boolean;
  bindings: Map<string, string>;
  /** The group copy's lesson and its text before and after, for the draft of the rest and Undo. */
  copyLessonId: string;
  copyBefore: string;
  copyAfter: string;
  rest: { text: string; unplaced: number; nearby: number; check: string[]; summary: string } | null;
};

/**
 * A group improvement's part of a Publish on its copy, before the save: the scope to write into its
 * plan (the review's switch, when it said one: null keeps the plan's), and the main course's write.
 * The write is null when the course's part goes the other way (`carryToCourse`, after the save): it
 * isn't for the course, a suggestion owns it, the person can't edit the course, a draft already
 * waits there for this improvement (everything joins it), or nothing finds the same text there.
 * `bindings`: the group lesson's images, so the course's lesson can show the ones the carried text
 * uses. Null for an improvement that isn't a group's.
 */
export async function prepareCoursePart(input: {
  taskId: string;
  lessonId: string;
  before: string;
  after: string;
  toCourse: boolean | null;
  viewer: CrmViewer;
  bindings: Map<string, string>;
}): Promise<{ scope: PlanScope | null; write: CourseWrite | null } | null> {
  const places = await improvementPlaces(prisma, input.taskId);
  if (!places?.groupId) return null;
  const scope: PlanScope | null = input.toCourse === null ? null : input.toCourse ? 'group and core' : 'group only';
  const toCourse = input.toCourse ?? (places.scope === 'group and core' && !places.groupOnly);
  return { scope, write: toCourse && !places.suggestionId ? await prepareCourseWrite(input, places.courseLessons[input.lessonId], places.groupId) : null };
}

/**
 * Plan scope chosen at Publish: written into the plan in the save's transaction, before the
 * improvement is checked for done. Choosing the main course takes back an earlier "keep it to the
 * group".
 */
export async function choosePlanScope(db: DbClient, taskId: string, scope: PlanScope) {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { plan: true, groupOnly: true } });
  if (!task) return;
  if (parsePlanScope(task.plan) !== scope) {
    await db.task.update({ where: { id: taskId }, data: { plan: withPlanScope(task.plan, scope), planUpdatedAt: new Date() } });
  }
  if (scope === 'group and core' && task.groupOnly) await db.task.update({ where: { id: taskId }, data: { groupOnly: false } });
}

async function prepareCourseWrite(
  input: { taskId: string; lessonId: string; before: string; after: string; viewer: CrmViewer; bindings: Map<string, string> },
  courseLessonId: string | undefined,
  groupId: string
): Promise<CourseWrite | null> {
  if (!courseLessonId) return null;
  const lesson = await prisma.lesson.findUnique({
    where: { id: courseLessonId },
    select: { courseId: true, curriculumVersionId: true, markdownContent: true, revision: true, status: true, publishedAt: true, publishedRevision: true },
  });
  if (!lesson) return null;
  const versionRef = await loadVersionRef(lesson.curriculumVersionId);
  if (!versionRef || !canEditVersion(input.viewer, versionRef, [Permission.WRITE])) return null;
  const waiting = await prisma.aiProposal.findFirst({
    where: { kind: AiProposalKind.LESSON_REVISION, status: AiProposalStatus.OPEN, targetId: courseLessonId, taskId: input.taskId },
    select: { id: true },
  });
  if (waiting) return null;
  const carried = transplantChanges(input.before, input.after, lesson.markdownContent);
  if (!carried.exact.changed) return null;
  const [task, group, references] = await Promise.all([
    prisma.task.findUnique({ where: { id: input.taskId }, select: { title: true } }),
    prisma.courseGroup.findUnique({ where: { id: groupId }, select: { name: true } }),
    prisma.lessonAssetReference.findMany({ where: { lessonId: courseLessonId }, select: { sourcePath: true, assetId: true } }),
  ]);
  // The course's own images first, then the group's for paths the carried text brings.
  const bindings = new Map(references.flatMap((reference) => (reference.assetId ? [[reference.sourcePath, reference.assetId] as const] : [])));
  for (const [path, assetId] of Array.from(input.bindings)) if (!bindings.has(path)) bindings.set(path, assetId);
  const groupName = group?.name ?? '';
  // The rest, on top of what goes in by itself: the carry's whole text is built on that.
  const left = proposeChanges(carried.exact.text, carried.text).length > 0 || carried.unplaced.length > 0;
  return {
    taskId: input.taskId,
    taskTitle: task?.title ?? '',
    group: groupName,
    courseLessonId,
    courseId: lesson.courseId,
    curriculumVersionId: lesson.curriculumVersionId,
    revision: lesson.revision,
    before: lesson.markdownContent,
    text: carried.exact.text,
    placed: carried.exact.placed,
    publish: lesson.status === LessonStatus.PUBLISHED && !hasUnpublishedChanges(lesson),
    bindings,
    copyLessonId: input.lessonId,
    copyBefore: input.before,
    copyAfter: input.after,
    rest: left
      ? {
          text: carried.text,
          unplaced: carried.unplaced.length,
          nearby: carried.nearby,
          check: carried.nearbyBlocks,
          summary: await carriedSummary(groupName, carried.unplaced.length, carried.nearby),
        }
      : null,
  };
}

/** Writes a lesson's text with its image references, guarded by the revision it was read at. False when it moved on. */
async function writeGuardedText(db: DbClient, lessonId: string, revision: number, text: string, bindings: Map<string, string>) {
  const references = buildLessonAssetReferences(text, bindings);
  const refs = references.map((reference) => ({ assetId: reference.assetId ?? null, sourcePath: reference.sourcePath }));
  const guarded = await db.lesson.updateMany({
    where: { id: lessonId, revision },
    data: {
      markdownContent: text,
      accessHtmlSourceHash: computeLessonSourceHash(text, refs),
      accessRenderedHtml: buildAccessPlaceholderHtml(text, refs),
      revision: { increment: 1 },
    },
  });
  if (!guarded.count) return false;
  await db.lessonAssetReference.deleteMany({ where: { lessonId } });
  if (references.length) {
    await db.lessonAssetReference.createMany({
      data: references.map((reference) => ({
        altText: reference.altText,
        assetId: reference.assetId ?? null,
        lessonId,
        position: reference.position,
        sourcePath: reference.sourcePath,
      })),
    });
  }
  return true;
}

/**
 * The main course's part, in the group copy's save transaction (`groupChangeId`: the change that
 * save recorded): the text goes into the course's lesson, recorded as its change for the same
 * improvement, the rest waits there as a draft, and its learners get it when they read the latest
 * text. False when the course's lesson changed since it was read: nothing is written then, and the
 * caller carries everything as a draft instead.
 */
export async function writeCourseCarry(
  tx: DbClient,
  write: CourseWrite,
  input: { groupChangeId: string; userId: string; organizationId: string }
): Promise<boolean> {
  if (!(await writeGuardedText(tx, write.courseLessonId, write.revision, write.text, write.bindings))) return false;
  const revision = write.revision + 1;
  await recordLessonChange(tx, {
    lessonId: write.courseLessonId,
    revision,
    taskId: write.taskId,
    proposalIds: [],
    commentIds: [],
    applied: write.placed,
    skipped: 0,
    createdById: input.userId,
    changes: proposeChanges(write.before, write.text).slice(0, 100) as unknown as Prisma.InputJsonValue,
    carriedFromId: input.groupChangeId,
    textBefore: write.before,
  });
  if (write.rest) {
    const { rest } = write;
    const why = { taskId: write.taskId, planTitle: write.taskTitle, fromCopy: { group: write.group, lessonId: write.copyLessonId }, unplaced: rest.unplaced, nearby: rest.nearby, check: rest.check };
    const carries: Carry[] = [
      { changeId: input.groupChangeId, before: write.copyBefore, after: write.copyAfter, unplaced: rest.unplaced, nearby: rest.nearby, check: rest.check, created: true, suggestionCreated: false },
    ];
    await tx.aiProposal.create({
      data: {
        organizationId: input.organizationId,
        kind: AiProposalKind.LESSON_REVISION,
        status: AiProposalStatus.OPEN,
        targetType: 'lesson',
        targetId: write.courseLessonId,
        taskId: write.taskId,
        baseRevision: revision,
        payload: { markdown: rest.text, base: write.text, why, carries } as Prisma.InputJsonValue,
        summary: rest.summary,
        via: 'app',
        createdById: input.userId,
      },
    });
  }
  if (write.publish) await publishLessonSnapshot(tx, write.courseLessonId, input.userId);
  return true;
}

/** What one Publish did on the main course's lesson, said in the notice. */
export function courseWritten(write: CourseWrite): CourseCarry {
  return {
    kind: write.publish ? 'live' : 'saved',
    href: `/admin/courses/${write.courseId}/lessons/${write.courseLessonId}/improvements?i=${write.taskId}`,
    placed: write.placed,
    waiting: write.rest ? write.rest.nearby + write.rest.unplaced : 0,
  };
}

/**
 * Undo of a group copy's save also takes back what the same Publish put into the main course's
 * lesson: its text from before goes back (published again if learners had it), while nobody
 * changed that lesson since. Otherwise it stays, and `movedOn` says it's to undo there.
 */
export async function takeBackCourseWrite(input: { changeId: string; viewer: CrmViewer; userId: string }): Promise<{ tookBack: boolean; movedOn: boolean }> {
  const carried = await prisma.lessonChange.findMany({
    where: { carriedFromId: input.changeId },
    select: { id: true, lessonId: true, revision: true, textBefore: true, lesson: { select: { revision: true, curriculumVersionId: true, publishedAt: true, publishedRevision: true } } },
  });
  let tookBack = false;
  let movedOn = false;
  for (const change of carried) {
    if (change.textBefore === null) continue;
    const versionRef = await loadVersionRef(change.lesson.curriculumVersionId);
    if (!versionRef || !canEditVersion(input.viewer, versionRef, [Permission.WRITE])) {
      movedOn = true;
      continue;
    }
    if (change.lesson.revision !== change.revision) {
      movedOn = true;
      continue;
    }
    const references = await prisma.lessonAssetReference.findMany({ where: { lessonId: change.lessonId }, select: { sourcePath: true, assetId: true } });
    const bindings = new Map(references.flatMap((reference) => (reference.assetId ? [[reference.sourcePath, reference.assetId] as const] : [])));
    const republish = Boolean(change.lesson.publishedAt) && change.lesson.publishedRevision === change.revision;
    const textBefore = change.textBefore;
    const done = await prisma.$transaction(async (tx) => {
      if (!(await writeGuardedText(tx, change.lessonId, change.revision, textBefore, bindings))) return false;
      await forgetLessonChange(tx, change.id);
      if (republish) await publishLessonSnapshot(tx, change.lessonId, input.userId);
      return true;
    });
    if (done) tookBack = true;
    else movedOn = true;
  }
  return { tookBack, movedOn };
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
