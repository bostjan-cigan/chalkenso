import 'server-only';

import { CurriculumCommentStatus, TaskStatus, TaskWorkplace, type Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { can, grantsFromMembership } from './access-rules';
import { planBody } from './plan-scope';
import { GRANT_ENTITY_TYPES } from './grant-scopes';
import { prisma } from './prisma';
import { getUserProfileImageUrl } from './profile-image';

/** Human-readable name for a user (full name, else login identifier). */
export function userDisplayName(user: {
  firstName: string | null;
  lastName: string | null;
  identifier: string;
}): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.identifier;
}

/** Task kinds (free-form `Task.kind`); a label/filter, not a table. */
export const TASK_KIND = {
  curriculum: 'curriculum',
} as const;

export type TaskKind = (typeof TASK_KIND)[keyof typeof TASK_KIND];

/**
 * Where a task sits, for its card ("Course › Group Evening › Lesson 3", put in words by the board):
 * the course, the group whose copy it revises or else the version, the lesson's position.
 */
export type TaskContext = { course: string; group: string | null; version: string | null; lesson: number | null };

/**
 * One board lane per CRM section. To give a new section its own lane, add its kind to `TASK_KIND`
 * and an entry here (order = lane order on the board), with its words in `tasks.kinds.<kind>` (its
 * label, and the hint an empty lane shows: how tasks of this kind get created). Tasks whose kind is
 * not registered still show up, in a fallback lane.
 */
type TaskKindDefinition = {
  kind: TaskKind;
  /** The card's context line, from the task's resolved refs. */
  context: (refs: ResolvedCurriculumRefs) => TaskContext | null;
};

function curriculumContext(refs: ResolvedCurriculumRefs): TaskContext | null {
  if (!refs.course) {
    return null;
  }
  return {
    course: refs.course.title,
    group: refs.version?.group?.name ?? null,
    version: refs.version && !refs.version.group ? refs.version.label : null,
    lesson: refs.lesson?.position ?? null,
  };
}

export const TASK_KIND_DEFINITIONS: TaskKindDefinition[] = [
  {
    kind: TASK_KIND.curriculum,
    context: curriculumContext,
  },
];

function taskKindDefinition(kind: string): TaskKindDefinition | null {
  return TASK_KIND_DEFINITIONS.find((definition) => definition.kind === kind) ?? null;
}

/** Entity types used in `TaskEntityLink.entityType` (resolved per type at read time, no FK). */
export const TASK_ENTITY_TYPE = {
  course: 'course',
  curriculumVersion: 'curriculum_version',
  lesson: 'lesson',
  curriculumComment: 'curriculum_comment',
  /** Another task, e.g. the group task a core proposal was made from. */
  task: 'task',
  /** The group whose feedback (or curriculum copy) the task is about: how its instructors find it. */
  courseGroup: 'course_group',
} as const;

/** How a linked entity relates to the task. */
export const TASK_ENTITY_ROLE = {
  subject: 'subject',
  source: 'source',
  /** The task is the lesson's overall revision brief rather than a single feedback item. */
  brief: 'brief',
} as const;

/**
 * Move a task through its lifecycle; stamps `completedAt` on DONE and clears it otherwise. Done by
 * hand, the feedback it was made from is done too (resolved), so its learner sees the change was
 * made. `resolveSources: false` leaves that to the lesson change reaching learners
 * (`src/lib/lesson-changes.ts`), or to an Undo putting things back.
 */
export async function updateTaskStatus(taskId: string, status: TaskStatus, { resolveSources = true }: { resolveSources?: boolean } = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === TaskStatus.DONE ? new Date() : null,
      },
    });
    if (status === TaskStatus.DONE && resolveSources) {
      const sources = await tx.taskEntityLink.findMany({
        where: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
        select: { entityId: true },
      });
      if (sources.length) {
        await tx.curriculumComment.updateMany({
          where: { id: { in: sources.map((link) => link.entityId) }, status: CurriculumCommentStatus.OPEN },
          data: { status: CurriculumCommentStatus.RESOLVED, resolvedAt: new Date() },
        });
      }
    }
  });
}

type RawTaskLink = { entityType: string; entityId: string; role: string };

/** Curriculum coordinates resolved from a task's links, for display. */
export type ResolvedCurriculumRefs = {
  course: { id: string; title: string } | null;
  /** `group` is set when the version is a group's own curriculum (the task is a group revision). */
  version: {
    id: string;
    label: string;
    group: { id: string; name: string } | null;
    baseVersionId: string | null;
  } | null;
  lesson: { id: string; title: string; position: number } | null;
  commentId: string | null;
};

/**
 * Batch-resolves the display names behind curriculum entity links for a set of tasks. Kept generic:
 * only the entity types it knows are hydrated, so new kinds degrade to bare ids rather than breaking.
 */
