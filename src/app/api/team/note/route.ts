import { NextResponse } from 'next/server';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { canOpenPreview, getCrmViewer, loadVersionRef } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { teamError } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_BODY = 8000;
const MAX_TEXT = 2000;

/**
 * A team member's private notes on lesson passages (only they see them). Stored like learner notes,
 * owned by `team:<userId>` in the link column, which learner links never use.
 */
async function owner() {
  const session = await getCurrentUserSession();
  return session?.user.organization ? `team:${session.user.id}` : null;
}

const SELECT = { id: true, selectedText: true, context: true, body: true, createdAt: true, updatedAt: true } as const;

function view(note: { id: string; selectedText: string; context: string | null; body: string; createdAt: Date; updatedAt: Date }) {
  return { ...note, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
}

export async function GET(request: Request) {
  const accessLinkId = await owner();
  const lessonId = new URL(request.url).searchParams.get('lessonId') ?? '';
  if (!accessLinkId || !lessonId) {
    return NextResponse.json({ notes: [] }, { headers: PRIVATE_HEADERS });
  }
  const notes = await prisma.lessonNote.findMany({
    where: { lessonId, accessLinkId, memberId: null },
    orderBy: { createdAt: 'desc' },
    select: SELECT,
  });
  return NextResponse.json({ notes: notes.map(view) }, { headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  const accessLinkId = await owner();
  if (!accessLinkId) {
    return NextResponse.json({ error: await teamError('signInFirst') }, { status: 401 });
  }
  const payload = (await request.json().catch(() => null)) as
    | { lessonId?: string; selectedText?: string; context?: string | null; body?: string }
    | null;
  const selectedText = payload?.selectedText?.trim() ?? '';
  const body = payload?.body?.trim() ?? '';
  if (!selectedText || !body || selectedText.length > MAX_TEXT || body.length > MAX_BODY) {
    return NextResponse.json({ error: await teamError('selectAndWrite') }, { status: 400 });
  }
  // Organisation-scoped: a lesson outside the team's organisation is not found; and only lessons the
  // person may read.
  const lesson = await prisma.lesson.findUnique({ where: { id: payload?.lessonId ?? '' }, select: { id: true, curriculumVersionId: true } });
  const [viewer, version] = await Promise.all([getCrmViewer(), lesson ? loadVersionRef(lesson.curriculumVersionId) : null]);
  if (!lesson || !viewer || !version || !(await canOpenPreview(viewer, version))) {
    return NextResponse.json({ error: await teamError('lessonNotFound') }, { status: 404 });
  }
  const note = await prisma.lessonNote.create({
    data: {
      lessonId: lesson.id,
      accessLinkId,
      selectedText,
      context: payload?.context?.trim().slice(0, 4000) || null,
      body,
    },
    select: SELECT,
  });
  return NextResponse.json({ note: view(note) }, { status: 201, headers: PRIVATE_HEADERS });
}

export async function PATCH(request: Request) {
  const accessLinkId = await owner();
  if (!accessLinkId) {
    return NextResponse.json({ error: await teamError('signInFirst') }, { status: 401 });
  }
  const payload = (await request.json().catch(() => null)) as { noteId?: string; body?: string } | null;
  const body = payload?.body?.trim() ?? '';
  if (!body || body.length > MAX_BODY) {
    return NextResponse.json({ error: await teamError('writeNote') }, { status: 400 });
  }
  const updated = await prisma.lessonNote.updateMany({
    where: { id: payload?.noteId ?? '', accessLinkId },
    data: { body },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: await teamError('noteNotFound') }, { status: 404 });
  }
  const note = await prisma.lessonNote.findUniqueOrThrow({ where: { id: payload?.noteId ?? '' }, select: SELECT });
  return NextResponse.json({ note: view(note) }, { headers: PRIVATE_HEADERS });
}

export async function DELETE(request: Request) {
  const accessLinkId = await owner();
  if (!accessLinkId) {
    return NextResponse.json({ error: await teamError('signInFirst') }, { status: 401 });
  }
  const noteId = new URL(request.url).searchParams.get('noteId') ?? '';
  const deleted = await prisma.lessonNote.deleteMany({ where: { id: noteId, accessLinkId } });
  if (deleted.count === 0) {
    return NextResponse.json({ error: await teamError('noteNotFound') }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
}
