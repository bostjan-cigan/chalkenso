import 'server-only';

import { AiProposalKind, AiProposalStatus, CurriculumCommentStatus, TaskStatus } from '@prisma/client';
import { lockFor } from './advisory-locks';
import { CONNECTOR_READ, GIVE_UP_MS } from './ai-draft-progress';
import { pickLessonImprovement } from './feedback-rounds';
import { prisma, type DbClient, type TransactionClient } from './prisma';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE, TASK_KIND } from './tasks';

/**
 * One improvement per lesson (a course's lesson, or a group copy's): the feedback the team uses
 * ("we'll change this") joins the lesson's open improvement, which then has one plan, one AI draft,
 * one review and one save for all of it. Feedback answered with a reply and not used is done on its
 * own (`respondToCommentAction`). The open improvement takes feedback until it's saved on the
 * lesson; feedback used after its changes were drafted waits, and starts the next improvement when
 * they're saved (`startNextImprovement`). Improvements made before this (one per piece of feedback,
 * several lessons in one) finish as they are.
 */

const OPEN_STATUSES = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];
/** A draft for an improvement that's being written or waits for review. */
const DRAFTED = [AiProposalStatus.PENDING, AiProposalStatus.WORKING, AiProposalStatus.OPEN];
/** Drafted, counting what someone's Claude started by reading only while it's still heard from. */
const draftedWhere = () => ({ status: { in: DRAFTED }, NOT: { via: CONNECTOR_READ, updatedAt: { lt: new Date(Date.now() - GIVE_UP_MS) } } });

/**
 * The lesson's open improvement, or null: open, about this lesson only (not a brief, not several
 * lessons), and not saved on it yet. Where an earlier way of working left several, the oldest one
 * without changes drafted (else the oldest).
 */