async function resolveCurriculumRefs(
  linksByTask: Map<string, RawTaskLink[]>
): Promise<Map<string, ResolvedCurriculumRefs>> {
  const courseIds = new Set<string>();
  const versionIds = new Set<string>();
  const lessonIds = new Set<string>();

  linksByTask.forEach((links) => {
    for (const link of links) {
      if (link.entityType === TASK_ENTITY_TYPE.course) courseIds.add(link.entityId);
      if (link.entityType === TASK_ENTITY_TYPE.curriculumVersion)
        versionIds.add(link.entityId);
      if (link.entityType === TASK_ENTITY_TYPE.lesson) lessonIds.add(link.entityId);
    }
  });

  const [courses, versions, lessons] = await Promise.all([
    courseIds.size
      ? prisma.course.findMany({
          where: { id: { in: Array.from(courseIds) } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    versionIds.size
      ? prisma.curriculumVersion
          .findMany({
            where: { id: { in: Array.from(versionIds) } },
            select: {
              id: true,
              label: true,
              baseVersionId: true,
              ownerGroup: { select: { id: true, name: true } },
            },
          })
          .then((rows) =>
            rows.map(({ ownerGroup, ...version }) => ({ ...version, group: ownerGroup }))
          )
      : Promise.resolve([]),
    lessonIds.size
      ? prisma.lesson.findMany({
          where: { id: { in: Array.from(lessonIds) } },
          select: { id: true, title: true, position: true },
        })
      : Promise.resolve([]),
  ]);

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const lessonById = new Map(lessons.map((l) => [l.id, l]));

  const result = new Map<string, ResolvedCurriculumRefs>();

  linksByTask.forEach((links, taskId) => {
    let course: ResolvedCurriculumRefs['course'] = null;
    let version: ResolvedCurriculumRefs['version'] = null;
    let lesson: ResolvedCurriculumRefs['lesson'] = null;
    let commentId: string | null = null;

    for (const link of links) {
      if (link.entityType === TASK_ENTITY_TYPE.course)
        course = courseById.get(link.entityId) ?? null;
      if (link.entityType === TASK_ENTITY_TYPE.curriculumVersion)
        version = versionById.get(link.entityId) ?? null;
      // Several lessons (one improvement for all of them): the first one it was made for.
      if (link.entityType === TASK_ENTITY_TYPE.lesson && !lesson)
        lesson = lessonById.get(link.entityId) ?? null;
      if (link.entityType === TASK_ENTITY_TYPE.curriculumComment)
        commentId = link.entityId;
    }

    result.set(taskId, { course, version, lesson, commentId });
  });

  return result;
}

export type TaskListItem = {
  id: string;
  kind: string;
  title: string;
  status: TaskStatus;
  proposerName: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  refs: ResolvedCurriculumRefs;
  /** Card context line, from the task's kind definition. */
  context: TaskContext | null;
  /** Whose curriculum the task revises; null when it is not tied to a curriculum version. */
  scope: TaskScope | null;
  /** The course it belongs to and the groups it is about (for who may see and work on it). */
  courseId: string | null;
  groupIds: string[];
  assignee: TaskAssignee | null;
  /** The core proposal made from this task, when the list was built with `withProposals`. */
  proposal: RelatedTask | null;
  /** A revision plan has been synced back from Obsidian: the task is ready to execute. */
  hasPlan: boolean;
  /** Cleared for the local agent to execute on its own (see `Task.aiReady`). */
  aiReady: boolean;
  /** Discussion notes on the task. */
  commentCount: number;
};

export type TaskAssignee = { id: string; name: string; avatarUrl: string | null };

/** A core revision (shared curriculum) or a group revision (one group's own copy). */
export type TaskScope = { kind: 'core' } | { kind: 'group'; groupId: string; groupName: string };

function taskScope(refs: ResolvedCurriculumRefs): TaskScope | null {
  if (!refs.version) {
    return null;
  }
  return refs.version.group
    ? { kind: 'group', groupId: refs.version.group.id, groupName: refs.version.group.name }
    : { kind: 'core' };
}

const ASSIGNEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  identifier: true,
  profileImageKey: true,
} as const;

function toTaskAssignee(
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    identifier: string;
    profileImageKey: string | null;
  } | null
): TaskAssignee | null {
  return user
    ? {
        id: user.id,
        name: userDisplayName(user),
        avatarUrl: getUserProfileImageUrl(user.id, user.profileImageKey),
      }
    : null;
}

const EMPTY_REFS: ResolvedCurriculumRefs = {
  course: null,
  version: null,
  lesson: null,
  commentId: null,
};

/**
 * Batch-resolves, for each given task, the core proposal made from it (the task that links back to
 * it as its `source`). One query for the whole list: the batched form of what `getTask` resolves
 * for a single task.
 */
async function resolveProposedForCore(taskIds: string[]): Promise<Map<string, RelatedTask>> {
  if (!taskIds.length) {
    return new Map();
  }
  const sourceIds = new Set(taskIds);
  const proposals = await prisma.task.findMany({
    where: {
      entityLinks: {
        some: {
          entityType: TASK_ENTITY_TYPE.task,
          role: TASK_ENTITY_ROLE.source,
          entityId: { in: taskIds },
        },
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      entityLinks: {
        where: { entityType: TASK_ENTITY_TYPE.task, role: TASK_ENTITY_ROLE.source },
        select: { entityId: true },
      },
    },
  });

  const bySourceId = new Map<string, RelatedTask>();
  for (const { entityLinks, ...related } of proposals) {
    for (const link of entityLinks) {
      // `entityId` is the group task this proposal was made from.
      if (sourceIds.has(link.entityId) && !bySourceId.has(link.entityId)) {
        bySourceId.set(link.entityId, related);
      }
    }
  }
  return bySourceId;
}

export type TaskListFilter = {
  status?: TaskStatus;
  kind?: string;
  /**
   * Permission/lane scope: `null` or omitted = every task, `[]` = none. Filters on the task's
   * `curriculum_version` link, so the database does the narrowing and only visible rows get their
   * refs hydrated. Note `some` matches *any* version link while `refs.version` resolves the last
   * one — the same thing today, because `createTaskFromComment`, `proposeTaskForCore` and
   * `upsertLessonBrief` each create exactly one version link per task.
   */
  versionIds?: string[] | null;
  /** Who may see what (`taskScopeWhere` in crm-access); omitted = every task. */
  where?: Prisma.TaskWhereInput;
  /** Also resolve the core proposal each task spawned (one extra query for the whole list). */
  withProposals?: boolean;
  /**
   * Only the most recently finished this-many DONE tasks (open and ignored ones all come): finished
   * work piles up forever, and the board shows the latest. Omitted = every DONE task.
   */
  doneLimit?: number;
};

const TASK_LIST_SELECT = {
  id: true,
  kind: true,
  title: true,
  status: true,
  proposerName: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  entityLinks: { select: { entityType: true, entityId: true, role: true } },
  assignee: { select: ASSIGNEE_SELECT },
  aiReady: true,
  _count: { select: { comments: true } },
} satisfies Prisma.TaskSelect;

/** Which of these tasks have a revision plan, without loading the plans (the board never shows them). */
async function tasksWithPlans(taskIds: string[]): Promise<Set<string>> {
  if (!taskIds.length) {
    return new Set();
  }
  const rows = await prisma.task.findMany({
    where: { id: { in: taskIds }, plan: { not: null }, NOT: { plan: '' } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Admin: list tasks (optionally filtered), newest first, with resolved curriculum refs. */
export async function listTasks(filter?: TaskListFilter): Promise<TaskListItem[]> {
  const where: Prisma.TaskWhereInput = {
    ...(filter?.status ? { status: filter.status } : {}),
    ...(filter?.kind ? { kind: filter.kind } : {}),
    ...(filter?.versionIds
      ? {
          entityLinks: {
            some: {
              entityType: TASK_ENTITY_TYPE.curriculumVersion,
              entityId: { in: filter.versionIds },
            },
          },
        }
      : {}),
    ...(filter?.where ? { AND: [filter.where] } : {}),
  };
  const newestFirst = { createdAt: 'desc' } as const;

  const tasks =
    filter?.doneLimit === undefined
      ? await prisma.task.findMany({ where, orderBy: newestFirst, select: TASK_LIST_SELECT })
      : await Promise.all([
          prisma.task.findMany({
            where: { AND: [where, { status: { not: TaskStatus.DONE } }] },
            orderBy: newestFirst,
            select: TASK_LIST_SELECT,
          }),
          prisma.task.findMany({
            where: { AND: [where, { status: TaskStatus.DONE }] },
            orderBy: [{ completedAt: { sort: 'desc', nulls: 'last' } }, newestFirst],
            take: filter.doneLimit,
            select: TASK_LIST_SELECT,
          }),
        ]).then(([open, done]) =>
          [...open, ...done].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        );

  const linksByTask = new Map(tasks.map((t) => [t.id, t.entityLinks]));
  const [refsByTask, proposalByTask, planned] = await Promise.all([
    resolveCurriculumRefs(linksByTask),
    filter?.withProposals
      ? resolveProposedForCore(tasks.map((task) => task.id))
      : Promise.resolve(new Map<string, RelatedTask>()),
    tasksWithPlans(tasks.map((task) => task.id)),
  ]);

  return tasks.map((task) => {
    const refs = refsByTask.get(task.id) ?? EMPTY_REFS;
    const scope = taskScope(refs);
    return {
      id: task.id,
      kind: task.kind,
      title: task.title,
      status: task.status,
      proposerName: task.proposerName,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      refs,
      context: taskKindDefinition(task.kind)?.context(refs) ?? null,
      scope,
      ...taskOwners(task.entityLinks, refs, scope),
      assignee: toTaskAssignee(task.assignee),
      proposal: proposalByTask.get(task.id) ?? null,
      hasPlan: planned.has(task.id),
      aiReady: task.aiReady,
      commentCount: task._count.comments,
    };
  });
}

/** A task's course and groups, from its links (a group copy counts as its group). */
function taskOwners(
  links: Array<{ entityType: string; entityId: string }>,
  refs: ResolvedCurriculumRefs,
  scope: TaskScope | null
): { courseId: string | null; groupIds: string[] } {
  const groupIds = links.filter((link) => link.entityType === TASK_ENTITY_TYPE.courseGroup).map((link) => link.entityId);
  if (scope?.kind === 'group') groupIds.push(scope.groupId);
  const courseLink = links.find((link) => link.entityType === TASK_ENTITY_TYPE.course);
  return { courseId: courseLink?.entityId ?? refs.course?.id ?? null, groupIds: Array.from(new Set(groupIds)) };
}

/** A board card's compact age, in whole units ('today', '3d', '2w', '5mo' once in words). */
export type TaskAge = { unit: 'today' | 'days' | 'weeks' | 'months' | 'years'; count: number };

export function taskAge(iso: string, now: Date = new Date()): TaskAge {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return { unit: 'today', count: 0 };
  if (days < 7) return { unit: 'days', count: days };
  if (days < 31) return { unit: 'weeks', count: Math.floor(days / 7) };
  if (days < 365) return { unit: 'months', count: Math.floor(days / 30) };
  return { unit: 'years', count: Math.floor(days / 365) };
}

/** Days an open task may sit before the board flags it. */
const STALE_WARN_DAYS = 14;
const STALE_ALERT_DAYS = 30;

export type TaskStaleness = 'none' | 'warn' | 'alert';

/**
 * How long an *open* task has been waiting. Done and ignored tasks are never stale — they are
 * finished, so age carries no signal.
 */
export function taskStaleness(
  task: { status: TaskStatus; createdAt: string },
  now: Date = new Date()
): TaskStaleness {
  if (task.status !== TaskStatus.TODO && task.status !== TaskStatus.IN_PROGRESS) {
    return 'none';
  }
  const days = (now.getTime() - new Date(task.createdAt).getTime()) / 86_400_000;
  if (days >= STALE_ALERT_DAYS) return 'alert';
  if (days >= STALE_WARN_DAYS) return 'warn';
  return 'none';
}

/** Tasks on one curriculum version (e.g. a group's own curriculum), with their core proposals. */
export function listTasksForVersion(versionId: string): Promise<TaskListItem[]> {
  return listTasks({ versionIds: [versionId], withProposals: true });
}

/**
 * Tasks about one group: from its learners' feedback (also on the core curriculum it reads) and on
 * its own copy, with their core proposals.
 */
export function listTasksForGroup(groupId: string, kind?: string): Promise<TaskListItem[]> {
  return listTasks({
    kind,
    where: { entityLinks: { some: { entityType: TASK_ENTITY_TYPE.courseGroup, entityId: groupId } } },
    withProposals: true,
  });
}

/** Enough of a curriculum version to authorize triage on it (see `canTriageVersion`). */
export type TaskLaneVersionRef = { id: string; courseId: string; ownerGroupId: string | null };

/** One board lane per curriculum: a course's own lessons, or one group's own copy. */
export type TaskLane = {
  /** Stable lane identity: `course:${courseId}` | `group:${groupId}` | 'unscoped'. Drag containment + deep links. */
  id: string;
  kind: string;
  /** The course's title (its own lessons), or the group's name. */
  label: string;
  /** Course title, plus "Closed" for an archived group curriculum (in the viewer's language). */
  sublabel: string | null;
  /** The group this lane belongs to, when it has one. */
  href: string | null;
  versionRef: TaskLaneVersionRef | null;
  /** The lane's group and course (for who may work on its tasks); null for the core and untied lanes. */
  groupId: string | null;
  courseId: string | null;
  emptyHint: string;
  /** TODO + IN_PROGRESS: what the board collapses a quiet lane on. */
  openCount: number;
  tasks: TaskListItem[];
};

export const TASK_LANE_ID = {
  unscoped: 'unscoped',
} as const;

/** Lane id for a course's own lessons. */
export function courseTaskLaneId(courseId: string): string {
  return `course:${courseId}`;
}

/** The board's words for its lanes (`tasks`), in the viewer's language. */
const laneWords = () => getTranslations('tasks');
type LaneWords = Awaited<ReturnType<typeof laneWords>>;

/** A course's own lessons, as a lane (even with no tasks: its empty hint says where tasks come from). */
function courseLane(kind: string, course: { id: string; title: string }, tasks: TaskListItem[], t: LaneWords): TaskLane {
  const definition = taskKindDefinition(kind);
  return {
    id: courseTaskLaneId(course.id),
    kind,
    label: course.title,
    sublabel: t('lanes.courseOwn'),
    href: `/admin/courses/${course.id}/feedback?show=change`,
    versionRef: null,
    groupId: null,
    courseId: course.id,
    emptyHint: definition ? t(`kinds.${definition.kind}.emptyHint`) : '',
    openCount: openTaskCount(tasks),
    tasks,
  };
}

/** Lane id for a group's own curriculum. */
export function groupTaskLaneId(groupId: string): string {
  return `group:${groupId}`;
}

function openTaskCount(tasks: TaskListItem[]): number {
  return tasks.filter(
    (task) => task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS
  ).length;
}

/** What the board may show (`accessScope` in crm-access): everything, or granted courses and groups. */
export type TaskLaneScope = { all: true } | { all: false; courses: '*' | string[]; groups: string[] };

/**
 * Admin: tasks of one kind grouped into one lane per curriculum — the shared core first, then every
 * group that has its own curriculum (even with no tasks, so the lane shows its empty hint). Lanes
 * are a view over `Task.kind` + the task's `curriculum_version` link; no per-kind table is touched.
 *
 * A limited viewer (`scope.all` false) gets only their courses' and groups' tasks (`where`): a core
 * lane for whole courses, their groups' copies, and a lane per group of theirs that reads the core
 * curriculum (its learners' feedback on core lessons).
 */
export async function listCurriculumTaskLanes(options: {
  kind: string;
  scope: TaskLaneScope;
  /** The limited viewer's task filter (`taskScopeWhere`); ignored for `scope.all`. */
  where?: Prisma.TaskWhereInput;
  /** At most this many DONE tasks, the most recently finished (`TaskListFilter.doneLimit`). */
  doneLimit?: number;
}): Promise<TaskLane[]> {
  const t = await laneWords();
  return options.scope.all
    ? listAllTaskLanes(options.kind, t, options.doneLimit)
    : listScopedTaskLanes(options.kind, options.scope, options.where ?? { id: { in: [] } }, t, options.doneLimit);
}

async function listAllTaskLanes(kind: string, t: LaneWords, doneLimit?: number): Promise<TaskLane[]> {
  const [tasks, groups, courses] = await Promise.all([
    listTasks({ kind, withProposals: true, doneLimit }),
    prisma.courseGroup.findMany({
      where: { groupCurriculum: { isNot: null } },
      orderBy: [{ course: { title: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        course: { select: { id: true, title: true } },
        groupCurriculum: { select: { id: true, courseId: true, archivedAt: true } },
      },
    }),
    prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true } }),
  ]);

  const tasksByLane = new Map<string, TaskListItem[]>();
  for (const task of tasks) {
    const laneId = !task.scope
      ? TASK_LANE_ID.unscoped
      : task.scope.kind === 'core'
        ? task.courseId
          ? courseTaskLaneId(task.courseId)
          : TASK_LANE_ID.unscoped
        : groupTaskLaneId(task.scope.groupId);
    const bucket = tasksByLane.get(laneId);
    if (bucket) {
      bucket.push(task);
    } else {
      tasksByLane.set(laneId, [task]);
    }
  }

  const takeLaneTasks = (laneId: string): TaskListItem[] => {
    const laneTasks = tasksByLane.get(laneId) ?? [];
    tasksByLane.delete(laneId);
    return laneTasks;
  };

  // Each course's own lessons, then the groups' copies.
  const coreLanes: TaskLane[] = courses.map((course) => courseLane(kind, course, takeLaneTasks(courseTaskLaneId(course.id)), t));

  const activeLanes: TaskLane[] = [];
  const closedLanes: TaskLane[] = [];
  for (const group of groups) {
    const curriculum = group.groupCurriculum;
    if (!curriculum) {
      continue;
    }
    const laneTasks = takeLaneTasks(groupTaskLaneId(group.id));
    const closed = curriculum.archivedAt !== null;
    // Otherwise every finished cohort leaves a dead lane on the board forever.
    if (closed && laneTasks.length === 0) {
      continue;
    }
    (closed ? closedLanes : activeLanes).push({
      id: groupTaskLaneId(group.id),
      kind,
      label: group.name,
      sublabel: [group.course.title, closed ? t('lanes.closed') : null].filter(Boolean).join(' · '),
      href: `/admin/courses/groups/${group.id}`,
      versionRef: { id: curriculum.id, courseId: curriculum.courseId, ownerGroupId: group.id },
      groupId: group.id,
      courseId: group.course.id,
      emptyHint: t('lanes.groupEmpty'),
      openCount: openTaskCount(laneTasks),
      tasks: laneTasks,
    });
  }

  // Whatever is left has no skeleton row (a deleted curriculum). Appended rather than dropped, so
  // no task is ever invisible.
  const { orphanLanes, unscopedLane } = leftoverLanes(kind, tasksByLane, t);
  const lanes = [...coreLanes, ...activeLanes, ...closedLanes, ...orphanLanes];
  if (unscopedLane) {
    lanes.push(unscopedLane);
  }
  return lanes;
}

async function listScopedTaskLanes(
  kind: string,
  scope: { courses: '*' | string[]; groups: string[] },
  where: Prisma.TaskWhereInput,
  t: LaneWords,
  doneLimit?: number
): Promise<TaskLane[]> {
  const wholeCourse = (courseId: string | null) =>
    Boolean(courseId) && (scope.courses === '*' || scope.courses.includes(courseId as string));
  const [tasks, groups, courses] = await Promise.all([
    listTasks({ kind, where, withProposals: true, doneLimit }),
    prisma.courseGroup.findMany({
      where:
        scope.courses === '*'
          ? {}
          : { OR: [{ courseId: { in: scope.courses } }, { id: { in: scope.groups } }] },
      orderBy: [{ course: { title: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        course: { select: { id: true, title: true } },
        groupCurriculum: { select: { id: true, courseId: true, archivedAt: true } },
      },
    }),
    scope.courses === '*' || scope.courses.length
      ? prisma.course.findMany({
          where: scope.courses === '*' ? {} : { id: { in: scope.courses } },
          orderBy: { title: 'asc' },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
  ]);

  const tasksByLane = new Map<string, TaskListItem[]>();
  for (const task of tasks) {
    // A core task goes to its course's lane for whole courses; otherwise to the viewer's group it came from.
    const laneId =
      task.scope?.kind === 'group'
        ? groupTaskLaneId(task.scope.groupId)
        : wholeCourse(task.courseId)
          ? courseTaskLaneId(task.courseId as string)
          : groupTaskLaneId(task.groupIds.find((id) => scope.groups.includes(id)) ?? task.groupIds[0] ?? '');
    const bucket = tasksByLane.get(laneId);
    if (bucket) {
      bucket.push(task);
    } else {
      tasksByLane.set(laneId, [task]);
    }
  }
  const takeLaneTasks = (laneId: string): TaskListItem[] => {
    const laneTasks = tasksByLane.get(laneId) ?? [];
    tasksByLane.delete(laneId);
    return laneTasks;
  };

  const lanes: TaskLane[] = courses.map((course) => courseLane(kind, course, takeLaneTasks(courseTaskLaneId(course.id)), t));

  const closedLanes: TaskLane[] = [];
  for (const group of groups) {
    const curriculum = group.groupCurriculum;
    const laneTasks = takeLaneTasks(groupTaskLaneId(group.id));
    if (curriculum) {
      const closed = curriculum.archivedAt !== null;
      if (closed && laneTasks.length === 0) {
        continue;
      }
      (closed ? closedLanes : lanes).push({
        id: groupTaskLaneId(group.id),
        kind,
        label: group.name,
        sublabel: [group.course.title, closed ? t('lanes.closed') : null].filter(Boolean).join(' · '),
        href: `/admin/courses/groups/${group.id}`,
        versionRef: { id: curriculum.id, courseId: curriculum.courseId, ownerGroupId: group.id },
        groupId: group.id,
        courseId: group.course.id,
        emptyHint: t('lanes.groupEmpty'),
        openCount: openTaskCount(laneTasks),
        tasks: laneTasks,
      });
    } else if (scope.groups.includes(group.id) && !wholeCourse(group.course.id)) {
      // An instructor's group that reads the core curriculum: the tasks from its learners' feedback.
      lanes.push({
        id: groupTaskLaneId(group.id),
        kind,
        label: group.name,
        sublabel: t('lanes.readsCourse', { course: group.course.title }),
        href: `/admin/courses/groups/${group.id}`,
        versionRef: null,
        groupId: group.id,
        courseId: group.course.id,
        emptyHint: t('lanes.groupFeedbackEmpty'),
        openCount: openTaskCount(laneTasks),
        tasks: laneTasks,
      });
    }
  }

  // Limited viewers never see untied tasks (the filter leaves them out).
  const { orphanLanes } = leftoverLanes(kind, tasksByLane, t);
  return [...lanes, ...closedLanes, ...orphanLanes];
}

/** Lanes for tasks without a skeleton row: orphans (a deleted curriculum) and untied tasks. */
function leftoverLanes(kind: string, tasksByLane: Map<string, TaskListItem[]>, t: LaneWords) {
  const orphanLanes: TaskLane[] = [];
  let unscopedLane: TaskLane | null = null;
  for (const [laneId, laneTasks] of Array.from(tasksByLane.entries())) {
    if (laneId === TASK_LANE_ID.unscoped) {
      unscopedLane = {
        id: laneId,
        kind,
        label: t('lanes.untied'),
        sublabel: null,
        href: null,
        versionRef: null,
        groupId: null,
        courseId: null,
        emptyHint: '',
        openCount: openTaskCount(laneTasks),
        tasks: laneTasks,
      };
      continue;
    }
    const { scope, refs } = laneTasks[0];
    const groupId = scope?.kind === 'group' ? scope.groupId : laneId.startsWith('group:') ? laneId.slice('group:'.length) : null;
    orphanLanes.push({
      id: laneId,
      kind,
      label: scope?.kind === 'group' ? scope.groupName : refs.course?.title ?? t('lanes.deletedCourse'),
      sublabel: refs.course?.title ?? null,
      href: groupId ? `/admin/courses/groups/${groupId}` : null,
      versionRef:
        refs.version && refs.course
          ? {
              id: refs.version.id,
              courseId: refs.course.id,
              ownerGroupId: refs.version.group?.id ?? null,
            }
          : null,
      groupId,
      courseId: refs.course?.id ?? null,
      emptyHint: t('lanes.groupEmpty'),
      openCount: openTaskCount(laneTasks),
      tasks: laneTasks,
    });
  }
  return { orphanLanes, unscopedLane };
}

/**
 * Deletes tasks that are not tied to any curriculum: a `curriculum_version` link whose version no
 * longer exists, or no version link at all — typically leftovers from test data. The check is
 * redone here rather than trusted from the caller, so a stale board can never delete live work.
 *
 * Removal itself is {@link deleteTaskRows}.
 */
export async function deleteOrphanTasks(
  taskIds: string[]
): Promise<{ deleted: number; refused: number }> {
  if (!taskIds.length) {
    return { deleted: 0, refused: 0 };
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      entityLinks: {
        where: { entityType: TASK_ENTITY_TYPE.curriculumVersion },
        select: { entityId: true },
      },
    },
  });

  const linkedVersionIds = Array.from(
    new Set(tasks.flatMap((task) => task.entityLinks.map((link) => link.entityId)))
  );
  const liveVersions = linkedVersionIds.length
    ? await prisma.curriculumVersion.findMany({
        where: { id: { in: linkedVersionIds } },
        select: { id: true },
      })
    : [];
  const liveVersionIds = new Set(liveVersions.map((version) => version.id));

  const orphanIds = tasks
    .filter((task) => !task.entityLinks.some((link) => liveVersionIds.has(link.entityId)))
    .map((task) => task.id);

  if (!orphanIds.length) {
    return { deleted: 0, refused: tasks.length };
  }

  await deleteTaskRows(orphanIds);

  return { deleted: orphanIds.length, refused: tasks.length - orphanIds.length };
}

/**
 * Removes the task rows themselves. Their own links and comments cascade; links *pointing at* them
 * (e.g. a core proposal's `source`) are cleaned up explicitly, because `TaskEntityLink` is FK-free
 * and would otherwise dangle.
 */
async function deleteTaskRows(taskIds: string[]) {
  await prisma.$transaction([
    prisma.taskEntityLink.deleteMany({
      where: { entityType: TASK_ENTITY_TYPE.task, entityId: { in: taskIds } },
    }),
    prisma.task.deleteMany({ where: { id: { in: taskIds } } }),
  ]);
}

/**
 * Clears ignored tasks: the board's way to empty the Ignored column, for revisions that were looked
 * at and turned down. Only IGNORED tasks go, re-checked here rather than trusted from the caller, so
 * a stale board can never delete live work. Each task's curriculum is handed to `canDelete` (the
 * caller's triage check) first, which is what keeps an instructor to their own group's lane.
 *
 * Returns the owning groups of what was deleted, so the caller can revalidate their pages too.
 */
export async function deleteIgnoredTasks(
  taskIds: string[],
  /** Whether the viewer may delete a task of this course and these groups (null course = untied). */
  canDelete: (ref: { courseId: string | null; groupIds: string[] }) => boolean
): Promise<{ deleted: number; refused: number; groupIds: string[] }> {
  if (!taskIds.length) {
    return { deleted: 0, refused: 0, groupIds: [] };
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, status: TaskStatus.IGNORED },
    select: {
      id: true,
      entityLinks: { select: { entityType: true, entityId: true } },
    },
  });

  const linkedVersionIds = Array.from(
    new Set(
      tasks.flatMap((task) =>
        task.entityLinks.filter((link) => link.entityType === TASK_ENTITY_TYPE.curriculumVersion).map((link) => link.entityId)
      )
    )
  );
  const versions = linkedVersionIds.length
    ? await prisma.curriculumVersion.findMany({
        where: { id: { in: linkedVersionIds } },
        select: { id: true, courseId: true, ownerGroupId: true },
      })
    : [];
  const versionById = new Map(versions.map((version) => [version.id, version]));

  const deletable: string[] = [];
  const groupIds = new Set<string>();
  for (const task of tasks) {
    // A link to a curriculum that no longer exists leaves the task untied, exactly like one with no
    // link at all: `canDelete` then gets no course (the Tasks section decides, not an instructor).
    const version =
      task.entityLinks
        .filter((link) => link.entityType === TASK_ENTITY_TYPE.curriculumVersion)
        .map((link) => versionById.get(link.entityId) ?? null)
        .find((ref) => ref !== null) ?? null;
    const taskGroups = task.entityLinks.filter((link) => link.entityType === TASK_ENTITY_TYPE.courseGroup).map((link) => link.entityId);
    if (version?.ownerGroupId) taskGroups.push(version.ownerGroupId);
    if (!canDelete({ courseId: version?.courseId ?? null, groupIds: taskGroups })) {
      continue;
    }
    deletable.push(task.id);
    taskGroups.forEach((groupId) => groupIds.add(groupId));
  }

  if (!deletable.length) {
    return { deleted: 0, refused: taskIds.length, groupIds: [] };
  }

  await deleteTaskRows(deletable);

  return {
    deleted: deletable.length,
    refused: taskIds.length - deletable.length,
    groupIds: Array.from(groupIds),
  };
}

/** Task counts per kind for the board's kind chips, scoped exactly like {@link listTasks}. */
export async function listTaskKindCounts(where: Prisma.TaskWhereInput = {}): Promise<Record<string, number>> {
  const rows = await prisma.task.groupBy({
    by: ['kind'],
    where,
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.kind, row._count._all]));
}

export type RelatedTask = { id: string; title: string; status: TaskStatus };

export type TaskDetail = TaskListItem & {
  description: string | null;
  /** Worked on in the app or in the Obsidian vault (null: nobody chose yet). */
  workplace: 'APP' | 'VAULT' | null;
  /** Revision plan written in the Obsidian feedback note (read-only here). */
  plan: string | null;
  planUpdatedAt: string | null;
  /** For a core proposal: the group task it was proposed from. */
  proposedFrom: RelatedTask | null;
  /** For a group task: the core task proposed from it, if any. */
  proposedForCore: RelatedTask | null;
  sourceComment: {
    id: string;
    selectedText: string;
    body: string;
    proposerName: string;
    createdAt: string;
  } | null;
};

/** Admin: full task with its source comment (if any) resolved for the detail page. */
export async function getTask(taskId: string): Promise<TaskDetail | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      kind: true,
      title: true,
      description: true,
      plan: true,
      planUpdatedAt: true,
      status: true,
      aiReady: true,
      workplace: true,
      proposerName: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      entityLinks: { orderBy: { createdAt: 'asc' }, select: { entityType: true, entityId: true, role: true } },
      assignee: { select: ASSIGNEE_SELECT },
      _count: { select: { comments: true } },
    },
  });

  if (!task) {
    return null;
  }

  const refs =
    (await resolveCurriculumRefs(new Map([[task.id, task.entityLinks]]))).get(task.id) ??
    null;

  let sourceComment: TaskDetail['sourceComment'] = null;
  if (refs?.commentId) {
    const comment = await prisma.curriculumComment.findUnique({
      where: { id: refs.commentId },
      select: {
        id: true,
        selectedText: true,
        body: true,
        proposerName: true,
        createdAt: true,
      },
    });
    if (comment) {
      sourceComment = {
        id: comment.id,
        selectedText: comment.selectedText,
        body: comment.body,
        proposerName: comment.proposerName,
        createdAt: comment.createdAt.toISOString(),
      };
    }
  }

  const proposedFromId =
    task.entityLinks.find(
      (link) =>
        link.entityType === TASK_ENTITY_TYPE.task && link.role === TASK_ENTITY_ROLE.source
    )?.entityId ?? null;
  const [proposedFrom, proposedForCore] = await Promise.all([
    proposedFromId
      ? prisma.task.findUnique({
          where: { id: proposedFromId },
          select: { id: true, title: true, status: true },
        })
      : null,
    resolveProposedForCore([task.id]).then((byTask) => byTask.get(task.id) ?? null),
  ]);

  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    description: task.description,
    plan: task.plan,
    planUpdatedAt: task.planUpdatedAt?.toISOString() ?? null,
    proposedFrom,
    proposedForCore,
    status: task.status,
    proposerName: task.proposerName,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    refs: refs ?? EMPTY_REFS,
    context: taskKindDefinition(task.kind)?.context(refs ?? EMPTY_REFS) ?? null,
    scope: taskScope(refs ?? EMPTY_REFS),
    ...taskOwners(task.entityLinks, refs ?? EMPTY_REFS, taskScope(refs ?? EMPTY_REFS)),
    assignee: toTaskAssignee(task.assignee),
    proposal: proposedForCore,
    hasPlan: Boolean(task.plan),
    aiReady: task.aiReady,
    workplace: task.workplace,
    commentCount: task._count.comments,
    sourceComment,
  };
}

