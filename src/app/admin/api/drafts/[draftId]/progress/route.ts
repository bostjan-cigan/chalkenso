import { NextResponse } from 'next/server';
import { AiProposalKind, Permission } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { draftView, lessonDraftView, loadDraft } from '@/lib/ai-drafts';
import { canEditVersion, canWorkOnFeedback, getCrmViewer, loadTaskRef, loadVersionRef } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const NOT_FOUND = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });
const ANSWER = (draft: unknown) => NextResponse.json({ draft }, { headers: { 'Cache-Control': 'no-store' } });

/**
 * How far a draft is, for the page following it (`useDraftProgress`): a route rather than a server
 * action, which the client runs one at a time, so a slow save never holds up the progress (and the
 * other way round). A lesson's revision for whoever may edit the lesson, an improvement's plan for
 * whoever may work on it; `draft` is null once it was used or discarded.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const viewer = await getCrmViewer();
  if (!viewer) return NOT_FOUND();

  const revision = await loadDraft(draftId, AiProposalKind.LESSON_REVISION);
  if (revision) {
    const lesson = await prisma.lesson.findUnique({ where: { id: revision.targetId }, select: { curriculumVersionId: true } });
    const version = lesson ? await loadVersionRef(lesson.curriculumVersionId) : null;
    if (!version || !canEditVersion(viewer, version, [Permission.WRITE])) return NOT_FOUND();
    const view = await lessonDraftView(revision, viewer.id);
    // The summary is the AI's (in the lesson's language); our stand-in for a missing one is translated.
    return ANSWER(view && !view.summary && view.state === 'ready' ? { ...view, summary: (await getTranslations('editor.ai'))('revisedAsRequested') } : view);
  }

  const plan = await loadDraft(draftId, AiProposalKind.TASK_PLAN);
  const ref = plan ? await loadTaskRef(plan.targetId) : null;
  if (!plan || !ref || !canWorkOnFeedback(viewer, ref, 'tasks')) return NOT_FOUND();
  return ANSWER(await draftView(plan, viewer.id, 'plan'));
}
