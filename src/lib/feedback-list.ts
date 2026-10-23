import 'server-only';

import { CurriculumCommentStatus, TaskStatus, type Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from './tasks';

/**
 * Feedback as one list, wherever it shows (a group, a course, a lesson): learner feedback on passages
 * and the team's notes, each with what happened to it. A comment is open until someone marks it done
 * (or the task made from it is done); a reply and a task don't close it.
 */

/** Which comments a list shows: the open ones, or the done (resolved) ones. */
export type FeedbackState = 'open' | 'done';

/** What happened to an open comment so far: nothing yet, a reply, or a task that is being worked on. */
export type FeedbackStage = 'new' | 'replied' | 'task' | 'done';

export type FeedbackRow = {
  id: string;
  proposerName: string;
  /** A note from the team, not learner feedback. */
  isInstructorNote: boolean;
  /** The learner on the group's roster who wrote it (null: an instructor note, or its learner left the roster). */
  memberId: string | null;
  /**
   * Learner feedback that isn't on its learner's current link: its learner left the roster
   * (src/lib/unattached-feedback.ts), or it came through a link made again for them since.
   */
  needsLink: boolean;
  selectedText: string;
  body: string;
  status: 'OPEN' | 'RESOLVED';
  stage: FeedbackStage;
  adminResponse: string | null;
  createdAt: string;
  resolvedAt: string | null;
  courseId: string;
  courseTitle: string;
  versionId: string;
  versionLabel: string;
  /** The group whose copy of the lessons it is on (null: the course's own lessons). */
  copyOfGroupId: string | null;
  /** The group it came from: a learner's group, the group a note was written for, or the copy's group. */
  groupId: string | null;
  groupName: string | null;
  lessonId: string;
  lessonTitle: string;
  lessonPosition: number;
  /** The groups it belongs to (for who may work on it). */
  groupIds: string[];
  /** The task made from it, if any, and when it last changed a lesson (for "the lesson was changed"). */
  task: { id: string; title: string; status: TaskStatus; changedAt: string | null } | null;
};

const OPEN_TASK: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];

