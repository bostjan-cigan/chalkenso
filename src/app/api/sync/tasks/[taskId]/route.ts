import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Permission, TaskStatus, TaskWorkplace } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';
import { startImprovement } from '@/lib/task-flow';
import { takeUpFromVault } from '@/lib/vault-feedback';
import {
  setTaskAiReady,
  taskBelongsToVersion,
  updateTaskPlan,
  updateTaskStatus,
} from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseStatus(value: unknown): TaskStatus | null {
  return typeof value === 'string' && (Object.values(TaskStatus) as string[]).includes(value)
    ? (value as TaskStatus)
    : null;
}

/**
 * Updates a feedback task from Obsidian: its revision plan (written in the feedback note, which is
 * the plan's source of truth), its lane (completed or ignored), and/or its agent handoff flag —
 * which the agent clears once it has taken the revision over, so the dashboard stops advertising it
 * as waiting. `useFeedback` names open feedback the plan covers: it joins the lesson's improvement
 * first. A plan or the flag on a To do task starts it: the vault is working on it. The plan is saved
 * before the status, so a plan sent together with the closing tick is kept. The task must be linked
 * to the requested curriculum version. Whatever the vault sends makes the task the vault's, also one
 * started in the app ("In Obsidian" there, until its "Work on it here" takes it back).
 *
 * Auth: `Authorization: Bearer <token>` with WRITE + TASKS on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id` (required: a token acts as its owner and may reach several).
 * Body: `{ status?: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'IGNORED', plan?: string, aiReady?: boolean,
 * useFeedback?: string[] }` (at least one of the first three; an empty plan clears it).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE, Permission.TASKS]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  const { taskId } = await params;

  let payload: { status?: unknown; plan?: unknown; aiReady?: unknown; useFeedback?: unknown };

  try {
    payload = (await request.json()) as { status?: unknown; plan?: unknown; aiReady?: unknown; useFeedback?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const hasStatus = payload?.status !== undefined;
  const hasPlan = payload?.plan !== undefined;
  const hasAiReady = payload?.aiReady !== undefined;
  const status = hasStatus ? parseStatus(payload.status) : null;

  if (!hasStatus && !hasPlan && !hasAiReady) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  if (hasStatus && !status) {
    return NextResponse.json({ error: 'Invalid task status.' }, { status: 400 });
  }
  if (hasPlan && typeof payload.plan !== 'string') {
    return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
  }
  if (hasAiReady && typeof payload.aiReady !== 'boolean') {
    return NextResponse.json({ error: 'Invalid aiReady flag.' }, { status: 400 });
  }
  const useFeedback = payload?.useFeedback;
  if (useFeedback !== undefined && !(Array.isArray(useFeedback) && useFeedback.every((id) => typeof id === 'string'))) {
    return NextResponse.json({ error: 'Invalid useFeedback list.' }, { status: 400 });
  }

  if (!(await taskBelongsToVersion(taskId, auth.versionId))) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  // The vault works on it now, also when it was started in the app.
  await prisma.task.update({ where: { id: taskId }, data: { workplace: TaskWorkplace.VAULT } });
  if (useFeedback?.length) {
    await takeUpFromVault({ versionId: auth.versionId, commentIds: useFeedback as string[], userId: auth.userId });
  }
  if (hasPlan) {
    await updateTaskPlan(taskId, payload.plan as string);
  }
  if (hasAiReady) {
    await setTaskAiReady(taskId, payload.aiReady as boolean);
  }
  if (status) {
    await updateTaskStatus(taskId, status);
  } else if (hasPlan || hasAiReady) {
    await startImprovement(taskId);
  }
  // The task board, the lesson's Improve view and the feedback lists all show it.
  revalidatePath('/admin', 'layout');

  return NextResponse.json({
    task: { id: taskId, status, ...(hasAiReady ? { aiReady: payload.aiReady as boolean } : {}) },
  });
}
