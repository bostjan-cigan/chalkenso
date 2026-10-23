import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Permission } from '@prisma/client';
import { isAiConfigured } from '@/lib/ai';
import { lessonDraftIds } from '@/lib/ai-drafts';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { canEditVersion, canWorkOnFeedback, loadVersionRef, requireCrmAccess } from '@/lib/crm-access';
import { usesVaultAgent } from '@/lib/vault-agent';
import { prisma } from '@/lib/prisma';
import { ui } from '@/extensions/ui';
import AdminFrame from '../../../../../components/AdminFrame';
import { adminNavItems } from '../../../../../nav';
import { getLessonDetail, mapUploadedAssets } from '../../../../data';
import ImprovementsView, { type Selection } from '../../../../components/improvements-view/ImprovementsView';
import { loadImprovementsView } from '../../../../components/improvements-view/data';

/** Drafting a plan or changes can wait on Claude: allow it up to five minutes. */
export const maxDuration = 300;

type PageParams = Promise<{ courseId: string; lessonId: string }>;
/** `why`: something else to change, to start the form with; `from=map`: back to the course map. */
type SearchParams = Promise<{ i?: string; note?: string; draft?: string; new?: string; why?: string; from?: string }>;

/**
 * A lesson's Improve mode: the lesson, with its to-do in a column beside it (the feedback to tick,
 * the plan, the changes to keep, other work on it, what's done). For whoever may edit the lesson;
 * anyone else goes to the lesson page (which sends readers to the preview). `?i=` opens an
 * improvement, `?note=` a piece of feedback (or the earlier improvement it's in), `?draft=` a
 * revision (or its improvement), `?new=1` something else to change (a note the lesson's improvement uses).
 */
export default async function LessonImprovementsPage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  const { courseId, lessonId } = await params;
  const search = await searchParams;
  const lessonPath = `/admin/courses/${courseId}/lessons/${lessonId}`;
  const lessonRef = await prisma.lesson.findFirst({ where: { id: lessonId, courseId }, select: { curriculumVersionId: true } });
  const versionRef = lessonRef ? await loadVersionRef(lessonRef.curriculumVersionId) : null;
  if (!versionRef) notFound();
  const viewer = await requireCrmAccess((candidate) => {
    if (canEditVersion(candidate, versionRef, [Permission.WRITE])) return true;
    redirect(lessonPath);
  });
  const lesson = await getLessonDetail(courseId, lessonId);
  if (!lesson) notFound();

  const [t, version, aiEnabled, session] = await Promise.all([
    getTranslations('editor.improvements'),
    prisma.curriculumVersion.findUnique({ where: { id: lesson.curriculumVersionId }, select: { label: true, ownerGroup: { select: { name: true } } } }),
    isAiConfigured(),
    getCurrentUserSession(),
  ]);
  // Only where the organisation works in the Obsidian vault too: where each improvement is worked on.
  const vault = await usesVaultAgent(session?.user.organization?.id);
  const canWork = canWorkOnFeedback(viewer, { courseId, groupIds: versionRef.ownerGroupId ? [versionRef.ownerGroupId] : [] }, 'tasks');
  const data = await loadImprovementsView(viewer, { id: lesson.id, courseId, ownerGroupId: versionRef.ownerGroupId, title: lesson.title }, aiEnabled);
  // The drafts it opens with: what arrives later (someone's Claude) is brought in.
  const seenDrafts = await lessonDraftIds(lesson.id, data.improvements.map((improvement) => improvement.id));

  // What the link asks to show.
  const improvementWith = (test: (improvement: (typeof data.improvements)[number]) => boolean) => data.improvements.find(test)?.id;
  let initial: Selection | null = null;
  if (search.i && [...data.improvements, ...data.done].some((improvement) => improvement.id === search.i)) initial = { kind: 'improvement', id: search.i };
  else if (search.note) {
    // The lesson's own feedback opens whole in the column; an earlier improvement's opens that improvement.
    const lessonOwn = data.improvements.find((improvement) => improvement.current)?.feedback.some((feedback) => feedback.id === search.note);
    const inImprovement = improvementWith((improvement) => improvement.feedback.some((feedback) => feedback.id === search.note));
    if (lessonOwn || data.newFeedback.some((feedback) => feedback.id === search.note)) initial = { kind: 'feedback', id: search.note };
    else if (inImprovement) initial = { kind: 'improvement', id: inImprovement };
  } else if (search.draft) {
    const forImprovement = improvementWith((improvement) => improvement.draft?.id === search.draft);
    if (forImprovement) initial = { kind: 'improvement', id: forImprovement };
    else if (data.looseDrafts.some((draft) => draft.id === search.draft)) initial = { kind: 'draft', id: search.draft };
  } else if (search.new && canWork) initial = { kind: 'new' };

  // The edition's part of each improvement's steps: "… in your Claude ↗" where the app has no AI
  // (or the warning to connect Claude), and following what Claude sends.
  const aiSlots: Record<string, { plan: ReactNode; changes: ReactNode }> = {};
  if (ui.TaskAi) {
    const TaskAi = ui.TaskAi;
    for (const improvement of data.improvements) {
      if (improvement.canWork) aiSlots[improvement.id] = { plan: <TaskAi taskId={improvement.id} />, changes: <TaskAi taskId={improvement.id} place="changes" /> };
    }
  }

  return (
    <AdminFrame navItems={adminNavItems('courses')} showHero={false} wide>
      <ImprovementsView
        lesson={{
          id: lesson.id,
          courseId,
          curriculumVersionId: lesson.curriculumVersionId,
          title: lesson.title,
          slug: lesson.slug,
          status: lesson.status,
          shortDescription: lesson.shortDescription ?? '',
          arcId: lesson.arcId ?? '',
          markdown: lesson.markdownContent,
          revision: lesson.revision,
        }}
        uploadedAssets={{ ...data.copyAssets, ...mapUploadedAssets(lesson.assetReferences) }}
        levelLabel={version?.ownerGroup ? t('copyOf', { group: version.ownerGroup.name }) : t('mainCourse', { version: version?.label ?? '' })}
        editHref={lessonPath}
        improvements={data.improvements}
        done={data.done}
        newFeedback={data.newFeedback}
        looseDrafts={data.looseDrafts}
        seenDrafts={seenDrafts}
        aiEnabled={aiEnabled}
        vault={vault}
        canWork={canWork}
        aiSlots={aiSlots}
        initial={initial}
        initialWhy={initial?.kind === 'new' ? (search.why ?? '').slice(0, 2000) : ''}
        back={search.from === 'map' ? { href: `/admin/courses/${courseId}/map?lesson=${lesson.id}`, label: t('backToMap') } : undefined}
      />
    </AdminFrame>
  );
}
