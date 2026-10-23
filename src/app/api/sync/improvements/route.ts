import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';
import { planFromVault } from '@/lib/vault-feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A plan written in the Obsidian vault for a lesson's open feedback that no improvement uses yet:
 * the feedback joins the lesson's open improvement (started for it when there's none), which takes
 * the plan, is the vault's to work on (also one started in the app) and moves to In progress. Answers
 * the improvement's id.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE + TASKS on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id`.
 * Body: `{ lessonId: string, plan: string, feedbackIds: string[] }` (the plan not empty).
 */
export async function POST(request: Request) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE, Permission.TASKS]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  let payload: { lessonId?: unknown; plan?: unknown; feedbackIds?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const { lessonId, plan, feedbackIds } = payload ?? {};
  if (typeof lessonId !== 'string' || !lessonId) {
    return NextResponse.json({ error: 'Name the lesson.' }, { status: 400 });
  }
  if (typeof plan !== 'string' || !plan.trim()) {
    return NextResponse.json({ error: 'The plan is empty.' }, { status: 400 });
  }
  if (!Array.isArray(feedbackIds) || !feedbackIds.length || !feedbackIds.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'Name the feedback the plan covers.' }, { status: 400 });
  }

  const result = await planFromVault({ versionId: auth.versionId, lessonId, plan, commentIds: feedbackIds as string[], userId: auth.userId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath('/admin', 'layout');

  return NextResponse.json({ task: { id: result.taskId } });
}
