import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { displayName, getCurrentUserSession } from '@/lib/admin-auth';
import {
  accessScope,
  canOpenPreview,
  commentScopeWhere,
  instructorNoteContext,
  loadVersionRef,
  type CrmViewer,
} from '@/lib/crm-access';
import { createInstructorNote, deleteInstructorNote, groupNotesWhere, listTeamCommentsForLesson } from '@/lib/curriculum-comments';
import { groupGrantIds } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { sharedError, teamError } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function member() {
  const session = await getCurrentUserSession();
  return session?.user.organization ? session.user : null;
}

/**
 * The lesson's version, when the viewer may open its preview (organisation-scoped: others are not
 * found).
 */
async function readableVersion(viewer: CrmViewer, lessonId: string) {
  const lesson = lessonId ? await prisma.lesson.findUnique({ where: { id: lessonId }, select: { curriculumVersionId: true } }) : null;
  const version = lesson ? await loadVersionRef(lesson.curriculumVersionId) : null;
  return version && (await canOpenPreview(viewer, version)) ? version : null;
}

/**
 * Instructor note on a passage (team members, signed in). The preview sends its context as `token`:
 * `group:<id>` when it was opened for a group, so the note becomes that group's feedback.
 */
export async function POST(request: Request) {
  const user = await member();
  if (!user) {
    return NextResponse.json({ error: await teamError('signInToAddNotes') }, { status: 401 });
  }
  let payload: { lessonId?: string; selectedText?: string; context?: string | null; body?: string; token?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: await teamError('invalidJson') }, { status: 400 });
  }
  const version = await readableVersion(user, payload.lessonId ?? '');
  if (!version) {
    return NextResponse.json({ error: await teamError('lessonNotFound') }, { status: 404 });
  }
  const groupContext = payload.token?.startsWith('group:') ? payload.token.slice('group:'.length) : null;
  const context = await instructorNoteContext(user, version, groupContext);
  if (!context.ok) {
    return NextResponse.json({ error: await teamError('notesNotAllowed') }, { status: 403 });
  }
  const result = await createInstructorNote({
    userId: user.id,
    authorName: displayName(user),
    lessonId: payload.lessonId ?? '',
    selectedText: payload.selectedText ?? '',
    context: payload.context ?? null,
    body: payload.body ?? '',
    groupId: context.groupId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: await sharedError(result.error) }, { status: result.status });
  }
  return NextResponse.json({ comment: result.comment }, { status: 201 });
}

/**
 * The lesson's notes and learner feedback the viewer may see, plus their own notes (?lessonId=). A
 * guest instructor also sees every instructor's notes for their groups (as on their instructor link),
 * never learner feedback.
 */
export async function GET(request: Request) {
  const user = await member();
  if (!user) {
    return NextResponse.json({ comments: [] });
  }
  const lessonId = new URL(request.url).searchParams.get('lessonId') ?? '';
  if (!(await readableVersion(user, lessonId))) {
    return NextResponse.json({ comments: [] });
  }
  const scope = commentScopeWhere(accessScope(user, 'comments'));
  const guestGroups = groupGrantIds(user.grants, [Permission.NOTES]);
  // An empty scope is everything already (see `listTeamCommentsForLesson`).
  const visible = guestGroups.length && Object.keys(scope).length ? { OR: [scope, ...guestGroups.map(groupNotesWhere)] } : scope;
  return NextResponse.json({ comments: await listTeamCommentsForLesson(user.id, lessonId, visible) });
}

/** Deletes one of your own instructor notes (?commentId=). */
export async function DELETE(request: Request) {
  const user = await member();
  if (!user) {
    return NextResponse.json({ error: await teamError('signInFirst') }, { status: 401 });
  }
  const commentId = new URL(request.url).searchParams.get('commentId') ?? '';
  const result = await deleteInstructorNote(user.id, commentId);
  if (!result.ok) {
    return NextResponse.json({ error: await sharedError(result.error) }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