export type ProposeForCoreResult = { ok: true; taskId: string } | { ok: false; error: string };

/**
 * Turns a group revision into a proposal for the core curriculum: a new curriculum task on the
 * core version (and core lesson) the group's copy was made from, with the group task's plan, linked
 * back to the group task as its `source`. The core is only ever changed through that task: at most
 * the changes saved in the group's copy wait there as proposed changes (`carry-to-course.ts`).
 */
export async function proposeTaskForCore(input: {
  taskId: string;
  createdById?: string | null;
}): Promise<ProposeForCoreResult> {
  const task = await getTask(input.taskId);

  if (!task) {
    return { ok: false, error: 'Task not found.' };
  }
  const version = task.refs.version;
  if (!version?.group) {
    return { ok: false, error: 'Only a group’s own changes can be suggested for the course.' };
  }
  if (!version.baseVersionId || !task.refs.course) {
    return { ok: false, error: 'The course version this group’s copy was made from is gone.' };
  }
  if (task.proposedForCore) {
    return { ok: false, error: 'This task was already suggested for the course.' };
  }

  const groupLesson = task.refs.lesson
    ? await prisma.lesson.findUnique({
        where: { id: task.refs.lesson.id },
        select: { baseLessonId: true },
      })
    : null;
  const coreLesson = groupLesson?.baseLessonId
    ? await prisma.lesson.findFirst({
        where: { id: groupLesson.baseLessonId, curriculumVersionId: version.baseVersionId },
        select: { id: true },
      })
    : null;

  const description = [
    `Proposed from ${version.group.name}'s curriculum.`,
    task.description?.trim() || null,
    coreLesson ? null : 'The lesson only exists in the group’s copy (added there).',
  ]
    .filter(Boolean)
    .join('\n\n');

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: task.refs.course.id },
    select: { organizationId: true },
  });

  const created = await prisma.task.create({
    data: {
      organizationId: course.organizationId,
      kind: TASK_KIND.curriculum,
      title: task.title,
      description,
      // The plan, without the group's "Scope:" line (the course's own improvement has none).
      plan: planBody(task.plan) || null,
      planUpdatedAt: task.plan?.trim() ? new Date() : null,
      proposerName: task.proposerName,
      createdById: input.createdById ?? null,
      entityLinks: {
        create: [
          ...(coreLesson
            ? [
                {
                  entityType: TASK_ENTITY_TYPE.lesson,
                  entityId: coreLesson.id,
                  role: TASK_ENTITY_ROLE.subject,
                },
              ]
            : []),
          {
            entityType: TASK_ENTITY_TYPE.curriculumVersion,
            entityId: version.baseVersionId,
            role: TASK_ENTITY_ROLE.subject,
          },
          {
            entityType: TASK_ENTITY_TYPE.course,
            entityId: task.refs.course.id,
            role: TASK_ENTITY_ROLE.subject,
          },
          {
            entityType: TASK_ENTITY_TYPE.task,
            entityId: task.id,
            role: TASK_ENTITY_ROLE.source,
          },
        ],
      },
    },
    select: { id: true },
  });

  return { ok: true, taskId: created.id };
}

