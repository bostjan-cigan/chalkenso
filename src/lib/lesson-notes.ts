import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from './prisma';
import { validateCourseAccessToken, type AccessValidationResult } from './course-access';
import { pausedRefusal } from './learner-paused';

/** Upper bounds so a link holder can't store unbounded text. */
export const NOTE_SELECTED_TEXT_MAX = 2000;
export const NOTE_CONTEXT_MAX = 4000;
/** Notes run longer than feedback — they're the reader's own working text. */
export const NOTE_BODY_MAX = 8000;

/**
 * v1 matches feedback: notes require a personal (member-bound) link. The owner model below already
 * handles link-only ownership, so opening notes to group links is this flag plus a UI gate — the
 * read path stays correct because the two ownership namespaces are disjoint.
 */
const ALLOW_LINK_ONLY_NOTES = false;

/** Public-safe shape returned to the reader's browser (nothing internal beyond the note id). */
export type ViewerNoteView = {
  id: string;
  selectedText: string;
  context: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

const NOTE_SELECT = {
  id: true,
  selectedText: true,
  context: true,
  body: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LessonNoteSelect;

function toViewerNote(note: {
  id: string;
  selectedText: string;
  context: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}): ViewerNoteView {
  return {
    id: note.id,
    selectedText: note.selectedText,
    context: note.context,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

type NoteOwner =
  | { kind: 'member'; memberId: string; accessLinkId: string }
  | { kind: 'link'; accessLinkId: string };

/** Resolves who owns notes taken through this token. Null = the token may not touch notes at all. */
function resolveNoteOwner(access: AccessValidationResult): NoteOwner | null {
  if (access.state !== 'valid' || !access.accessLinkId) {
    return null;
  }

  if (access.memberId) {
    return { kind: 'member', memberId: access.memberId, accessLinkId: access.accessLinkId };
  }

  // An instructor's private notes are their team notes (`api/team/note`), the same in the app and
  // through any of their instructor links.
  if (access.instructor) {
    return { kind: 'link', accessLinkId: `team:${access.instructor.userId}` };
  }

  return ALLOW_LINK_ONLY_NOTES ? { kind: 'link', accessLinkId: access.accessLinkId } : null;
}

/**
 * The ONLY owner filter. Both branches are fully specified: `undefined` never appears, because
 * Prisma silently drops undefined filters, which would widen a scoped query into "every note on
 * this lesson". The explicit `memberId: null` is what keeps the member-owned and link-owned
 * namespaces disjoint. Don't collapse this into one partial object literal — the union of concrete
 * literals is the compile-time guarantee.
 */
function ownerWhere(
  owner: NoteOwner
): { memberId: string } | { memberId: null; accessLinkId: string } {
  return owner.kind === 'member'
    ? { memberId: owner.memberId }
    : { memberId: null, accessLinkId: owner.accessLinkId };
}

export type CreateViewerNoteResult =
  { ok: true; note: ViewerNoteView } | { ok: false; status: number; error: string };

/**
 * Creates a private note from a personal (member-bound) access link. Rejects group links, invalid
 * or expired tokens, and lessons that don't belong to the version the token serves.
 * `selectedText`/`context`/`body` are trimmed and length-capped.
 */
export async function createViewerNote(input: {
  token: string;
  lessonId: string;
  selectedText: string;
  context?: string | null;
  body: string;
}): Promise<CreateViewerNoteResult> {
  const token = input.token?.trim();
  const lessonId = input.lessonId?.trim();
  const selectedText = input.selectedText?.trim();
  const body = input.body?.trim();
  const context = input.context?.trim() || null;

  if (!token || !lessonId) {
    return { ok: false, status: 400, error: 'Token and lessonId are required.' };
  }

  if (!selectedText) {
    return { ok: false, status: 400, error: 'Select some text to note.' };
  }

  if (!body) {
    return { ok: false, status: 400, error: 'Note text is required.' };
  }

  if (
    selectedText.length > NOTE_SELECTED_TEXT_MAX ||
    body.length > NOTE_BODY_MAX ||
    (context && context.length > NOTE_CONTEXT_MAX)
  ) {
    return { ok: false, status: 400, error: 'Note is too long.' };
  }

  const access = await validateCourseAccessToken(token);
  const owner = resolveNoteOwner(access);

  if (!owner) {
    return { ok: false, status: 403, error: 'Notes are only available on personal access links.' };
  }

  if (access.state !== 'valid' || !access.curriculumVersionId) {
    return { ok: false, status: 404, error: 'Lesson not found.' };
  }

  // Paused between classes: the link only reads.
  const paused = await pausedRefusal(access);
  if (paused) {
    return paused;
  }

  /** Ensure the lesson really belongs to the version this token serves. */
  const lesson = await prisma.lesson.findFirst({
    where: {
      id: lessonId,
      curriculumVersionId: access.curriculumVersionId,
      // Learners only see (and so only annotate) published lessons.
      publishedAt: { not: null },
    },
    select: { id: true },
  });

  if (!lesson) {
    return { ok: false, status: 404, error: 'Lesson not found.' };
  }

  const note = await prisma.lessonNote.create({
    data: {
      lessonId,
      // Written explicitly in both branches so the disjointness invariant holds at the row level.
      memberId: owner.kind === 'member' ? owner.memberId : null,
      accessLinkId: owner.accessLinkId,
      selectedText,
      context,
      body,
    },
    select: NOTE_SELECT,
  });

  return { ok: true, note: toViewerNote(note) };
}

/** This owner's notes on a lesson, newest first. Null = this token may not read notes. */
export async function listViewerNotesForLesson(input: {
  token: string;
  lessonId: string;
}): Promise<ViewerNoteView[] | null> {
  const token = input.token?.trim();
  const lessonId = input.lessonId?.trim();

  if (!token || !lessonId) {
    return null;
  }

  const owner = resolveNoteOwner(await validateCourseAccessToken(token));

  if (!owner) {
    return null;
  }

  const notes = await prisma.lessonNote.findMany({
    where: { lessonId, ...ownerWhere(owner) },
    orderBy: { createdAt: 'desc' },
    select: NOTE_SELECT,
  });

  return notes.map(toViewerNote);
}

export type UpdateViewerNoteResult =
  { ok: true; note: ViewerNoteView } | { ok: false; status: number; error: string };

/**
 * Edits the body of one of this owner's notes. `selectedText`/`context` are immutable: they're the
 * anchor the highlight is re-located from, so changing them would silently detach the note from its
 * passage. Ownership check and mutation are one statement — someone else's note matches zero rows
 * and reads as "not found", so ids can't be probed for existence.
 */
export async function updateViewerNote(input: {
  token: string;
  noteId: string;
  body: string;
}): Promise<UpdateViewerNoteResult> {
  const token = input.token?.trim();
  const noteId = input.noteId?.trim();
  const body = input.body?.trim();

  if (!token || !noteId) {
    return { ok: false, status: 400, error: 'Token and noteId are required.' };
  }

  if (!body) {
    return { ok: false, status: 400, error: 'Note text is required.' };
  }

  if (body.length > NOTE_BODY_MAX) {
    return { ok: false, status: 400, error: 'Note is too long.' };
  }

  const access = await validateCourseAccessToken(token);
  const owner = resolveNoteOwner(access);

  if (!owner) {
    return { ok: false, status: 403, error: 'Access is not valid.' };
  }

  const paused = await pausedRefusal(access);
  if (paused) {
    return paused;
  }

  try {
    const note = await prisma.lessonNote.update({
      // The owner filter rides along with the unique id, so this is one authorized statement
      // rather than find-then-update.
      where: { id: noteId, ...ownerWhere(owner) },
      data: { body },
      select: NOTE_SELECT,
    });

    return { ok: true, note: toViewerNote(note) };
  } catch (updateError) {
    // Only "no row matched" is a 404. A blanket catch here would report a connection failure as a
    // missing note.
    if (
      updateError instanceof Prisma.PrismaClientKnownRequestError &&
      updateError.code === 'P2025'
    ) {
      return { ok: false, status: 404, error: 'Note not found.' };
    }

    throw updateError;
  }
}

export type DeleteViewerNoteResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Deletes one of this owner's notes. Scoped in a single statement (no find-then-delete gap), so
 * someone else's note reads as "not found". Unlike a comment there's no `TaskEntityLink` to clean
 * up — a note is never promoted to anything.
 */
export async function deleteViewerNote(input: {
  token: string;
  noteId: string;
}): Promise<DeleteViewerNoteResult> {
  const token = input.token?.trim();
  const noteId = input.noteId?.trim();

  if (!token || !noteId) {
    return { ok: false, status: 400, error: 'Token and noteId are required.' };
  }

  const access = await validateCourseAccessToken(token);
  const owner = resolveNoteOwner(access);

  if (!owner) {
    return { ok: false, status: 403, error: 'Access is not valid.' };
  }

  const paused = await pausedRefusal(access);
  if (paused) {
    return paused;
  }

  const { count } = await prisma.lessonNote.deleteMany({
    where: { id: noteId, ...ownerWhere(owner) },
  });

  if (count === 0) {
    return { ok: false, status: 404, error: 'Note not found.' };
  }

  return { ok: true };
}

/**
 * Write-only cleanup for the member/group delete paths, so a removed learner's notes don't linger
 * as rows nobody can reach. Returns a count and nothing else: this is deliberately the only
 * function in this module that admin code may call, and it cannot read a note's text.
 *
 * Pass the transaction client when the member rows are being removed inside a transaction, so the
 * notes go with them or not at all.
 */
export async function deleteNotesForMembers(
  memberIds: string[],
  client: DbClient = prisma
): Promise<number> {
  if (memberIds.length === 0) {
    return 0;
  }

  const { count } = await client.lessonNote.deleteMany({
    where: { memberId: { in: memberIds } },
  });

  return count;
}
