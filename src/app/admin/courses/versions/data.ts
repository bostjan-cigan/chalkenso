import 'server-only';

import { CurriculumVersionStatus, TaskStatus } from '@prisma/client';
import { getGroupCurriculumChangesByFork, type GroupCurriculumChanges } from '@/lib/group-curricula';
import { parsePlanScope } from '@/lib/plan-scope';
import { prisma } from '@/lib/prisma';
import { TASK_ENTITY_ROLE, TASK_ENTITY_TYPE } from '@/lib/tasks';
import { toPreviewLinkView, type PreviewLinkView } from './preview-link-view';

export type CourseVersionSummary = {
  id: string;
  label: string;
  version: number;
  status: CurriculumVersionStatus;
  publishedAt: Date | null;
  lessonCount: number;
  groupCount: number;
  updatedAt: Date;
};

/**
 * Core versions of a course, oldest ordinal first, with usage counts for the admin UI. Group
 * curricula are managed from their group and never listed here.
 */
export async function listVersionsForCourse(
  courseId: string
): Promise<CourseVersionSummary[]> {
  const versions = await prisma.curriculumVersion.findMany({
    where: {
      courseId,
      ownerGroupId: null,
    },
    orderBy: {
      version: 'asc',
    },
    select: {
      id: true,
      label: true,
      version: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
      _count: {
        select: {
          lessons: true,
          groups: true,
        },
      },
    },
  });

  return versions.map((version) => ({
    id: version.id,
    label: version.label,
    version: version.version,
    status: version.status,
    publishedAt: version.publishedAt,
    lessonCount: version._count.lessons,
    groupCount: version._count.groups,
    updatedAt: version.updatedAt,
  }));
}

export type ForkTaskRef = { id: string; title: string; status: TaskStatus };

export type VersionFork = {
  /** The group curriculum (a version owned by the group). */
  id: string;
  label: string;
  createdAt: Date;
  /** Closed with the group's Close action, or else the group's end date once it has passed. */
  closedAt: Date | null;
  lessonCount: number;
  group: { id: string; name: string; startsAt: Date | null; endsAt: Date | null };
  changes: GroupCurriculumChanges;
  /** Revision work on the fork: open (To do / In progress) and finished (Done). */
  tasks: { open: number; done: number };
  /** Core proposals made from the fork's tasks: still open, and accepted (Done). */
  proposals: { open: number; done: number };
  /** Work waiting on someone, for the "Needs a decision" list. */
  pending: {
    /** The group's open revision tasks (To do / In progress). */
    groupTasks: ForkTaskRef[];
    /** Open proposals for the core made from this group's tasks. */
    proposals: ForkTaskRef[];
    /** Group tasks finished (Done), not proposed for the core and not marked group-only. */
    unproposed: ForkTaskRef[];
  };
  /** How many of `pending` wait on a decision: To do tasks and proposals, plus unproposed work. */
  decisionCount: number;
};

export type CourseForks = {
  /**
   * Core version id → its group curricula, newest first. Closed (wrapped-up) forks are left out
   * unless something on them still waits on someone.
   */
  byBaseVersion: Map<string, VersionFork[]>;
  /** Group curricula whose core version was deleted (same rule for closed ones). */
  orphaned: VersionFork[];
  /** Core version id → how many closed forks were left out (they still depend on that version). */
  hiddenClosedByBaseVersion: Map<string, number>;
};

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];

/**
 * The group curricula (forks) of a course, grouped by the core version they were copied from, with
 * how each differs from that version, its revision tasks, and what it has proposed back to the core.
 * Wrapped-up (closed) forks are hidden once nothing on them is pending.
 */