/** Admin dashboard counts. */
export async function getTaskCounts() {
  const [open, inProgress] = await Promise.all([
    prisma.task.count({ where: { status: TaskStatus.TODO } }),
    prisma.task.count({ where: { status: TaskStatus.IN_PROGRESS } }),
  ]);
  return { open, inProgress };
}

export type TaskStatusCounts = Record<TaskStatus, number> & { total: number };

/** Count of tasks in each status the viewer may see (`where`), for the overview Tasks module. */
export async function getTaskStatusCounts(where: Prisma.TaskWhereInput = {}): Promise<TaskStatusCounts> {
  const grouped = await prisma.task.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });

  const counts: TaskStatusCounts = {
    TODO: 0,
    IN_PROGRESS: 0,
    DONE: 0,
    IGNORED: 0,
    total: 0,
  };

  for (const row of grouped) {
    counts[row.status] = row._count._all;
    counts.total += row._count._all;
  }

  return counts;
}

export type TaskCommentView = {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
};

/** Admin discussion notes on a task, oldest first (with author avatars). */
export async function listTaskComments(taskId: string): Promise<TaskCommentView[]> {
  const comments = await prisma.taskComment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      authorName: true,
      body: true,
      createdAt: true,
      authorId: true,
      author: { select: { profileImageKey: true } },
    },
  });

  return comments.map((comment) => ({
    id: comment.id,
    authorName: comment.authorName,
    authorAvatarUrl: comment.authorId
      ? getUserProfileImageUrl(comment.authorId, comment.author?.profileImageKey)
      : null,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  }));
}

