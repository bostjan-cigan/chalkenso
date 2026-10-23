import { Permission } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle } from 'react-icons/fi';
import AdminNotice from '../../../../components/ui/AdminNotice';
import AdminFrame from '../../../../components/AdminFrame';
import LessonWorkspace from '../../../components/workspace/LessonWorkspace';
import { adminNavItems } from '../../../../nav';
import { getCourseHeader } from '../../../data';
import { listArcsForVersion } from '../../../arcs/data';
import { getCourseFlashMessage } from '../../../messages';
import { listVersionsForCourse, resolveSelectedVersionId } from '../../../versions/data';
import { loadVersionRef, requireCourseAccess, requireVersionEdit } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import styles from '../../../../admin.module.css';


type PageParams = Promise<{
  courseId: string;
}>;

type SearchParams = Promise<{
  error?: string;
  version?: string;
}>;

export default async function NewLessonPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { courseId } = await params;
  const search = await searchParams;

  // A group curriculum is named explicitly (`?version=`); it is not in the core version list.
  const requested = search.version ? await loadVersionRef(search.version) : null;
  const groupCurriculum =
    requested && requested.courseId === courseId && requested.ownerGroupId ? requested : null;

  if (groupCurriculum) {
    await requireVersionEdit(groupCurriculum.id, [Permission.WRITE]);
  } else {
    // A core version of this course (the list below only offers this course's versions).
    await requireCourseAccess(courseId, [Permission.WRITE]);
  }

  const versions = groupCurriculum ? [] : await listVersionsForCourse(courseId);
  const selectedVersionId =
    groupCurriculum?.id ?? resolveSelectedVersionId(versions, search.version);
  // Only its id and title: the editor starts empty.
  const course = await getCourseHeader(courseId);

  if (!course) {
    notFound();
  }

  const selectedVersion = groupCurriculum
    ? await prisma.curriculumVersion.findUnique({
        where: { id: groupCurriculum.id },
        select: { id: true, label: true },
      })
    : (versions.find((version) => version.id === selectedVersionId) ?? null);
  const arcs = selectedVersionId ? await listArcsForVersion(selectedVersionId) : [];
  const flashMessage = getCourseFlashMessage(search);
  const backHref = selectedVersionId
    ? `/admin/courses/${course.id}/versions/${selectedVersionId}`
    : `/admin/courses/${course.id}`;

  const groupName = groupCurriculum
    ? (
        await prisma.curriculumVersion.findUnique({
          where: { id: groupCurriculum.id },
          select: { ownerGroup: { select: { name: true } } },
        })
      )?.ownerGroup?.name
    : null;
  const t = await getTranslations('editor.lessonPage');

  return (
    <AdminFrame navItems={adminNavItems('courses')} showHero={false} wide>
      {flashMessage ? (
        <AdminNotice className={styles.statusNotice} icon={<FiAlertTriangle size={18} />} variant="banner">
          {flashMessage}
        </AdminNotice>
      ) : null}
      <LessonWorkspace
        courseId={course.id}
        courseTitle={course.title}
        curriculumVersionId={selectedVersionId ?? undefined}
        versionLabel={groupName ?? selectedVersion?.label ?? t('course')}
        backHref={backHref}
        initial={{ title: '', slug: '', shortDescription: '', status: 'DRAFT', arcId: '', markdown: '' }}
        arcs={arcs.map((arc) => ({ id: arc.id, title: arc.title }))}
        initialUploadedAssets={{}}
      />
    </AdminFrame>
  );
}
