import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Permission } from '@prisma/client';
import {
  authorizeCurriculumSync,
  deleteSyncLesson,
  updateSyncLesson,
  type CreateSyncLessonInput,
} from '@/lib/curriculum-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-sync: updates an existing lesson (title, body, arc, status, and re-binds images) in the token's
 * curriculum version. The lesson must belong to that version.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id` (required: a token acts as its owner and may reach several).
 * Body: `{ title, markdownContent, arcId?, slug?, shortDescription?, status?, assetBindings?,
 * baseRevision? }`. When `baseRevision` no longer matches the lesson, nothing is written and the
 * response is 409 `{ error, conflict: true, server: { revision, title, markdownContent, … } }`.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  const { lessonId } = await params;

  let payload: CreateSyncLessonInput;

  try {
    payload = (await request.json()) as CreateSyncLessonInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const result = await updateSyncLesson(auth.versionId, lessonId, payload, auth.userId);

  if (!result.ok) {
    return NextResponse.json(
      result.conflict
        ? { error: result.error, conflict: true, server: result.conflict }
        : { error: result.error },
      { status: result.status }
    );
  }

  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${result.courseId}`);
  revalidatePath(`/admin/courses/${result.courseId}/versions/${auth.versionId}`);

  return NextResponse.json({ lesson: result.lesson });
}

/**
 * Deletes a lesson from the requested curriculum version. Sync clients only call this from an
 * explicit, confirmed user command — never as a side effect of a note disappearing.
 *
 * Auth: `Authorization: Bearer <token>` with DELETE on the target version, named by `?versionId=`
 * or `X-Curriculum-Version-Id`.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const auth = await authorizeCurriculumSync(request, [Permission.DELETE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  const { lessonId } = await params;
  const result = await deleteSyncLesson(auth.versionId, lessonId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${result.courseId}`);
  revalidatePath(`/admin/courses/${result.courseId}/versions/${auth.versionId}`);

  return NextResponse.json({ deleted: true });
}
