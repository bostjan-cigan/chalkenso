import 'server-only';

import { AiProposalKind, Permission } from '@prisma/client';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { canReadFeedback, canWorkOnFeedback, requireCrmAccess } from '@/lib/crm-access';
import { isAiConfigured } from '@/lib/ai';
import { currentDraft, draftView } from '@/lib/ai-drafts';
import { loadRevisionPath } from '../components/revision-path/path-data';
import { usesVaultAgent } from '@/lib/vault-agent';
import { improvementRecords } from '@/lib/improvement-record';
import { improvementPlaces } from '@/lib/improvement-targets';
import { prisma } from '@/lib/prisma';
import { getTask, listAssignableUsers, listTaskComments } from '@/lib/tasks';

/**
 * Loads everything the task detail needs, with the same authorization on both surfaces: the full
 * page and the drawer the board opens over itself. Anyone who reaches the task's course or group
 * reads it; working on it needs Feedback & tasks there.
 */
export async function loadTaskDetail(taskId: string) {
  const task = await getTask(taskId);
  const ref = { courseId: task?.courseId ?? null, groupIds: task?.groupIds ?? [] };
  const viewer = await requireCrmAccess((candidate) => Boolean(task) && canReadFeedback(candidate, ref, 'tasks'));

  if (!task) {
    return null;
  }

  const canWork = canWorkOnFeedback(viewer, ref, 'tasks');
  const aiEnabled = await isAiConfigured();
  const organizationId = (await getCurrentUserSession())?.user.organization?.id ?? null;
  const versionId = task.refs.version?.id ?? null;
  const [discussion, users, draftRow, places, versionLessons, savedChanges, records] = await Promise.all([
    listTaskComments(taskId),
    // Anyone who may also work on this task (its course or group).
    canWork && organizationId ? listAssignableUsers(organizationId, ref) : Promise.resolve([]),
    // A plan draft AI is writing, or wrote while nobody watched (it waits for review here).
    canWork ? currentDraft(AiProposalKind.TASK_PLAN, taskId) : Promise.resolve(null),
    // The lessons it changes (its own, and the main course's when its plan says so).
    improvementPlaces(prisma, taskId),
    // Its course's or copy's lessons, to add another one.
    versionId
      ? prisma.lesson.findMany({ where: { curriculumVersionId: versionId }, orderBy: { position: 'asc' }, select: { id: true, position: true, title: true, courseId: true } })
      : Promise.resolve([]),
    prisma.lessonChange.findMany({ where: { taskId }, select: { lessonId: true }, distinct: ['lessonId'] }),
    // What it changed, who saved it, whether learners see it.
    improvementRecords(viewer, [taskId]),
  ]);
  const own = new Set((places?.targets ?? []).filter((target) => target.copy === 'own').map((target) => target.lessonId));
  const saved = new Set(savedChanges.map((change) => change.lessonId));

  return {
    task,
    discussion,
    canWork,
    canDelete: canWorkOnFeedback(viewer, ref, 'tasks', [Permission.DELETE]),
    // The core proposal made from a group task opens only for those who reach the whole course.
    canSeeCore: canReadFeedback(viewer, { courseId: task.courseId, groupIds: [] }, 'tasks'),
    aiEnabled,
    aiDraft: draftRow ? await draftView(draftRow, viewer.id, 'plan') : null,
    record: records.get(taskId) ?? null,
    // Where it is on its way from feedback to a published lesson.
    path: task.refs.lesson ? await loadRevisionPath(taskId, aiEnabled) : null,
    // Where the change goes: its lessons, others it could add, and whether it reaches the main course.
    places: {
      lessons: versionLessons
        .filter((lesson) => own.has(lesson.id))
        .map((lesson) => ({
          id: lesson.id,
          position: lesson.position,
          title: lesson.title,
          href: `/admin/courses/${lesson.courseId}/lessons/${lesson.id}/improvements?i=${taskId}`,
          saved: saved.has(lesson.id),
        })),
      addable: canWork ? versionLessons.filter((lesson) => !own.has(lesson.id)).map(({ id, position, title }) => ({ id, position, title })) : [],
      // A group's lessons with a main-course lesson behind them (not ones added in the copy only).
      courseReachable: Object.keys(places?.courseLessons ?? {}).length > 0,
      toCourse: Boolean(places?.targets.some((target) => target.copy === 'course')),
      scope: places?.scope ?? null,
    },
    // "Ready for the AI agent" only where the vault agent is part of the work.
    vaultAgent: await usesVaultAgent(organizationId),
    users,
  };
}

export type TaskDetailData = NonNullable<Awaited<ReturnType<typeof loadTaskDetail>>>;
