'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AiProposalKind, AiProposalStatus, Permission, TaskStatus, TaskWorkplace } from '@prisma/client';
import { getCurrentUserSession, requireSection } from '@/lib/admin-auth';
import {
  canReadFeedback,
  canWorkOnFeedback,
  hasAnyAccess,
  loadTaskRef,
  requireCrmAccess,
  requireTaskWork,
} from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { deleteFeedbackTask } from '@/lib/curriculum-comments';
import { planContext } from '@/app/admin/courses/ai-context';
import { backgroundAiKey, draftRevisionPlan } from '@/lib/ai';
import { partialTag, type AppDraftView } from '@/lib/ai-draft-progress';
import { draftView, loadDraft, settleDraft, startAppDraft } from '@/lib/ai-drafts';
import { finishImprovement, startImprovement, workHere, type ImprovementMove } from '@/lib/task-flow';
import { improvementPlaces } from '@/lib/improvement-targets';
import { parsePlanScope, planBody, withPlanScope } from '@/lib/plan-scope';
import {
  addTaskComment,
  assignTask,
  deleteIgnoredTasks,
  deleteOrphanTasks,
  proposeTaskForCore,
  setTaskAiReady,
  setTaskGroupOnly,
  updateTaskDescription,
  updateTaskPlan,
  updateTaskStatus,
  listAssignableUsers,
  TASK_ENTITY_ROLE,
  TASK_ENTITY_TYPE,
} from '@/lib/tasks';

const ADMIN_TASKS_PATH = '/admin/tasks';

function parseStatus(value: string): TaskStatus | null {
  return (Object.values(TaskStatus) as string[]).includes(value)
    ? (value as TaskStatus)
    : null;
}

/**
 * Working on a task: Feedback & tasks on its course or group (its learners' feedback, also on the
 * core curriculum a group reads); untied tasks only for the Tasks section. `extra` adds DELETE.
 */
async function requireTaskTriage(taskId: string, extra: Permission[] = []) {
  const viewer = await requireTaskWork(taskId, extra);
  const versionLink = await prisma.taskEntityLink.findFirst({
    where: { taskId, entityType: TASK_ENTITY_TYPE.curriculumVersion },
    select: { entityId: true },
  });
  return { viewer, versionId: versionLink?.entityId ?? null };
}

/**
 * Revalidates every page a task shows on: the board, its detail page, and — for a group
 * curriculum — that group's page, which renders its own lane.
 */
async function revalidateTaskSurfaces(taskId: string, versionId: string | null) {
  revalidatePath(ADMIN_TASKS_PATH);
  revalidatePath(`${ADMIN_TASKS_PATH}/${taskId}`);

  const ownerGroupId = versionId
    ? (
        await prisma.curriculumVersion.findUnique({
          where: { id: versionId },
          select: { ownerGroupId: true },
        })
      )?.ownerGroupId
    : null;
  if (ownerGroupId) {
    revalidatePath(`/admin/courses/groups/${ownerGroupId}`);
  }
}

async function viewerWithName(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true, identifier: true },
  });
}

function adminDisplayName(user: {
  firstName: string | null;
  lastName: string | null;
  identifier: string;
}) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.identifier;
}

/** Move a task to a new status (TODO / IN_PROGRESS / DONE / IGNORED) via a form submit. */
export async function updateTaskStatusAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '').trim();
  const status = parseStatus(String(formData.get('status') ?? '').trim());

  if (!taskId || !status) {
    return;
  }

  const { versionId } = await requireTaskTriage(taskId);

  await updateTaskStatus(taskId, status);
  await revalidateTaskSurfaces(taskId, versionId);
}

/** Only admin paths may be revalidated from a form's `returnPath`. */
function safeReturnPath(value: FormDataEntryValue | null): string | null {
  const path = String(value ?? '').trim();
  return path.startsWith('/admin/') && !path.startsWith('//') ? path : null;
}

/**
 * Quick decision on a task from elsewhere in the CRM (e.g. a course's fork list): start / ignore a
 * group task, accept (start on the core) / decline a proposal, or keep finished group work
 * group-only (`status=GROUP_ONLY`). Stays on the page it came from.
 */
export async function taskDecisionAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '').trim();
  const rawStatus = String(formData.get('status') ?? '').trim();
  const groupOnly = rawStatus === 'GROUP_ONLY';
  const status = groupOnly ? null : parseStatus(rawStatus);
  const returnPath = safeReturnPath(formData.get('returnPath'));

  if (!taskId || (!status && !groupOnly)) {
    return;
  }

  const { versionId } = await requireTaskTriage(taskId);

  if (groupOnly) {
    await setTaskGroupOnly(taskId, true);
  } else if (status) {
    await updateTaskStatus(taskId, status);
  }
  await revalidateTaskSurfaces(taskId, versionId);
  if (returnPath) {
    revalidatePath(returnPath);
  }
}

