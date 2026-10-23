import { NextResponse } from 'next/server';
import { learnerError } from '@/app/l/learner-locale';
import { withLearnerAccess } from '@/lib/course-access';
import {
  createViewerNote,
  deleteViewerNote,
  listViewerNotesForLesson,
  updateViewerNote,
} from '@/lib/lesson-notes';

export const runtime = 'nodejs';

/** A note belongs to one reader — never let an intermediary hold on to a payload. */
const PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' } as const;

type CreatePayload = {
  token?: string;
  lessonId?: string;
  selectedText?: string;
  context?: string | null;
  body?: string;
};

type UpdatePayload = {
  token?: string;
  noteId?: string;
  body?: string;
};

/** Create a note from a personal (member-bound) access link on a lesson. */
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
    createViewerNote({
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

  return NextResponse.json({ note: result.note }, { status: 201, headers: PRIVATE_HEADERS });
}

/**
 * List this owner's notes for a lesson (?token=&lessonId=) — powers the gutter bubbles. Returns an
 * empty list rather than 403 on any failure, so a reader without notes (a group link) doesn't get
 * console errors for a feature they simply don't have.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim() ?? '';
  const lessonId = url.searchParams.get('lessonId') ?? '';

  const notes = await withLearnerAccess(token, () => listViewerNotesForLesson({ token, lessonId }));

  return NextResponse.json({ notes: notes ?? [] }, { headers: PRIVATE_HEADERS });
}

/**
 * Edit the body of one of this owner's notes. The note text travels in the JSON body, never the
 * query string: it can be several kilobytes and it's private.
 */
export async function PATCH(request: Request) {
  let payload: UpdatePayload;

  try {
    payload = (await request.json()) as UpdatePayload;
  } catch {
    return NextResponse.json({ error: await learnerError('', 'Invalid JSON payload.') }, { status: 400 });
  }

  const token = payload.token?.trim() ?? '';
  const result = await withLearnerAccess(token, () =>
    updateViewerNote({
      token,
      noteId: payload.noteId ?? '',
      body: payload.body ?? '',
    })
  );

  if (!result.ok) {
    return NextResponse.json({ error: await learnerError(token, result.error) }, { status: result.status });
  }

  return NextResponse.json({ note: result.note }, { headers: PRIVATE_HEADERS });
}

/** Delete one of this owner's own notes (?token=&noteId=). */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim() ?? '';
  const noteId = url.searchParams.get('noteId') ?? '';

  const result = await withLearnerAccess(token, () => deleteViewerNote({ token, noteId }));

  if (!result.ok) {
    return NextResponse.json({ error: await learnerError(token, result.error) }, { status: result.status });
  }

  return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
}