export async function lessonImprovement(db: DbClient, lessonId: string): Promise<string | null> {
  const tasks = await db.task.findMany({
    where: {
      kind: TASK_KIND.curriculum,
      status: { in: OPEN_STATUSES },
      entityLinks: { some: { entityType: TASK_ENTITY_TYPE.lesson, entityId: lessonId, role: TASK_ENTITY_ROLE.subject } },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { id: true, entityLinks: { where: { entityType: TASK_ENTITY_TYPE.lesson }, select: { entityId: true, role: true } } },
  });
  if (!tasks.length) return null;
  const ids = tasks.map((task) => task.id);
  const [saved, drafted] = await Promise.all([
    db.lessonChange.findMany({ where: { lessonId, taskId: { in: ids } }, select: { taskId: true } }),
    db.aiProposal.findMany({
      where: { kind: AiProposalKind.LESSON_REVISION, targetId: lessonId, taskId: { in: ids }, ...draftedWhere() },
      select: { taskId: true },
    }),
  ]);
  return pickLessonImprovement(
    lessonId,
    tasks.map((task) => ({
      id: task.id,
      lessons: task.entityLinks.map((link) => ({ lessonId: link.entityId, role: link.role })),
      saved: saved.some((change) => change.taskId === task.id),
      drafted: drafted.some((draft) => draft.taskId === task.id),
    }))
  );
}

/** A new open improvement for a lesson: its lesson, copy, course and groups linked, no plan yet. */
async function createLessonImprovement(
  tx: TransactionClient,
  lessonId: string,
  input: { proposerName: string | null; createdById: string | null; groupIds: string[] }
) {
  const lesson = await tx.lesson.findUnique({
    where: { id: lessonId },
    select: { title: true, position: true, courseId: true, curriculumVersionId: true, curriculumVersion: { select: { ownerGroupId: true } }, course: { select: { organizationId: true } } },
  });
  if (!lesson) return null;
  const groupIds = Array.from(new Set([lesson.curriculumVersion.ownerGroupId, ...input.groupIds].filter((id): id is string => Boolean(id))));
  const task = await tx.task.create({
    data: {
      organizationId: lesson.course.organizationId,
      kind: TASK_KIND.curriculum,
      title: `Lesson ${lesson.position}: ${lesson.title}`.slice(0, 200),
      proposerName: input.proposerName,
      createdById: input.createdById,
      entityLinks: {
        create: [
          { entityType: TASK_ENTITY_TYPE.lesson, entityId: lessonId, role: TASK_ENTITY_ROLE.subject },
          { entityType: TASK_ENTITY_TYPE.curriculumVersion, entityId: lesson.curriculumVersionId, role: TASK_ENTITY_ROLE.subject },
          { entityType: TASK_ENTITY_TYPE.course, entityId: lesson.courseId, role: TASK_ENTITY_ROLE.subject },
          ...groupIds.map((groupId) => ({ entityType: TASK_ENTITY_TYPE.courseGroup, entityId: groupId, role: TASK_ENTITY_ROLE.subject })),
        ],
      },
    },
    select: { id: true },
  });
  return task.id;
}

/** The groups whose feedback an improvement holds are linked to it: how their instructors find it. */
async function linkGroups(tx: TransactionClient, taskId: string, groupIds: Array<string | null>) {
  for (const groupId of Array.from(new Set(groupIds.filter((id): id is string => Boolean(id))))) {
    await tx.taskEntityLink.upsert({
      where: { taskId_entityType_entityId_role: { taskId, entityType: TASK_ENTITY_TYPE.courseGroup, entityId: groupId, role: TASK_ENTITY_ROLE.subject } },
      create: { taskId, entityType: TASK_ENTITY_TYPE.courseGroup, entityId: groupId, role: TASK_ENTITY_ROLE.subject },
      update: {},
    });
  }
}

export type TakeUpFeedbackResult =
  | {
      ok: true;
      taskId: string;
      /** The lesson had no open improvement: this feedback started one. */
      created: boolean;
      /** Its changes are drafted already: this one waits for the next draft (or the next improvement). */
      afterDraft: boolean;
    }
  | { ok: false };

/**
 * "Use": the feedback joins its lesson's open improvement (started for it when there's none). It
 * stays open until the change reaches learners. Used again, it's where it is. Callers check the
 * person may work on the feedback.
 */
export async function takeUpFeedback(input: { commentId: string; createdById: string | null }): Promise<TakeUpFeedbackResult> {
  const comment = await prisma.curriculumComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, lessonId: true, groupId: true, proposerName: true, status: true },
  });
  if (!comment) return { ok: false };
  return prisma.$transaction(async (tx) => {
    // Two people using feedback on one lesson at once: the second waits, then joins the first's.
    await lockFor(tx, 'lessonImprovement', comment.lessonId);
    const existing = await tx.taskEntityLink.findFirst({
      where: { entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: comment.id, role: TASK_ENTITY_ROLE.source, task: { status: { in: OPEN_STATUSES } } },
      select: { taskId: true },
    });
    if (existing) return { ok: true as const, taskId: existing.taskId, created: false, afterDraft: false };
    // Done before (answered with a reply), used now: open again until the change reaches learners.
    if (comment.status === CurriculumCommentStatus.RESOLVED) {
      await tx.curriculumComment.update({ where: { id: comment.id }, data: { status: CurriculumCommentStatus.OPEN, resolvedAt: null } });
    }
    let taskId = await lessonImprovement(tx, comment.lessonId);
    const created = !taskId;
    taskId ??= await createLessonImprovement(tx, comment.lessonId, { proposerName: comment.proposerName, createdById: input.createdById, groupIds: [] });
    if (!taskId) return { ok: false as const };
    await tx.taskEntityLink.upsert({
      where: { taskId_entityType_entityId_role: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: comment.id, role: TASK_ENTITY_ROLE.source } },
      create: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: comment.id, role: TASK_ENTITY_ROLE.source },
      update: {},
    });
    await linkGroups(tx, taskId, [comment.groupId]);
    const afterDraft =
      !created &&
      (await tx.aiProposal.count({ where: { kind: AiProposalKind.LESSON_REVISION, targetId: comment.lessonId, taskId, ...draftedWhere() } })) > 0;
    return { ok: true as const, taskId, created, afterDraft };
  });
}

/**
 * "Don't use": the feedback leaves its open improvement (not once a saved change answers it) and is
 * new again. An improvement left with nothing to do (no feedback, plan, drafts or saved changes)
 * goes with it. Returns the improvement it left, or null.
 */
export async function stopUsingFeedback(commentId: string): Promise<{ taskId: string; removed: boolean } | null> {
  const link = await prisma.taskEntityLink.findFirst({
    where: { entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: commentId, role: TASK_ENTITY_ROLE.source, task: { status: { in: OPEN_STATUSES } } },
    select: { id: true, taskId: true },
  });
  if (!link) return null;
  if (await prisma.lessonChange.count({ where: { taskId: link.taskId, commentIds: { has: commentId } } })) return null;
  await prisma.taskEntityLink.delete({ where: { id: link.id } });
  const task = await prisma.task.findUnique({
    where: { id: link.taskId },
    select: {
      status: true,
      plan: true,
      description: true,
      _count: { select: { proposals: true } },
      entityLinks: { where: { entityType: TASK_ENTITY_TYPE.curriculumComment }, select: { id: true } },
    },
  });
  const empty =
    task &&
    task.status === TaskStatus.TODO &&
    !task.plan?.trim() &&
    !task.description?.trim() &&
    !task.entityLinks.length &&
    !task._count.proposals &&
    !(await prisma.lessonChange.count({ where: { taskId: link.taskId } }));
  if (empty) await prisma.task.delete({ where: { id: link.taskId } });
  return { taskId: link.taskId, removed: Boolean(empty) };
}