/** Move a task by direct args — used by the kanban board's drag-and-drop. */
export async function moveTaskAction(taskId: string, status: TaskStatus) {
  const parsed = parseStatus(status);
  if (!taskId || !parsed) {
    return;
  }

  const { versionId } = await requireTaskTriage(taskId);

  await updateTaskStatus(taskId, parsed);
  await revalidateTaskSurfaces(taskId, versionId);
}

/**
 * Permanently deletes tasks that are not tied to any curriculum (test leftovers). The Tasks section
 * owns them: with no curriculum behind them there is no group grant that could scope them to an
 * instructor. `deleteOrphanTasks` re-checks that each id really is untied before removing it.
 */
export async function deleteOrphanTasksAction(taskIds: string[]) {
  const ids = Array.from(
    new Set(taskIds.map((id) => String(id ?? '').trim()).filter(Boolean))
  );
  if (!ids.length) {
    return { deleted: 0, refused: 0 };
  }

  await requireSection('tasks', [Permission.READ, Permission.TASKS, Permission.DELETE]);

  const result = await deleteOrphanTasks(ids);
  revalidatePath(ADMIN_TASKS_PATH);
  return result;
}

/**
 * Clears a task for the local agent, or takes that clearance back. Same triage permission as moving
 * the task: whoever may decide its lane may also decide who executes it.
 */
export async function setTaskAiReadyAction(taskId: string, aiReady: boolean) {
  if (!taskId) {
    return;
  }

  const { versionId } = await requireTaskTriage(taskId);

  await setTaskAiReady(taskId, aiReady);
  await revalidateTaskSurfaces(taskId, versionId);
}

/**
 * Deletes ignored tasks — one card, or a lane's whole Ignored column. Unlike the untied-task
 * cleanup this touches live curricula, so each task is authorized against its own curriculum:
 * instructors clear their group's lane, the section clears any. `deleteIgnoredTasks` re-checks that
 * every id really is IGNORED before removing it.
 */
export async function deleteIgnoredTasksAction(taskIds: string[]) {
  const ids = Array.from(
    new Set(taskIds.map((id) => String(id ?? '').trim()).filter(Boolean))
  );
  if (!ids.length) {
    return { deleted: 0, refused: 0 };
  }

  const viewer = await requireCrmAccess(hasAnyAccess);

  // Each task on its own course or group: Feedback & tasks plus delete rights there.
  const { deleted, refused, groupIds } = await deleteIgnoredTasks(ids, (ref) =>
    canWorkOnFeedback(viewer, ref, 'tasks', [Permission.DELETE])
  );

  revalidatePath(ADMIN_TASKS_PATH);
  for (const groupId of groupIds) {
    revalidatePath(`/admin/courses/groups/${groupId}`);
  }

  return { deleted, refused };
}

/** Assign a task to a user, or clear it (empty `assigneeId` = unassigned). */
export async function setTaskAssigneeAction(taskId: string, assigneeId: string) {
  if (!taskId) {
    return;
  }

  const { versionId } = await requireTaskTriage(taskId);

  // Only to someone who may also work on this task (its course or group, in this organisation).
  if (assigneeId) {
    const organizationId = (await getCurrentUserSession())?.user.organization?.id;
    const ref = await loadTaskRef(taskId);
    const allowed = organizationId && ref ? await listAssignableUsers(organizationId, ref) : [];
    if (!allowed.some((user) => user.id === assigneeId)) {
      return;
    }
  }

  await assignTask(taskId, assigneeId || null);
  await revalidateTaskSurfaces(taskId, versionId);
}

/** Add an admin discussion note to a task. */
export async function addTaskCommentAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (!taskId || !body) {
    return;
  }

  const user = await viewerWithName(
    (await requireTaskTriage(taskId)).viewer.id
  );

  await addTaskComment({
    taskId,
    authorId: user.id,
    authorName: adminDisplayName(user),
    body,
  });
  revalidatePath(`${ADMIN_TASKS_PATH}/${taskId}`);
}

/** Save a task's instructions (its description). */
export async function updateTaskDescriptionAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '').trim();
  if (!taskId) {
    return;
  }

  await requireTaskTriage(taskId);
  await updateTaskDescription(taskId, String(formData.get('description') ?? ''));
  revalidatePath(`${ADMIN_TASKS_PATH}/${taskId}`);
}