const SELECT = {
  id: true,
  proposerName: true,
  isInstructorNote: true,
  memberId: true,
  accessLinkId: true,
  selectedText: true,
  body: true,
  status: true,
  adminResponse: true,
  createdAt: true,
  resolvedAt: true,
  groupId: true,
  group: { select: { name: true } },
  lesson: { select: { id: true, title: true, position: true } },
  curriculumVersion: {
    select: {
      id: true,
      label: true,
      ownerGroupId: true,
      ownerGroup: { select: { name: true } },
      course: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.CurriculumCommentSelect;

/** Feedback on a group: from its learners and notes for it (on any lessons), and anything on its own copy. */
export function groupFeedbackWhere(groupId: string): Prisma.CurriculumCommentWhereInput {
  return { OR: [{ groupId }, { curriculumVersion: { ownerGroupId: groupId } }] };
}

/** Feedback on a course: every version's, the groups' copies included. */
export function courseFeedbackWhere(courseId: string): Prisma.CurriculumCommentWhereInput {
  return { curriculumVersion: { courseId } };
}

function stateWhere(state: FeedbackState): Prisma.CurriculumCommentWhereInput {
  return state === 'done' ? { status: CurriculumCommentStatus.RESOLVED } : { status: CurriculumCommentStatus.OPEN };
}

/** The task made from each of these comments (the latest, when there are several). */
async function tasksFor(commentIds: string[]) {
  if (!commentIds.length) return new Map<string, FeedbackRow['task']>();
  const links = await prisma.taskEntityLink.findMany({
    where: { entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source, entityId: { in: commentIds } },
    orderBy: { createdAt: 'asc' },
    select: { entityId: true, task: { select: { id: true, title: true, status: true } } },
  });
  const done = Array.from(new Set(links.filter((link) => link.task.status === TaskStatus.DONE).map((link) => link.task.id)));
  const changed = done.length
    ? await prisma.lessonChange.groupBy({ by: ['taskId'], where: { taskId: { in: done } }, _max: { createdAt: true } })
    : [];
  const changedAt = new Map(changed.map((row) => [row.taskId, row._max.createdAt?.toISOString() ?? null]));
  return new Map(links.map((link) => [link.entityId, { ...link.task, changedAt: changedAt.get(link.task.id) ?? null }]));
}

/** Each of these learners' current link: their newest one that still works. */
async function currentLinks(memberIds: string[]) {
  if (!memberIds.length) return new Map<string, string>();
  const links = await prisma.accessLink.findMany({
    where: { memberId: { in: memberIds }, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, memberId: true },
  });
  return new Map(links.map((link) => [link.memberId ?? '', link.id]));
}

/**
 * The comments in `where` (already limited to what the viewer may see) in this state, newest first.
 * `take`: only the newest ones; `after`: the ones after this comment (the last of the page before),
 * to read a long list page by page.
 */
export async function listFeedback(
  where: Prisma.CurriculumCommentWhereInput,
  state: FeedbackState,
  options: { take?: number; after?: string } = {}
): Promise<FeedbackRow[]> {
  const comments = await prisma.curriculumComment.findMany({
    where: { AND: [where, stateWhere(state)] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(options.take ? { take: options.take } : {}),
    ...(options.after ? { cursor: { id: options.after }, skip: 1 } : {}),
    select: SELECT,
  });
  const [tasks, links, changing] = await Promise.all([
    tasksFor(comments.map((comment) => comment.id)),
    currentLinks(Array.from(new Set(comments.flatMap((comment) => (comment.memberId ? [comment.memberId] : []))))),
    commentsInUnpublishedChanges(comments.filter((comment) => comment.status === CurriculumCommentStatus.OPEN).map((comment) => comment.id)),
  ]);
  return comments.map((comment) => {
    const version = comment.curriculumVersion;
    const task = tasks.get(comment.id) ?? null;
    const groupId = comment.groupId ?? version.ownerGroupId;
    return {
      id: comment.id,
      proposerName: comment.proposerName,
      isInstructorNote: comment.isInstructorNote,
      memberId: comment.memberId,
      needsLink:
        !comment.isInstructorNote &&
        comment.groupId !== null &&
        (comment.memberId === null || (links.has(comment.memberId) && links.get(comment.memberId) !== comment.accessLinkId)),
      selectedText: comment.selectedText,
      body: comment.body,
      status: comment.status,
      stage:
        comment.status === CurriculumCommentStatus.RESOLVED
          ? 'done'
          : (task && OPEN_TASK.includes(task.status)) || changing.has(comment.id)
            ? 'task'
            : comment.adminResponse
              ? 'replied'
              : 'new',
      adminResponse: comment.adminResponse,
      createdAt: comment.createdAt.toISOString(),
      resolvedAt: comment.resolvedAt?.toISOString() ?? null,
      courseId: version.course.id,
      courseTitle: version.course.title,
      versionId: version.id,
      versionLabel: version.label,
      copyOfGroupId: version.ownerGroupId,
      groupId,
      groupName: comment.group?.name ?? version.ownerGroup?.name ?? null,
      lessonId: comment.lesson.id,
      lessonTitle: comment.lesson.title,
      lessonPosition: comment.lesson.position,
      groupIds: [comment.groupId, version.ownerGroupId].filter((id): id is string => Boolean(id)),
      task,
    };
  });
}

/** How many comments in `where` are open and done. */
export async function countFeedback(where: Prisma.CurriculumCommentWhereInput) {
  const counts = await prisma.curriculumComment.groupBy({ by: ['status'], where, _count: { _all: true } });
  const of = (status: CurriculumCommentStatus) => counts.find((row) => row.status === status)?._count._all ?? 0;
  return { open: of(CurriculumCommentStatus.OPEN), done: of(CurriculumCommentStatus.RESOLVED) };
}

/**
 * Open comments a saved change answers that hasn't reached learners yet (a lesson saved as a draft):
 * they are being changed, and are marked done when it is published.
 */
async function commentsInUnpublishedChanges(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const changes = await prisma.lessonChange.findMany({
    where: { settledAt: null, commentIds: { hasSome: ids } },
    select: { commentIds: true },
  });
  const wanted = new Set(ids);
  return new Set(changes.flatMap((change) => change.commentIds.filter((id) => wanted.has(id))));
}

/** Comments that tasks still being worked on were made from (few: only open tasks). */
async function commentsWithOpenTasks(): Promise<string[]> {
  const links = await prisma.taskEntityLink.findMany({
    where: {
      entityType: TASK_ENTITY_TYPE.curriculumComment,
      role: TASK_ENTITY_ROLE.source,
      task: { status: { in: OPEN_TASK } },
    },
    select: { entityId: true },
  });
  return links.map((link) => link.entityId);
}

/** Comments answered by saved changes that haven't reached learners yet (few: only unpublished saves). */
async function commentsInUnsettledChanges(): Promise<string[]> {
  const changes = await prisma.lessonChange.findMany({ where: { settledAt: null }, select: { commentIds: true }, take: 500 });
  return changes.flatMap((change) => change.commentIds);
}

/**
 * Open comments in `where`, counted in the database (no rows loaded): those with a group by group,
 * and those without one (notes and feedback on the course's own lessons or on a copy) by version.
 * `unanswered`: only the ones nobody has acted on yet (no reply, no task being worked on), for
 * "Needs you".
 */
export async function countOpenFeedback(
  where: Prisma.CurriculumCommentWhereInput,
  options: { unanswered?: boolean } = {}
): Promise<{ byGroup: Map<string, number>; byVersion: Map<string, number> }> {
  const taken = options.unanswered ? [...(await commentsWithOpenTasks()), ...(await commentsInUnsettledChanges())] : [];
  const open: Prisma.CurriculumCommentWhereInput = {
    AND: [
      where,
      { status: CurriculumCommentStatus.OPEN },
      options.unanswered ? { adminResponse: null } : {},
      taken.length ? { id: { notIn: taken } } : {},
    ],
  };
  const [groups, versions] = await Promise.all([
    prisma.curriculumComment.groupBy({
      by: ['groupId'],
      where: { AND: [open, { groupId: { not: null } }] },
      _count: { _all: true },
    }),
    prisma.curriculumComment.groupBy({
      by: ['curriculumVersionId'],
      where: { AND: [open, { groupId: null }] },
      _count: { _all: true },
    }),
  ]);
  return {
    byGroup: new Map(groups.flatMap((row) => (row.groupId ? [[row.groupId, row._count._all] as const] : []))),
    byVersion: new Map(versions.map((row) => [row.curriculumVersionId, row._count._all] as const)),
  };
}

/** Open comments per lesson, among `where` (a lesson list's counts). */
export async function countOpenFeedbackByLesson(where: Prisma.CurriculumCommentWhereInput) {
  const rows = await prisma.curriculumComment.groupBy({
    by: ['lessonId'],
    where: { AND: [where, { status: CurriculumCommentStatus.OPEN }] },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.lessonId, row._count._all]));
}