export type AssignableUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Teaches one of the task's groups (offered first). */
  teachesGroup?: boolean;
};

/** Active users that a task can be assigned to. */
/** Active members of the organisation, the people a task can be assigned to. */
/**
 * Members of the organisation a task can be assigned to: with `ref`, only those who may work on it
 * (owners, admins and full members, or limited members whose course or group it belongs to), its
 * groups' instructors first.
 */
export async function listAssignableUsers(
  organizationId: string,
  ref?: { courseId: string | null; groupIds: string[] }
): Promise<AssignableUser[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, memberships: { some: { organizationId } } },
    orderBy: [{ firstName: 'asc' }, { identifier: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      identifier: true,
      profileImageKey: true,
      memberships: { where: { organizationId }, select: { role: true, access: true } },
      grants: {
        where: { organizationId },
        select: { organizationId: true, entityType: true, entityId: true, permissions: true },
      },
    },
  });

  const work = ['READ', 'TASKS'] as const;
  const mayWork = (user: (typeof users)[number]) => {
    if (!ref) return true;
    const principal = { role: 'USER' as const, grants: grantsFromMembership(user.memberships[0] ?? null, user.grants, organizationId) };
    const required = [...work];
    if (can(principal, { type: GRANT_ENTITY_TYPES.ADMIN_SECTION, section: 'tasks' }, required)) return true;
    const courseId = ref.courseId;
    return Boolean(
      courseId &&
        (can(principal, { type: GRANT_ENTITY_TYPES.COURSE, courseId }, required) ||
          ref.groupIds.some((groupId) => can(principal, { type: GRANT_ENTITY_TYPES.GROUP, groupId, courseId }, required)))
    );
  };

  // The task's group instructors come first: it's their class the feedback came from.
  const teaching = new Set(
    ref?.groupIds.length
      ? (await prisma.courseGroupInstructor.findMany({ where: { groupId: { in: ref.groupIds } }, select: { userId: true } })).map(
          (row) => row.userId
        )
      : []
  );
  return users
    .filter(mayWork)
    .map((user) => ({
      id: user.id,
      name: userDisplayName(user),
      avatarUrl: getUserProfileImageUrl(user.id, user.profileImageKey),
      teachesGroup: teaching.has(user.id),
    }))
    .sort((a, b) => Number(b.teachesGroup) - Number(a.teachesGroup));
}