/**
 * Lesson Feedback panel: delete a revision task for good, with the feedback it was made from (the
 * comment, and any other task made from it). Needs delete rights on the task's course or group.
 */
export async function deleteLessonFeedbackAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '').trim();
  const lessonPath = String(formData.get('lessonPath') ?? '').trim();
  if (!taskId) {
    return;
  }

  const { versionId } = await requireTaskTriage(taskId, [Permission.DELETE]);
  await deleteFeedbackTask(taskId);

  await revalidateTaskSurfaces(taskId, versionId);
  revalidatePath('/admin/courses/comments', 'layout');
  if (lessonPath.startsWith('/admin/courses/')) {
    revalidatePath(lessonPath);
  }
}

/**
 * Proposes a group revision for the core curriculum: creates a linked core task and opens it. With
 * a `returnPath` (e.g. from a course's fork list) it stays on that page instead.
 */
export async function proposeForCoreAction(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '').trim();
  const returnPath = safeReturnPath(formData.get('returnPath'));
  // Instructors may propose from their group's tasks; the proposal lands on the core for triage.
  const { viewer: user, versionId } = await requireTaskTriage(taskId);

  const result = await proposeTaskForCore({ taskId, createdById: user.id });
  if (result.ok) {
    // The main course's part is the suggestion's now: changes already waiting there go with it.
    const own = await prisma.taskEntityLink.findMany({ where: { taskId, entityType: TASK_ENTITY_TYPE.lesson }, select: { entityId: true } });
    await prisma.aiProposal.updateMany({
      where: {
        kind: AiProposalKind.LESSON_REVISION,
        taskId,
        targetId: { notIn: own.map((link) => link.entityId) },
        status: { in: [AiProposalStatus.OPEN, AiProposalStatus.WORKING] },
      },
      data: { taskId: result.taskId },
    });
    await settlePlaces(taskId);
  }

  await revalidateTaskSurfaces(taskId, versionId);

  if (returnPath) {
    revalidatePath(returnPath);
    return;
  }

  // Instructors stay on their group task (the core proposal is for whoever has the whole course).
  const ref = result.ok ? await loadTaskRef(result.taskId) : null;
  const openProposal = result.ok && Boolean(ref && canReadFeedback(user, { courseId: ref.courseId, groupIds: [] }, 'tasks'));
  redirect(`${ADMIN_TASKS_PATH}/${openProposal ? result.taskId : taskId}`);
}

/**
 * After an improvement's places changed (its scope, its lessons): drafts waiting on lessons it no
 * longer changes go (the main course's, once it stays with the group), and it is done if every
 * lesson it still changes is saved. Returns that move.
 */
async function settlePlaces(taskId: string): Promise<ImprovementMove | null> {
  const places = await improvementPlaces(prisma, taskId);
  if (!places) return null;
  await prisma.aiProposal.updateMany({
    where: {
      kind: AiProposalKind.LESSON_REVISION,
      taskId,
      targetId: { notIn: places.targets.map((target) => target.lessonId) },
      status: { in: [AiProposalStatus.OPEN, AiProposalStatus.WORKING] },
    },
    data: { status: AiProposalStatus.DISCARDED, decidedAt: new Date() },
  });
  return finishImprovement(prisma, taskId);
}

/** "Work on it here": back from the vault into the app (the vault's checklist drops it). */
export async function workHereAction(taskId: string): Promise<void> {
  const { versionId } = await requireTaskTriage(taskId);
  await prisma.task.update({ where: { id: taskId }, data: { workplace: TaskWorkplace.APP } });
  await revalidateTaskSurfaces(taskId, versionId);
}

/** Save the revision plan written in the dashboard (the vault edits the same field when synced). */
/**
 * An improvement's notes for AI (the instructor's own words about it, kept on it): planning and
 * drafting here use them, and Claude (the connector's get_task) and Obsidian (the sync API) read them.
 */
export async function updateImprovementNotesAction(taskId: string, notes: string): Promise<{ ok: boolean; message?: string }> {
  if (!taskId || typeof notes !== 'string') return { ok: false, message: (await getTranslations('tasks.plan'))('notFound') };
  const { versionId } = await requireTaskTriage(taskId);
  await prisma.task.update({ where: { id: taskId }, data: { aiNotes: notes.trim().slice(0, 4000) || null } });
  await revalidateTaskSurfaces(taskId, versionId);
  return { ok: true };
}

