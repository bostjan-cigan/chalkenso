import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { draftDiagrams, loadLessonRevision } from '@/lib/ai-drafts';
import { canEditVersion, getCrmViewer, loadVersionRef } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { sanitizeSvg } from '@/lib/sanitize/svg';

export const runtime = 'nodejs';

/**
 * A diagram an AI draft adds to a lesson (`diagrams/<name>`), for whoever may edit the lesson to
 * review before it's saved: the Improve view and the compare sheet show it like any lesson image.
 * Cleaned when the draft arrived and again here; an SVG that can only draw, sent so it can't run
 * even when opened on its own. A draft never changes, so the browser keeps it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ draftId: string; name: string }> }) {
  const { draftId, name } = await params;
  const viewer = await getCrmViewer();
  const draft = viewer ? await loadLessonRevision(draftId) : null;
  const lesson = draft ? await prisma.lesson.findUnique({ where: { id: draft.targetId }, select: { curriculumVersionId: true } }) : null;
  const version = lesson ? await loadVersionRef(lesson.curriculumVersionId) : null;
  if (!viewer || !draft || !version || !canEditVersion(viewer, version, [Permission.WRITE])) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const diagram = draftDiagrams(draft.payload).find((item) => item.path === `diagrams/${name}`);
  const svg = diagram ? sanitizeSvg(diagram.svg) : null;
  if (!svg) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
      Vary: 'Cookie',
    },
  });
}