/** Whether the feedback is used: in an improvement (open, or finished with its change on the way). */
export async function isFeedbackUsed(db: DbClient, commentId: string) {
  return (
    (await db.taskEntityLink.count({
      where: { entityType: TASK_ENTITY_TYPE.curriculumComment, entityId: commentId, role: TASK_ENTITY_ROLE.source, task: { status: { not: TaskStatus.IGNORED } } },
    })) > 0
  );
}

/**
 * A save covered an improvement's changes on a lesson, and some of its feedback came after they
 * were drafted: that feedback starts the lesson's next improvement (or joins one already open). Run
 * inside the save's transaction, after it's recorded. Returns the improvement it went to, or null.
 */
export async function startNextImprovement(tx: TransactionClient, input: { fromTaskId: string; lessonId: string; commentIds: string[]; createdById: string | null }) {
  if (!input.commentIds.length) return null;
  await lockFor(tx, 'lessonImprovement', input.lessonId);
  const comments = await tx.curriculumComment.findMany({
    where: { id: { in: input.commentIds }, lessonId: input.lessonId, status: CurriculumCommentStatus.OPEN },
    orderBy: { createdAt: 'asc' },
    select: { id: true, groupId: true, proposerName: true },
  });
  if (!comments.length) return null;
  const taskId =
    (await lessonImprovement(tx, input.lessonId)) ??
    (await createLessonImprovement(tx, input.lessonId, { proposerName: comments[0].proposerName, createdById: input.createdById, groupIds: [] }));
  if (!taskId || taskId === input.fromTaskId) return null;
  await tx.taskEntityLink.updateMany({
    where: { taskId: input.fromTaskId, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source, entityId: { in: comments.map((comment) => comment.id) } },
    data: { taskId, createdAt: new Date() },
  });
  await linkGroups(tx, taskId, comments.map((comment) => comment.groupId));
  return { taskId, count: comments.length };
}

/**
 * Undo for a save of an improvement's changes: improvements on the lesson started since then with
 * nothing done yet (no plan, drafts or saved changes; the next one the save started, or one feedback
 * used since started) give their feedback back to it, so it's the lesson's open improvement again.
 */
export async function takeBackNextImprovements(db: DbClient, input: { taskId: string; lessonId: string; since: Date }) {
  const started = await db.task.findMany({
    where: {
      id: { not: input.taskId },
      kind: TASK_KIND.curriculum,
      status: TaskStatus.TODO,
      createdAt: { gte: input.since },
      entityLinks: { some: { entityType: TASK_ENTITY_TYPE.lesson, entityId: input.lessonId, role: TASK_ENTITY_ROLE.subject } },
    },
    select: {
      id: true,
      plan: true,
      description: true,
      _count: { select: { proposals: true } },
      entityLinks: { where: { entityType: { in: [TASK_ENTITY_TYPE.lesson, TASK_ENTITY_TYPE.courseGroup] } }, select: { entityType: true, entityId: true } },
    },
  });
  for (const task of started) {
    const lessons = task.entityLinks.filter((link) => link.entityType === TASK_ENTITY_TYPE.lesson);
    if (task.plan?.trim() || task.description?.trim() || task._count.proposals || lessons.some((link) => link.entityId !== input.lessonId)) continue;
    if (await db.lessonChange.count({ where: { taskId: task.id } })) continue;
    await db.taskEntityLink.updateMany({
      where: { taskId: task.id, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
      data: { taskId: input.taskId },
    });
    for (const link of task.entityLinks.filter((one) => one.entityType === TASK_ENTITY_TYPE.courseGroup)) {
      await db.taskEntityLink.upsert({
        where: { taskId_entityType_entityId_role: { taskId: input.taskId, entityType: link.entityType, entityId: link.entityId, role: TASK_ENTITY_ROLE.subject } },
        create: { taskId: input.taskId, entityType: link.entityType, entityId: link.entityId, role: TASK_ENTITY_ROLE.subject },
        update: {},
      });
    }
    await db.task.delete({ where: { id: task.id } });
  }
}
