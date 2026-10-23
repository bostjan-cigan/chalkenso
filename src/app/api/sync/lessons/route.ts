import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Permission } from '@prisma/client';
import {
  authorizeCurriculumSync,
  createSyncLesson,
  type CreateSyncLessonInput,
} from '@/lib/curriculum-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Creates one new lesson in the requested curriculum version. Sync is create-only — a duplicate slug
 * returns 409 rather than overwriting — and arcs must already exist (referenced by `arcId`; create
 * them with `POST /api/sync/arcs`).
 *
 * Auth: `Authorization: Bearer <token>` with WRITE on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id` (required: a token acts as its owner and may reach several).
 * Body: `{ title, markdownContent, arcId?, slug?, shortDescription?, status? }`.
 */
export async function POST(request: Request) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  let payload: CreateSyncLessonInput;

  try {
    payload = (await request.json()) as CreateSyncLessonInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const result = await createSyncLesson(auth.versionId, payload, auth.userId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${result.courseId}`);
  revalidatePath(`/admin/courses/${result.courseId}/versions/${auth.versionId}`);

  return NextResponse.json({ lesson: result.lesson }, { status: 201 });
}
