import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AiProposalKind, AiProposalStatus, Permission } from '@prisma/client';
import { currentDraft, draftView } from '@/lib/ai-drafts';
import { ANONYMOUS_LEARNER } from '@/lib/learner-label';
import { accessScope, canEditVersion, canWorkOnFeedback, commentScopeWhere, loadVersionRef, requireCrmAccess } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import AdminFrame from '../../../../../components/AdminFrame';
import { adminNavItems } from '../../../../../nav';
import RoundView, { type RoundLessonView, type RoundNoteView } from '../../../../components/round/RoundView';
import type { RoundPayload } from '../../../../round-actions';

/** Approving drafts several lessons in the background: allow it up to five minutes. */
export const maxDuration = 300;

type PageParams = Promise<{ courseId: string; versionId: string }>;

/**
 * "Sort with AI" for a course version or a group's copy: all its new feedback, sorted on one page
 * (RoundView). For whoever may edit the version and work on its feedback; back to its feedback.
 */
export default async function SortFeedbackPage({ params }: { params: PageParams }) {
  const { courseId, versionId } = await params;
  const version = await loadVersionRef(versionId);
  if (!version || version.courseId !== courseId) notFound();
  const groupIds = version.ownerGroupId ? [version.ownerGroupId] : [];
  const back = version.ownerGroupId ? `/admin/courses/groups/${version.ownerGroupId}?tab=feedback` : `/admin/courses/${courseId}/feedback`;
  const viewer = await requireCrmAccess((candidate) => {
    if (canEditVersion(candidate, version, [Permission.WRITE]) && canWorkOnFeedback(candidate, { courseId, groupIds }, 'tasks')) return true;
    redirect(back);
  });
  const t = await getTranslations('courses.feedback');
  const row = await currentDraft(AiProposalKind.FEEDBACK_ROUND, versionId);
  const view = row ? await draftView(row, viewer.id, 'plan') : null;
  const payload = (row?.payload ?? {}) as RoundPayload;

  let round: Parameters<typeof RoundView>[0]['round'] = { state: 'none' };
  const notes: Record<string, RoundNoteView> = {};
  const lessons: Record<string, RoundLessonView> = {};
  if (row && view && (view.state === 'working' || view.state === 'failed')) round = { state: view.state, id: row.id, draft: view };
  else if (row && row.status === AiProposalStatus.OPEN && payload.round) {
    round = { state: 'ready', id: row.id, updatedAt: row.updatedAt.toISOString(), plan: payload.round, more: payload.more ?? 0 };
    const ids = Object.keys(payload.noteLessons ?? {});
    const [rows, lessonRows] = await Promise.all([
      prisma.curriculumComment.findMany({
        where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { id: { in: ids } }] },
        select: { id: true, lessonId: true, body: true, selectedText: true, proposerName: true, isInstructorNote: true },
      }),
      prisma.lesson.findMany({ where: { id: { in: (payload.lessons ?? []).map((lesson) => lesson.id) } }, select: { id: true, title: true, position: true } }),
    ]);
    const learner = await getTranslations('editor.improvements');
    for (const note of rows) {
      notes[note.id] = {
        id: note.id,
        lessonId: note.lessonId,
        body: note.body,
        passage: note.selectedText ?? '',
        who: note.isInstructorNote
          ? note.proposerName
          : note.proposerName.startsWith(ANONYMOUS_LEARNER)
            ? learner('learner', { from: note.proposerName.replace(`${ANONYMOUS_LEARNER} · `, '') })
            : learner('learnerPlain'),
      };
    }
    const reaches = new Map((payload.lessons ?? []).map((lesson) => [lesson.id, lesson.reachesCourse]));
    for (const lesson of lessonRows) lessons[lesson.id] = { id: lesson.id, position: lesson.position, title: lesson.title, reachesCourse: reaches.get(lesson.id) ?? false };
  }

  return (
    <AdminFrame navItems={adminNavItems('courses')} showHero={false}>
      <RoundView versionId={versionId} backHref={back} backLabel={t('title')} round={round} notes={notes} lessons={lessons} />
    </AdminFrame>
  );
}
