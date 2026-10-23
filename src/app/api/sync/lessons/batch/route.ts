import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Permission } from '@prisma/client';
import {
  createSyncLesson,
  updateSyncLesson,
  type CreateSyncLessonInput,
  type CreateSyncLessonResult,
} from '@/lib/curriculum-sync';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * 60s is the hard ceiling some serverless hosts set for a function (their builds reject anything
 * higher), so this is a constraint to fit inside rather than a preference: a long upload or batch has
 * to finish within it. Self-hosted there is no per-request cap at all and this is inert.
 */
export const maxDuration = 60;

/** Keeps one request from turning into an unbounded amount of work. */
const MAX_BATCH_ITEMS = 50;

/**
 * No new item starts after this long, so the response (with every result so far) always goes out
 * before `maxDuration` ends the function: the rest come back as not processed, for the next sync.
 */
const TIME_BUDGET_MS = 45_000;

type BatchItem = CreateSyncLessonInput & { lessonId?: unknown; ref?: unknown };

/**
 * Creates or updates many lessons in one request. The plugin previously sent one HTTP request per
 * lesson, so syncing a vault cost an invocation per note; this collapses that into one.
 *
 * Each item is applied with exactly the same logic as the single-lesson routes — an item with
 * `lessonId` updates (honouring `baseRevision` and its 409 conflict payload), one without creates.
 *
 * The response is always 200 and carries a per-item result, so one bad lesson doesn't discard the
 * rest of the push. Callers must read `results[i].ok` rather than relying on the status code. An item
 * that fails unexpectedly reports a 500 of its own (nothing of it was saved), and items left when the
 * time budget runs out a 503 with `notProcessed: true`: neither is written, so syncing again sends
 * them again (the plugin reports them as failed and leaves their notes unstamped).
 *
 * Each item may carry a `ref` the caller chooses, which is echoed back untouched on its result.
 * Callers should match on `ref` rather than on array position: a client that filters items before
 * sending (skipping notes that fail its own validation) has no reliable position to map back to,
 * and getting that wrong writes one lesson's identity onto another note.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE on the target version, named by `?versionId=`
 * or `X-Curriculum-Version-Id`.
 * Body: `{ lessons: [{ lessonId?, title, markdownContent, … }] }`.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  let payload: { lessons?: unknown };

  try {
    payload = (await request.json()) as { lessons?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const items = payload.lessons;

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'lessons must be an array.' }, { status: 400 });
  }

  if (items.length > MAX_BATCH_ITEMS) {
    return NextResponse.json(
      { error: `A batch may hold at most ${MAX_BATCH_ITEMS} lessons.` },
      { status: 413 }
    );
  }

  const results = [];
  const touchedCourseIds = new Set<string>();

  // Sequential on purpose: lessons take their position from the current end of the version, so
  // creating them in parallel would race for the same slot.
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as BatchItem;
    const lessonId = typeof item?.lessonId === 'string' ? item.lessonId.trim() : '';

    const ref = typeof item?.ref === 'string' ? item.ref : undefined;

    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      results.push({
        index,
        ...(ref === undefined ? {} : { ref }),
        ok: false as const,
        status: 503,
        error: 'Not sent: the server ran out of time for this batch. Sync again to send it.',
        notProcessed: true as const,
      });
      continue;
    }

    let result: CreateSyncLessonResult;
    try {
      result = lessonId
        ? await updateSyncLesson(auth.versionId, lessonId, item, auth.userId)
        : await createSyncLesson(auth.versionId, item, auth.userId);
    } catch (error) {
      // Each item writes in its own transaction, so this one left nothing behind and the items
      // before it stay saved; their results still go back.
      console.error('Lesson sync failed for one batch item', error);
      result = { ok: false, status: 500, error: 'The server could not save this lesson. Sync again to retry.' };
    }

    if (result.ok) {
      touchedCourseIds.add(result.courseId);
      results.push({ index, ...(ref === undefined ? {} : { ref }), ok: true as const, lesson: result.lesson });
    } else {
      results.push({
        index,
        ...(ref === undefined ? {} : { ref }),
        ok: false as const,
        status: result.status,
        error: result.error,
        ...(result.conflict ? { conflict: true as const, server: result.conflict } : {}),
      });
    }
  }

  // Once per batch rather than once per lesson.
  if (touchedCourseIds.size > 0) {
    revalidatePath('/admin/courses');
    for (const courseId of Array.from(touchedCourseIds)) {
      revalidatePath(`/admin/courses/${courseId}`);
      revalidatePath(`/admin/courses/${courseId}/versions/${auth.versionId}`);
    }
  }

  return NextResponse.json({ results });
}
