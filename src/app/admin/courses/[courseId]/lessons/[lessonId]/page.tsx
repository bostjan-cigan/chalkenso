import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AiProposalKind, Permission } from '@prisma/client';
import AdminFrame from '../../../../components/AdminFrame';
import LessonWorkspace from '../../../components/workspace/LessonWorkspace';
import { countImprovementWork } from '../../../components/improvements-view/data';
import { getLessonDetail, mapUploadedAssets } from '../../../data';
import { listArcsForVersion } from '../../../arcs/data';
import { adminNavItems } from '../../../../nav';
import { getCurrentUserSession } from '@/lib/admin-auth';
import {
  canEditVersion,
  canOnCourse,
  canPreviewVersion,
  canWorkOnFeedback,
  instructorNoteContext,
  loadVersionRef,
  requireCourseAccess,
  requireCrmAccess,
} from '@/lib/crm-access';
import { hasUnpublishedChanges } from '@/lib/lesson-publishing';
import { prisma } from '@/lib/prisma';
import { ui } from '@/extensions/ui';

type PageParams = Promise<{
  courseId: string;
  lessonId: string;
}>;

type SearchParams = Promise<{
  /** Older links that opened the editor for improving (an improvement, feedback, a draft, a request): Improve mode has them now. */
  task?: string;
  note?: string;
  proposal?: string;
  instruction?: string;
}>;

/**
 * A lesson's Edit mode: the text and its details, and Save. Improving it (feedback, plans with AI,
 * proposed changes) is its Improve mode (`…/improvements`), one switch away; links that used to open
 * the editor for that go there.
 */
export default async function EditLessonPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { courseId, lessonId } = await params;
  const search = await searchParams;
  const t = await getTranslations('editor.lessonPage');
  const lessonRef = await prisma.lesson.findFirst({
    where: { id: lessonId, courseId },
    select: { curriculumVersionId: true },
  });

  // Editing needs WRITE on the lesson's version (its course, or an instructor's own group copy);
  // anyone who can only read it gets the read-only preview.
  const versionRef = lessonRef ? await loadVersionRef(lessonRef.curriculumVersionId) : null;
  const viewer = versionRef
    ? await requireCrmAccess((candidate) => {
        if (canEditVersion(candidate, versionRef, [Permission.WRITE])) return true;
        if (canPreviewVersion(candidate, versionRef)) {
          redirect(`/admin/courses/${courseId}/versions/${versionRef.id}/preview`);
        }
        return false;
      })
    : await requireCourseAccess(courseId, [Permission.READ]);

  const lesson = await getLessonDetail(courseId, lessonId);
  const session = await getCurrentUserSession();

  if (!lesson || !session || !versionRef) {
    notFound();
  }
  // Its feedback: the course's, or (on a group copy) that group's.
  const lessonFeedbackRef = { courseId: versionRef.courseId, groupIds: versionRef.ownerGroupId ? [versionRef.ownerGroupId] : [] };
  const canImprove = canWorkOnFeedback(viewer, lessonFeedbackRef, 'tasks');
  const improvePath = `/admin/courses/${courseId}/lessons/${lesson.id}/improvements`;
  if (canImprove) {
    if (search.task) redirect(`${improvePath}?i=${encodeURIComponent(search.task)}`);
    if (search.note) redirect(`${improvePath}?note=${encodeURIComponent(search.note)}`);
    // Only lesson revisions are reviewed there; a check question's draft stays with its panel here.
    if (search.proposal) {
      const proposal = await prisma.aiProposal.findUnique({ where: { id: search.proposal }, select: { kind: true, targetId: true } });
      if (proposal?.kind === AiProposalKind.LESSON_REVISION && proposal.targetId === lesson.id) {
        redirect(`${improvePath}?draft=${encodeURIComponent(search.proposal)}`);
      }
    }
    if (search.instruction) redirect(`${improvePath}?new=1&why=${encodeURIComponent(search.instruction.slice(0, 2000))}`);
  }

  const [arcs, version, improveCount, noteContext] = await Promise.all([
    listArcsForVersion(lesson.curriculumVersionId),
    prisma.curriculumVersion.findUnique({
      where: { id: lesson.curriculumVersionId },
      select: { label: true, ownerGroup: { select: { id: true, name: true } } },
    }),
    canImprove ? countImprovementWork(viewer, { id: lesson.id, ownerGroupId: versionRef.ownerGroupId }) : Promise.resolve(0),
    instructorNoteContext(viewer, versionRef, null),
  ]);
  const versionHref = `/admin/courses/${lesson.course.id}/versions/${lesson.curriculumVersionId}`;

  return (
    <AdminFrame navItems={adminNavItems('courses')} showHero={false} wide>
      <LessonWorkspace
        courseId={lesson.course.id}
        courseTitle={lesson.course.title}
        courseHref={canOnCourse(viewer, lesson.course.id, [Permission.READ]) ? `/admin/courses/${lesson.course.id}` : null}
        level={
          version?.ownerGroup
            ? {
                kind: 'copy',
                groupName: version.ownerGroup.name,
                groupHref: `/admin/courses/groups/${version.ownerGroup.id}`,
              }
            : { kind: 'course' }
        }
        curriculumVersionId={lesson.curriculumVersionId}
        versionLabel={version?.ownerGroup ? version.ownerGroup.name : version?.label ?? t('version')}
        backHref={versionHref}
        previewHref={`${versionHref}/preview`}
        lessonId={lesson.id}
        position={lesson.position}
        revision={lesson.revision}
        initial={{
          title: lesson.title,
          slug: lesson.slug,
          shortDescription: lesson.shortDescription ?? '',
          status: lesson.status,
          arcId: lesson.arcId ?? '',
          markdown: lesson.markdownContent,
        }}
        publishedAt={lesson.publishedAt ? lesson.publishedAt.toISOString() : null}
        hasUnpublishedChanges={hasUnpublishedChanges(lesson)}
        arcs={arcs.map((arc) => ({ id: arc.id, title: arc.title }))}
        initialUploadedAssets={mapUploadedAssets(lesson.assetReferences)}
        improveHref={canImprove ? improvePath : null}
        improveCount={improveCount}
        canNote={noteContext.ok}
      />

      {ui.LessonPanels ? <ui.LessonPanels lessonId={lesson.id} /> : null}
    </AdminFrame>
  );
}
