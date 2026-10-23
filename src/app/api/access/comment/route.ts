import { NextResponse } from 'next/server';
import { learnerError } from '@/app/l/learner-locale';
import { withLearnerAccess } from '@/lib/course-access';
import {
  createViewerComment,
  deleteViewerComment,
  listViewerCommentsForLesson,
} from '@/lib/curriculum-comments';

export const runtime = 'nodejs';

type CreatePayload = {
  token?: string;
  lessonId?: string;
  selectedText?: string;
  context?: string | null;
  body?: string;
};

/** Create a comment from a personal (member-bound) access link on a lesson. */
export async function POST(request: Request) {
  let payload: CreatePayload;

  try {
    payload = (await request.json()) as CreatePayload;
  } catch {
    return NextResponse.json({ error: await learnerError('', 'Invalid JSON payload.') }, { status: 400 });
  }

  const token = payload.token?.trim() ?? '';
  // Each request checks its link once, and reads the link's organisation even when a team
  // member is signed in in this browser (`withLearnerAccess`).
  const result = await withLearnerAccess(token, () =>
    createViewerComment({
      token,
      lessonId: payload.lessonId ?? '',
      selectedText: payload.selectedText ?? '',
      context: payload.context ?? null,
      body: payload.body ?? '',
    })
  );

  if (!result.ok) {
    return NextResponse.json({ error: await learnerError(token, result.error) }, { status: result.status });
  }

  return NextResponse.json({ comment: result.comment }, { status: 201 });
}

/** List this link's comments for a lesson (?token=&lessonId=) — powers the gutter bubbles. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim() ?? '';
  const lessonId = url.searchParams.get('lessonId') ?? '';

  const comments = await withLearnerAccess(token, () => listViewerCommentsForLesson({ token, lessonId }));

  if (comments === null) {
    return NextResponse.json({ comments: [] });
  }

  return NextResponse.json({ comments });
}

/** Delete one of this link's own comments (?token=&commentId=). */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim() ?? '';
  const commentId = url.searchParams.get('commentId') ?? '';

  const result = await withLearnerAccess(token, () => deleteViewerComment({ token, commentId }));

  if (!result.ok) {
    return NextResponse.json({ error: await learnerError(token, result.error) }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