/** Edit a task's instructions (its description); empty clears it. */
export async function updateTaskDescription(taskId: string, description: string) {
  const trimmed = description.trim().slice(0, 8000);
  await prisma.task.update({
    where: { id: taskId },
    data: { description: trimmed || null },
  });
}

/**
 * Store a task's revision plan (from the app, or the Obsidian feedback note through the sync API);
 * empty clears it. `planUpdatedAt` only moves when the text actually changes, or with `touch` (the
 * person saved it in the app: it covers the feedback used so far, changed or not).
 */
export async function updateTaskPlan(taskId: string, plan: string, { touch = false }: { touch?: boolean } = {}) {
  const trimmed = plan.trim().slice(0, 20000) || null;
  const current = await prisma.task.findUnique({ where: { id: taskId }, select: { plan: true } });
  if (!current || (current.plan === trimmed && !(touch && trimmed))) {
    return;
  }
  await prisma.task.update({
    where: { id: taskId },
    data: { plan: trimmed, planUpdatedAt: new Date() },
  });
}

/**
 * Clears a task for the local agent (or takes that clearance back): with `aiReady`, whoever picks
 * the task up in the vault may let the agent execute the plan end to end. Only the flag moves — the
 * task's status, plan and instructions are untouched.
 */
export async function setTaskAiReady(taskId: string, aiReady: boolean) {
  await prisma.task.update({ where: { id: taskId }, data: { aiReady } });
}

