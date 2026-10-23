import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';
import { listSyncFeedbackForVersion, listSyncTasksForVersion } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything the vault needs about the requested curriculum version's feedback, done included:
 * `tasks` are its improvements and lesson briefs in any state but ignored, each with the lesson and
 * the feedback it uses, `aiReady` (cleared for the local agent to execute end to end) and
 * `workplace` (APP: started in the app; the vault takes it over by sending work); `feedback` is every open
 * piece of feedback and the most recent done ones, with the tasks that use each. The Obsidian plugin
 * writes one note per lesson from them.
 *
 * Auth: `Authorization: Bearer <token>` with READ + TASKS on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id` (required: a token acts as its owner and may reach several).
 */
export async function GET(request: Request) {
  const auth = await authorizeCurriculumSync(request, [Permission.READ, Permission.TASKS]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  const [tasks, feedback] = await Promise.all([listSyncTasksForVersion(auth.versionId), listSyncFeedbackForVersion(auth.versionId)]);

  return NextResponse.json({ tasks, feedback });
}