export async function listCourseForks(courseId: string): Promise<CourseForks> {
  const forks = await prisma.curriculumVersion.findMany({
    where: { courseId, ownerGroupId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      createdAt: true,
      archivedAt: true,
      baseVersionId: true,
      ownerGroup: { select: { id: true, name: true, startsAt: true, endsAt: true } },
      _count: { select: { lessons: true } },
    },
  });

  const forkIds = forks.map((fork) => fork.id);
  const [changes, tasks] = await Promise.all([
    // Every fork's changes at once (not two queries per fork).
    getGroupCurriculumChangesByFork(forkIds),
    forkIds.length
      ? prisma.task.findMany({
          where: {
            entityLinks: {
              some: { entityType: TASK_ENTITY_TYPE.curriculumVersion, entityId: { in: forkIds } },
            },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            status: true,
            groupOnly: true,
            plan: true,
            entityLinks: {
              where: { entityType: TASK_ENTITY_TYPE.curriculumVersion },
              select: { entityId: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const forkIdByTaskId = new Map<string, string>();
  for (const task of tasks) {
    const forkId = task.entityLinks.find((link) => forkIds.includes(link.entityId))?.entityId;
    if (forkId) {
      forkIdByTaskId.set(task.id, forkId);
    }
  }

  // Core proposals point back at the group task they came from (`source` link).
  const proposals = forkIdByTaskId.size
    ? await prisma.task.findMany({
        where: {
          entityLinks: {
            some: {
              entityType: TASK_ENTITY_TYPE.task,
              role: TASK_ENTITY_ROLE.source,
              entityId: { in: Array.from(forkIdByTaskId.keys()) },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          title: true,
          status: true,
          entityLinks: {
            where: { entityType: TASK_ENTITY_TYPE.task, role: TASK_ENTITY_ROLE.source },
            select: { entityId: true },
          },
        },
      })
    : [];

  const count = (statuses: TaskStatus[], forkId: string, items: { forkId: string | undefined; status: TaskStatus }[]) =>
    items.filter((item) => item.forkId === forkId && statuses.includes(item.status)).length;
  const taskItems = tasks.map((task) => ({ forkId: forkIdByTaskId.get(task.id), status: task.status }));
  const proposalItems = proposals.map((proposal) => ({
    forkId: forkIdByTaskId.get(proposal.entityLinks[0]?.entityId ?? ''),
    status: proposal.status,
  }));
  const proposedTaskIds = new Set(proposals.map((proposal) => proposal.entityLinks[0]?.entityId));
  // Group changes that already went into the main course (their plan said both, and its lesson was saved).
  const carriedTaskIds = new Set(
    tasks.length
      ? (
          await prisma.lessonChange.findMany({
            where: { taskId: { in: tasks.map((task) => task.id) }, lesson: { curriculumVersion: { ownerGroupId: null } } },
            select: { taskId: true },
          })
        ).map((change) => change.taskId)
      : []
  );
  const toRef = (task: { id: string; title: string; status: TaskStatus }): ForkTaskRef => ({
    id: task.id,
    title: task.title,
    status: task.status,
  });
  const pendingFor = (forkId: string): VersionFork['pending'] => ({
    groupTasks: tasks
      .filter((task) => forkIdByTaskId.get(task.id) === forkId && OPEN_TASK_STATUSES.includes(task.status))
      .map(toRef),
    proposals: proposals
      .filter(
        (proposal) =>
          forkIdByTaskId.get(proposal.entityLinks[0]?.entityId ?? '') === forkId &&
          OPEN_TASK_STATUSES.includes(proposal.status)
      )
      .map(toRef),
    unproposed: tasks
      .filter(
        (task) =>
          forkIdByTaskId.get(task.id) === forkId &&
          task.status === TaskStatus.DONE &&
          !task.groupOnly &&
          // Its plan kept it to the group, or it is in the main course already.
          parsePlanScope(task.plan) !== 'group only' &&
          !carriedTaskIds.has(task.id) &&
          !proposedTaskIds.has(task.id)
      )
      .map(toRef),
  });

  const now = new Date();
  const result: CourseForks = {
    byBaseVersion: new Map(),
    orphaned: [],
    hiddenClosedByBaseVersion: new Map(),
  };
  forks.forEach((fork) => {
    if (!fork.ownerGroup) {
      return;
    }
    const view: VersionFork = {
      id: fork.id,
      label: fork.label,
      createdAt: fork.createdAt,
      closedAt:
        fork.archivedAt ??
        (fork.ownerGroup.endsAt && fork.ownerGroup.endsAt < now ? fork.ownerGroup.endsAt : null),
      lessonCount: fork._count.lessons,
      group: fork.ownerGroup,
      changes: changes.get(fork.id) ?? { changed: 0, added: 0, removed: 0, lessons: [] },
      tasks: {
        open: count(OPEN_TASK_STATUSES, fork.id, taskItems),
        done: count([TaskStatus.DONE], fork.id, taskItems),
      },
      proposals: {
        open: count(OPEN_TASK_STATUSES, fork.id, proposalItems),
        done: count([TaskStatus.DONE], fork.id, proposalItems),
      },
      pending: pendingFor(fork.id),
      decisionCount: 0,
    };
    view.decisionCount =
      view.pending.groupTasks.filter((task) => task.status === TaskStatus.TODO).length +
      view.pending.proposals.filter((task) => task.status === TaskStatus.TODO).length +
      view.pending.unproposed.length;
    const hasPending =
      view.pending.groupTasks.length + view.pending.proposals.length + view.pending.unproposed.length > 0;
    if (view.closedAt && !hasPending) {
      if (fork.baseVersionId) {
        result.hiddenClosedByBaseVersion.set(
          fork.baseVersionId,
          (result.hiddenClosedByBaseVersion.get(fork.baseVersionId) ?? 0) + 1
        );
      }
      return;
    }
    if (fork.baseVersionId) {
      result.byBaseVersion.set(fork.baseVersionId, [
        ...(result.byBaseVersion.get(fork.baseVersionId) ?? []),
        view,
      ]);
    } else {
      result.orphaned.push(view);
    }
  });
  return result;
}

/**
 * Chooses which version's lessons the course detail page shows by default:
 * the requested one if valid, else the highest published version, else the highest ordinal.
 */
export function resolveSelectedVersionId(
  versions: CourseVersionSummary[],
  requestedId?: string
): string | null {
  if (versions.length === 0) {
    return null;
  }

  if (requestedId && versions.some((version) => version.id === requestedId)) {
    return requestedId;
  }

  const published = versions
    .filter((version) => version.status === CurriculumVersionStatus.PUBLISHED)
    .sort((left, right) => right.version - left.version);

  if (published.length > 0) {
    return published[0].id;
  }

  return versions[versions.length - 1].id;
}

/**
 * Version header + ordered lessons for the dedicated version-editing page (core versions and
 * group curricula alike; the latter carry their group and base version).
 */
export async function getVersionDetail(courseId: string, versionId: string) {
  return prisma.curriculumVersion.findFirst({
    where: {
      courseId,
      id: versionId,
    },
    select: {
      id: true,
      label: true,
      version: true,
      status: true,
      publishedAt: true,
      archivedAt: true,
      ownerGroup: { select: { id: true, name: true } },
      baseVersion: { select: { id: true, label: true } },
      _count: {
        select: {
          groups: true,
        },
      },
      course: {
        select: {
          id: true,
          title: true,
        },
      },
      lessons: {
        orderBy: {
          position: 'asc',
        },
        select: {
          arcId: true,
          assetReferences: {
            select: {
              assetId: true,
            },
          },
          id: true,
          position: true,
          slug: true,
          status: true,
          title: true,
          updatedAt: true,
          revision: true,
          publishedAt: true,
          publishedRevision: true,
        },
      },
    },
  });
}

/**
 * How many groups' copies were made from each of a course's versions (in one grouped count): a version
 * with copies can't be deleted.
 */
export async function listForkCounts(courseId: string): Promise<Map<string, number>> {
  const rows = await prisma.curriculumVersion.groupBy({
    by: ['baseVersionId'],
    where: { courseId, ownerGroupId: { not: null }, baseVersionId: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.flatMap((row) => (row.baseVersionId ? [[row.baseVersionId, row._count._all] as const] : [])));
}

/** Course + partners + arcs + lessons for the attendee-identical admin preview. */
export async function getVersionForAttendeePreview(courseId: string, versionId: string) {
  return prisma.curriculumVersion.findFirst({
    where: {
      courseId,
      id: versionId,
    },
    select: {
      id: true,
      label: true,
      status: true,
      course: {
        select: {
          title: true,
          summary: true,
          githubUrl: true,
          partners: {
            orderBy: {
              position: 'asc',
            },
            select: {
              partner: {
                select: {
                  id: true,
                  name: true,
                  logoUrl: true,
                  websiteUrl: true,
                },
              },
            },
          },
        },
      },
      arcs: {
        orderBy: {
          position: 'asc',
        },
        select: {
          id: true,
          title: true,
          description: true,
        },
      },
      lessons: {
        orderBy: {
          position: 'asc',
        },
        select: {
          arcId: true,
          id: true,
          position: true,
          shortDescription: true,
          title: true,
        },
      },
    },
  });
}


/** Shareable preview links of a version, newest first (inactive ones capped to recent history). */
export async function listPreviewLinksForVersion(versionId: string): Promise<PreviewLinkView[]> {
  const links = await prisma.accessLink.findMany({
    where: {
      curriculumVersionId: versionId,
      isPreview: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
    select: {
      claimedAt: true,
      createdAt: true,
      expiresAt: true,
      id: true,
      label: true,
      lastAccessedAt: true,
      oneTime: true,
      revokedAt: true,
      token: true,
    },
  });

  return links.map(toPreviewLinkView);
}