export async function updateTaskPlanAction(
  taskId: string,
  plan: string
): Promise<{ ok: boolean; message: string; moved?: ImprovementMove | null }> {
  const t = await getTranslations('tasks.plan');
  if (!taskId) {
    return { ok: false, message: t('notFound') };
  }
  const { versionId } = await requireTaskTriage(taskId);
  // Saved here, it covers the feedback used so far, changed or not.
  await updateTaskPlan(taskId, plan, { touch: true });
  if (plan.trim()) await workHere(prisma, [taskId]);
  // Choosing the main course again takes back an earlier "keep it to the group".
  if (parsePlanScope(plan) === 'group and core') await setTaskGroupOnly(taskId, false);
  // A plan written is the work started; one that keeps the change to the group may finish it.
  const moved = (plan.trim() ? await startImprovement(taskId) : null) ?? (await settlePlaces(taskId));
  await revalidateTaskSurfaces(taskId, versionId);
  return { ok: true, message: t('saved'), moved };
}

/**
 * "Leave the main course as it is": the group's improvement changes the group's copy only (its
 * plan says so, and the course's list stops asking), the proposed changes waiting on the main
 * course's lesson go, and it is done if the group's lessons are saved.
 */
export async function leaveCourseAsItIsAction(taskId: string): Promise<{ moved: ImprovementMove | null }> {
  const { versionId } = await requireTaskTriage(taskId);
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { plan: true } });
  if (!task) return { moved: null };
  await updateTaskPlan(taskId, withPlanScope(task.plan, 'group only'));
  await setTaskGroupOnly(taskId, true);
  const moved = await settlePlaces(taskId);
  await revalidateTaskSurfaces(taskId, versionId);
  return { moved };
}

/**
 * "Add a lesson": one improvement for several lessons of the same course or group copy. The plan
 * covers them all; each is revised and reviewed on its own page, and it's done when each is saved.
 */
export async function addImprovementLessonAction(taskId: string, lessonId: string): Promise<{ ok: boolean }> {
  const { versionId } = await requireTaskTriage(taskId);
  const lesson = versionId
    ? await prisma.lesson.findFirst({ where: { id: lessonId, curriculumVersionId: versionId }, select: { id: true } })
    : null;
  if (!lesson) return { ok: false };
  await prisma.taskEntityLink.upsert({
    where: {
      taskId_entityType_entityId_role: { taskId, entityType: TASK_ENTITY_TYPE.lesson, entityId: lesson.id, role: TASK_ENTITY_ROLE.subject },
    },
    create: { taskId, entityType: TASK_ENTITY_TYPE.lesson, entityId: lesson.id, role: TASK_ENTITY_ROLE.subject },
    update: {},
  });
  await revalidateTaskSurfaces(taskId, versionId);
  return { ok: true };
}

/**
 * Takes a lesson back out of an improvement: never its last one, nor one already saved for it.
 * Drafts waiting there for it go, and it may be done now.
 */
export async function removeImprovementLessonAction(taskId: string, lessonId: string): Promise<{ ok: boolean; moved: ImprovementMove | null }> {
  const { versionId } = await requireTaskTriage(taskId);
  const [lessonLinks, saved] = await Promise.all([
    prisma.taskEntityLink.findMany({ where: { taskId, entityType: TASK_ENTITY_TYPE.lesson }, select: { id: true, entityId: true } }),
    prisma.lessonChange.count({ where: { taskId, lessonId } }),
  ]);
  const link = lessonLinks.find((candidate) => candidate.entityId === lessonId);
  if (!link || lessonLinks.length < 2 || saved) return { ok: false, moved: null };
  await prisma.taskEntityLink.delete({ where: { id: link.id } });
  const moved = await settlePlaces(taskId);
  await revalidateTaskSurfaces(taskId, versionId);
  return { ok: true, moved };
}

/**
 * Drafts the plan with AI from the lesson and the feedback the improvement uses (`update`: the
 * current plan kept, with what the feedback used since it was written needs), in the background
 * (src/lib/ai-drafts.ts): returns at once with the draft, which the page follows as it is written
 * and which waits for review if the person leaves. Nothing is saved to the plan until the person
 * saves it.
 */
