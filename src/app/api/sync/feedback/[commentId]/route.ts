import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';
import { answerFromVault } from '@/lib/vault-feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A piece of feedback ticked in the Obsidian vault, as Reply does in the app: the reply (if any) is
 * saved, and feedback no improvement uses is done. Feedback already done (in the app, say) is left
 * as it is (`skipped`). The feedback must be on the requested curriculum version.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE + TASKS on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id`.
 * Body: `{ status: 'RESOLVED', reply?: string }`. Answers `{ feedback: { id, done, skipped } }`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE, Permission.TASKS]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  const { commentId } = await params;
  let payload: { status?: unknown; reply?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }
  if (payload?.status !== 'RESOLVED') {
    return NextResponse.json({ error: 'Only RESOLVED is accepted.' }, { status: 400 });
  }
  if (payload.reply !== undefined && typeof payload.reply !== 'string') {
    return NextResponse.json({ error: 'Invalid reply.' }, { status: 400 });
  }

  const result = await answerFromVault({ versionId: auth.versionId, commentId, reply: (payload.reply as string | undefined) ?? '' });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath('/admin', 'layout');

  return NextResponse.json({ feedback: { id: commentId, done: result.done, skipped: result.skipped } });
}