/** Marks a finished group task as group-only (not for the core), or clears that. */
export async function setTaskGroupOnly(taskId: string, groupOnly: boolean) {
  await prisma.task.update({ where: { id: taskId }, data: { groupOnly } });
}

/** Assign a task to a user (or clear the assignment when `assigneeId` is null). */
export async function assignTask(taskId: string, assigneeId: string | null) {
  await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId },
  });
}

/** Add an admin note to a task. */
export async function addTaskComment(input: {
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
}) {
  const body = input.body.trim().slice(0, 4000);
  if (!body) {
    return;
  }

  await prisma.taskComment.create({
    data: {
      taskId: input.taskId,
      authorId: input.authorId,
      authorName: input.authorName,
      body,
    },
  });
}

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];

export type SyncComment = {
  id: string;
  selectedText: string;
  context: string | null;
  body: string;
  proposerName: string;
  adminResponse: string | null;
  createdAt: string;
};

export type SyncTask = {
  id: string;
  title: string;
  description: string | null;
  /** The instructor's notes for AI on the improvement (their own words about the change). */
  aiNotes: string | null;
  /** Revision plan as last sent from the vault (the feedback note is its source of truth). */
  plan: string | null;
  planUpdatedAt: string | null;
  status: TaskStatus;
  /**
   * The task is cleared for the local agent: it may execute the plan end to end instead of only
   * assisting whoever edits the lesson. False means a person stays in charge of the revision.
   */
  aiReady: boolean;
  /** The lesson's overall revision brief (vs. a single feedback item). */
  isBrief: boolean;
  proposerName: string | null;
  createdAt: string;
  updatedAt: string;
  lesson: { id: string; title: string; slug: string; position: number } | null;
  /** The first piece of feedback it uses (older plugins read only this one). */
  sourceComment: SyncComment | null;
  /** All the feedback it uses, oldest first: one improvement per lesson covers several. */
  sourceComments: SyncComment[];
  notes: { authorName: string; body: string; createdAt: string }[];
  /** Where it's worked on: the app, the vault, or nobody yet. */
  workplace: TaskWorkplace | null;
  completedAt: string | null;
};

/**
 * Sync API: every task linked to a curriculum version (the lessons' improvements and briefs), in
 * any state but ignored, with the lesson and the feedback each uses, so the vault has the whole
 * picture: open work to plan and finish there (`workplace` APP: started in the app, which the vault
 * takes over when it sends a plan or a tick), and what's done.
 */