export async function startTaskPlanDraftAction(
  taskId: string,
  {
    update = false,
    revise,
  }: {
    update?: boolean;
    /** "Ask for changes": the plan as it is now (the box's text, or the saved one) and what to change in it. */
    revise?: { plan: string; request: string };
  } = {}
): Promise<{ ok: true; draft: AppDraftView; moved: ImprovementMove | null } | { ok: false; message: string }> {
  const { viewer } = await requireTaskTriage(taskId);
  // Its own lessons (one plan may cover several), the first one first.
  const lessonLinks = await prisma.taskEntityLink.findMany({
    where: { taskId, entityType: TASK_ENTITY_TYPE.lesson },
    orderBy: { createdAt: 'asc' },
    select: { entityId: true },
  });
  const lessonLink = lessonLinks[0];
  if (!lessonLink) {
    return { ok: false, message: (await getTranslations('tasks.plan'))('noLesson') };
  }
  // The feedback the task uses counts even once it is done.
  const [sources, task] = await Promise.all([
    prisma.taskEntityLink.findMany({
      where: { taskId, entityType: TASK_ENTITY_TYPE.curriculumComment, role: TASK_ENTITY_ROLE.source },
      select: { entityId: true, createdAt: true },
    }),
    prisma.task.findUnique({ where: { id: taskId }, select: { plan: true, planUpdatedAt: true, description: true, aiNotes: true } }),
  ]);
  const refine =
    revise && typeof revise.request === 'string' && revise.request.trim() && typeof revise.plan === 'string' && planBody(revise.plan)
      ? { plan: planBody(revise.plan).slice(0, 8000), request: revise.request.trim().slice(0, 1000) }
      : null;
  const currentPlan = refine ? refine.plan : update ? planBody(task?.plan) : '';
  const prepared = await planContext({
    lessonId: lessonLink.entityId,
    otherLessonIds: lessonLinks.slice(1).map((link) => link.entityId),
    sourceCommentIds: sources.map((link) => link.entityId),
    asked: task?.description ?? null,
    notes: task?.aiNotes ?? null,
    currentPlan: currentPlan || null,
    newCommentIds: !refine && currentPlan && task?.planUpdatedAt ? sources.filter((link) => link.createdAt > task.planUpdatedAt!).map((link) => link.entityId) : [],
    request: refine?.request ?? null,
  });
  if (!prepared.ok) {
    return prepared;
  }
  const ai = await backgroundAiKey();
  const organizationId = (await getCurrentUserSession())?.user.organization?.id;
  if (!ai.ok || !organizationId) {
    return { ok: false, message: ai.ok ? (await getTranslations('tasks.plan'))('notFound') : ai.message };
  }
  const row = await startAppDraft({
    organizationId,
    userId: viewer.id,
    kind: AiProposalKind.TASK_PLAN,
    targetType: 'task',
    targetId: taskId,
    taskId,
    run: async (progress, signal) => {
      const { plan, scope } = await draftRevisionPlan(prepared.context, {
        key: ai.key,
        userId: viewer.id,
        signal,
        // Only the plan itself is shown as it is written, not the answer's tags around it.
        onProgress: (next) => progress(next.stage === 'writing' ? { stage: 'writing', text: partialTag(next.text, 'plan') } : next),
      });
      return { payload: { plan: withPlanScope(plan, scope) } };
    },
  });
  const draft = await draftView(row, viewer.id, 'plan');
  if (!draft) return { ok: false, message: (await getTranslations('editor.ai.errors'))('generic') };
  await workHere(prisma, [taskId]);
  // Drafting the plan is the work started.
  const moved = await startImprovement(taskId);
  if (moved) await revalidateTaskSurfaces(taskId, null);
  return { ok: true, draft, moved };
}

/** A plan draft made in the app and the person's right to work on its task, or null. */
async function taskPlanDraft(draftId: string) {
  const row = await loadDraft(draftId, AiProposalKind.TASK_PLAN);
  if (!row) return null;
  const { viewer } = await requireTaskTriage(row.targetId);
  return { row, viewer };
}

/** How far a plan draft is (the page polls it while it runs); null once it was used or discarded. */
export async function taskPlanDraftAction(draftId: string): Promise<AppDraftView | null> {
  const found = await taskPlanDraft(draftId);
  return found ? draftView(found.row, found.viewer.id, 'plan') : null;
}

/** "Stop": the draft is no longer wanted, and the AI call stops at its next step. */
export async function stopTaskPlanDraftAction(draftId: string): Promise<void> {
  if (await taskPlanDraft(draftId)) await settleDraft(draftId, 'stopped');
}

/** A finished plan draft: used (it went into the plan and the plan was saved) or discarded. */
export async function settleTaskPlanDraftAction(draftId: string, used: boolean): Promise<void> {
  if (await taskPlanDraft(draftId)) await settleDraft(draftId, used ? 'used' : 'discarded');
}
