import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync, createSyncArc, type CreateSyncArcInput } from '@/lib/curriculum-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Creates an arc (a part of the course) at the end of the requested curriculum version, so the
 * plugin can create a vault's parts before it syncs their lessons (which reference arcs by `arcId`).
 * When the version already has an arc with that title (ignoring case), nothing is created: the
 * answer is 409 `{ error, reason: "arc_exists", arc }`, with the arc to use instead.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id` (required: a token acts as its owner and may reach several).
 * Body: `{ title, description? }` → 201 `{ arc: { id, title, description, position } }`.
 */
export async function POST(request: Request) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  let payload: CreateSyncArcInput;

  try {
    payload = (await request.json()) as CreateSyncArcInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const result = await createSyncArc(auth.versionId, payload ?? {});

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.reason ? { reason: result.reason, arc: result.arc } : {}) },
      { status: result.status }
    );
  }

  revalidatePath(`/admin/courses/${result.courseId}/versions/${auth.versionId}`);
  revalidatePath(`/admin/courses/${result.courseId}/versions/${auth.versionId}/preview`);

  return NextResponse.json({ arc: result.arc }, { status: 201 });
}