export async function listSyncTasksForVersion(versionId: string): Promise<SyncTask[]> {
  const tasks = await prisma.task.findMany({
    where: {
      status: { not: TaskStatus.IGNORED },
      entityLinks: {
        some: { entityType: TASK_ENTITY_TYPE.curriculumVersion, entityId: versionId },
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      aiNotes: true,
      plan: true,
      planUpdatedAt: true,
      status: true,
      aiReady: true,
      workplace: true,
      completedAt: true,
      proposerName: true,
      createdAt: true,
      updatedAt: true,
      entityLinks: { select: { entityType: true, entityId: true, role: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        select: { authorName: true, body: true, createdAt: true },
      },
    },
  });

  const linkedIds = (entityType: string) =>
    Array.from(
      new Set(
        tasks.flatMap((task) =>
          task.entityLinks
            .filter((link) => link.entityType === entityType)
            .map((link) => link.entityId)
        )
      )
    );

  const lessonIds = linkedIds(TASK_ENTITY_TYPE.lesson);
  const commentIds = linkedIds(TASK_ENTITY_TYPE.curriculumComment);

  const [lessons, comments] = await Promise.all([
    lessonIds.length
      ? prisma.lesson.findMany({
          where: { id: { in: lessonIds } },
          select: { id: true, title: true, slug: true, position: true },
        })
      : Promise.resolve([]),
    commentIds.length
      ? prisma.curriculumComment.findMany({
          where: { id: { in: commentIds } },
          select: {
            id: true,
            selectedText: true,
            context: true,
            body: true,
            proposerName: true,
            adminResponse: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));

  return tasks.map((task) => {
    const linkedEntity = <T>(entityType: string, byId: Map<string, T>): T | null => {
      const link = task.entityLinks.find((l) => l.entityType === entityType);
      return link ? byId.get(link.entityId) ?? null : null;
    };
    const lesson = linkedEntity(TASK_ENTITY_TYPE.lesson, lessonById);
    const sourceComments = task.entityLinks
      .filter((link) => link.entityType === TASK_ENTITY_TYPE.curriculumComment)
      .flatMap((link) => {
        const comment = commentById.get(link.entityId);
        return comment ? [{ ...comment, createdAt: comment.createdAt.toISOString() }] : [];
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      aiNotes: task.aiNotes,
      plan: task.plan,
      planUpdatedAt: task.planUpdatedAt?.toISOString() ?? null,
      status: task.status,
      aiReady: task.aiReady,
      isBrief: task.entityLinks.some(
        (link) =>
          link.entityType === TASK_ENTITY_TYPE.lesson && link.role === TASK_ENTITY_ROLE.brief
      ),
      proposerName: task.proposerName,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      lesson,
      sourceComment: sourceComments[0] ?? null,
      sourceComments,
      notes: task.comments.map((note) => ({
        authorName: note.authorName,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      })),
      workplace: task.workplace,
      completedAt: task.completedAt?.toISOString() ?? null,
    };
  });
}

/** How many done pieces of feedback the vault gets per version, newest first (open ones: all). */
const SYNC_RESOLVED_FEEDBACK = 500;

export type SyncFeedback = SyncComment & {
  lesson: { id: string; title: string; slug: string; position: number };
  /** An instructor note rather than learner feedback. */
  isInstructorNote: boolean;
  status: CurriculumCommentStatus;
  adminRespondedAt: string | null;
  resolvedAt: string | null;
  /** The tasks (not ignored) that use it, oldest first; empty while nobody has used it. */
  taskIds: string[];
};

/**
 * Sync API: the version's feedback, learner feedback and instructor notes alike: every open piece
 * and the most recent done ones, each with its lesson and the tasks that use it. The vault answers
 * the unused ones (a reply, done) or plans them into the lesson's improvement.
 */
export async function listSyncFeedbackForVersion(versionId: string): Promise<SyncFeedback[]> {
  const select = {
    id: true,
    selectedText: true,
    context: true,
    body: true,
    proposerName: true,
    adminResponse: true,
    adminRespondedAt: true,
    isInstructorNote: true,
    status: true,
    resolvedAt: true,
    createdAt: true,
    lesson: { select: { id: true, title: true, slug: true, position: true } },
  } as const;
  const [open, resolved] = await Promise.all([
    prisma.curriculumComment.findMany({
      where: { curriculumVersionId: versionId, status: CurriculumCommentStatus.OPEN },
      orderBy: { createdAt: 'asc' },
      select,
    }),
    prisma.curriculumComment.findMany({
      where: { curriculumVersionId: versionId, status: { not: CurriculumCommentStatus.OPEN } },
      orderBy: { createdAt: 'desc' },
      take: SYNC_RESOLVED_FEEDBACK,
      select,
    }),
  ]);
  const comments = [...open, ...resolved];
  const links = comments.length
    ? await prisma.taskEntityLink.findMany({
        where: {
          entityType: TASK_ENTITY_TYPE.curriculumComment,
          entityId: { in: comments.map((comment) => comment.id) },
          role: TASK_ENTITY_ROLE.source,
          task: { status: { not: TaskStatus.IGNORED } },
        },
        orderBy: { createdAt: 'asc' },
        select: { entityId: true, taskId: true },
      })
    : [];
  return comments.map((comment) => ({
    id: comment.id,
    selectedText: comment.selectedText,
    context: comment.context,
    body: comment.body,
    proposerName: comment.proposerName,
    adminResponse: comment.adminResponse,
    createdAt: comment.createdAt.toISOString(),
    lesson: comment.lesson,
    isInstructorNote: comment.isInstructorNote,
    status: comment.status,
    adminRespondedAt: comment.adminRespondedAt?.toISOString() ?? null,
    resolvedAt: comment.resolvedAt?.toISOString() ?? null,
    taskIds: links.filter((link) => link.entityId === comment.id).map((link) => link.taskId),
  }));
}

/** True when the task is linked to the curriculum version (scopes sync-token writes). */
export async function taskBelongsToVersion(taskId: string, versionId: string): Promise<boolean> {
  const link = await prisma.taskEntityLink.findFirst({
    where: {
      taskId,
      entityType: TASK_ENTITY_TYPE.curriculumVersion,
      entityId: versionId,
    },
    select: { id: true },
  });
  return Boolean(link);
}

export type LessonFeedbackItem = {
  id: string;
  title: string;
  description: string | null;
  plan: string | null;
  status: TaskStatus;
  /** Cleared for the local agent to execute on its own (see `Task.aiReady`). */
  aiReady: boolean;
  isBrief: boolean;
  proposerName: string | null;
  sourceComment: { selectedText: string; body: string; proposerName: string } | null;
  updatedAt: string;
};

/**
 * Admin lesson page: the lesson's open feedback (TODO / IN_PROGRESS items) plus its open brief, so
 * feedback can be given instructions and started next to the lesson it changes.
 */
export async function listLessonFeedback(lessonId: string, scope: Prisma.TaskWhereInput = {}): Promise<LessonFeedbackItem[]> {
  const tasks = await prisma.task.findMany({
    where: {
      status: { in: OPEN_TASK_STATUSES },
      entityLinks: { some: { entityType: TASK_ENTITY_TYPE.lesson, entityId: lessonId } },
      AND: [scope],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      plan: true,
      status: true,
      aiReady: true,
      proposerName: true,
      updatedAt: true,
      entityLinks: { select: { entityType: true, entityId: true, role: true } },
    },
  });

  const commentIds = tasks.flatMap((task) =>
    task.entityLinks
      .filter((link) => link.entityType === TASK_ENTITY_TYPE.curriculumComment)
      .map((link) => link.entityId)
  );
  const comments = commentIds.length
    ? await prisma.curriculumComment.findMany({
        where: { id: { in: commentIds } },
        select: { id: true, selectedText: true, body: true, proposerName: true },
      })
    : [];
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));

  return tasks.map((task) => {
    const commentLink = task.entityLinks.find(
      (link) => link.entityType === TASK_ENTITY_TYPE.curriculumComment
    );
    const comment = commentLink ? commentById.get(commentLink.entityId) : undefined;
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      plan: task.plan,
      status: task.status,
      aiReady: task.aiReady,
      isBrief: task.entityLinks.some(
        (link) =>
          link.entityType === TASK_ENTITY_TYPE.lesson && link.role === TASK_ENTITY_ROLE.brief
      ),
      proposerName: task.proposerName,
      sourceComment: comment
        ? { selectedText: comment.selectedText, body: comment.body, proposerName: comment.proposerName }
        : null,
      updatedAt: task.updatedAt.toISOString(),
    };
  });
}

/**
 * Creates or updates the lesson's open brief: a curriculum task whose lesson link has the `brief`
 * role. An empty body ignores the open brief. `start` moves it to IN_PROGRESS.
 */
export async function upsertLessonBrief(input: {
  lessonId: string;
  body: string;
  start: boolean;
  /** Cleared for the local agent; omitted leaves an existing brief's flag as it is. */
  aiReady?: boolean;
  createdById?: string | null;
}): Promise<void> {
  const body = input.body.trim().slice(0, 8000);
  const existing = await prisma.task.findFirst({
    where: {
      status: { in: OPEN_TASK_STATUSES },
      entityLinks: {
        some: {
          entityType: TASK_ENTITY_TYPE.lesson,
          entityId: input.lessonId,
          role: TASK_ENTITY_ROLE.brief,
        },
      },
    },
    select: { id: true, status: true },
  });

  if (!body) {
    if (existing) {
      await updateTaskStatus(existing.id, TaskStatus.IGNORED);
    }
    return;
  }

  const status = input.start ? TaskStatus.IN_PROGRESS : existing?.status ?? TaskStatus.TODO;

  if (existing) {
    await prisma.task.update({
      where: { id: existing.id },
      data: {
        description: body,
        status,
        ...(input.aiReady === undefined ? {} : { aiReady: input.aiReady }),
      },
    });
    return;
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: input.lessonId },
    select: {
      title: true,
      position: true,
      courseId: true,
      curriculumVersionId: true,
      curriculumVersion: { select: { ownerGroupId: true } },
      course: { select: { organizationId: true } },
    },
  });
  if (!lesson) {
    return;
  }
  const groupId = lesson.curriculumVersion.ownerGroupId;

  await prisma.task.create({
    data: {
      organizationId: lesson.course.organizationId,
      kind: TASK_KIND.curriculum,
      title: `Brief · Lesson ${lesson.position}: ${lesson.title}`.slice(0, 200),
      description: body,
      status,
      aiReady: input.aiReady ?? false,
      createdById: input.createdById ?? null,
      entityLinks: {
        create: [
          {
            entityType: TASK_ENTITY_TYPE.lesson,
            entityId: input.lessonId,
            role: TASK_ENTITY_ROLE.brief,
          },
          {
            entityType: TASK_ENTITY_TYPE.curriculumVersion,
            entityId: lesson.curriculumVersionId,
            role: TASK_ENTITY_ROLE.subject,
          },
          {
            entityType: TASK_ENTITY_TYPE.course,
            entityId: lesson.courseId,
            role: TASK_ENTITY_ROLE.subject,
          },
          ...(groupId ? [{ entityType: TASK_ENTITY_TYPE.courseGroup, entityId: groupId, role: TASK_ENTITY_ROLE.subject }] : []),
        ],
      },
    },
  });
}
