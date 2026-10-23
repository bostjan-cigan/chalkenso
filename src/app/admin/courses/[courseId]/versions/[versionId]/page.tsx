import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CurriculumVersionStatus, Permission } from '@prisma/client';
import { FiAlertTriangle } from 'react-icons/fi';
import AdminNotice from '../../../../components/ui/AdminNotice';
import CourseManagementFrame from '../../../components/CourseManagementFrame';
import { courseFlashMessage } from '../../../messages';
import VersionLessons from '../../../components/VersionLessons';
import { getVersionDetail } from '../../../versions/data';
import {
  canEditVersion,
  canPreviewVersion,
  loadVersionRef,
  requireCrmAccess,
} from '@/lib/crm-access';
import { canAccessSection } from '@/lib/permissions';
import styles from '../../../../admin.module.css';

/**
 * Server actions run with their page's limit. Publishing a version writes every lesson in it, so it
 * gets the hobby plan's 60s ceiling (see `admin/api/assets/upload/route.ts`) rather than the default.
 */
export const maxDuration = 60;

type PageParams = Promise<{
  courseId: string;
  versionId: string;
}>;

type SearchParams = Promise<{
  error?: string;
  lesson?: string;
  status?: string;
}>;

export default async function VersionEditPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { courseId, versionId } = await params;
  // Editing: WRITE on this version (its course, or an instructor's own group copy). Anyone who can
  // only read it (View only, or an instructor reading the core their group uses) gets the preview.
  const versionRef = await loadVersionRef(versionId);
  const viewer = await requireCrmAccess((viewer) => {
    if (!versionRef || versionRef.courseId !== courseId) {
      return canAccessSection(viewer, 'courses');
    }
    if (canEditVersion(viewer, versionRef, [Permission.WRITE])) {
      return true;
    }
    if (canPreviewVersion(viewer, versionRef)) {
      redirect(`/admin/courses/${courseId}/versions/${versionId}/preview`);
    }
    return false;
  });
  const [search, version] = await Promise.all([searchParams, getVersionDetail(courseId, versionId)]);

  if (!version) {
    notFound();
  }
  // The course's own versions are edited in its Lessons tab (with whatever the last action said).
  if (!version.ownerGroup) {
    const query = new URLSearchParams({ version: version.id });
    for (const key of ['lesson', 'status', 'error'] as const) {
      if (search[key]) query.set(key, search[key] as string);
    }
    redirect(`/admin/courses/${courseId}?${query.toString()}`);
  }

  const [flashMessage, t] = await Promise.all([courseFlashMessage(search), getTranslations('courses.version')]);
  const isPublished = version.status === CurriculumVersionStatus.PUBLISHED;
  const ownerGroup = version.ownerGroup;

  return (
    <CourseManagementFrame
      activeSection="courses"
      pageContext={
        ownerGroup
          ? {
              title: version.label,
              subtitle: `${version.course.title} · ${
                version.baseVersion
                  ? t('groupCopyFrom', { version: version.baseVersion.label })
                  : t('groupCopyFromDeleted')
              }`,
              badge: version.archivedAt
                ? { label: t('closed'), variant: 'warning' }
                : { label: t('groupCopy'), variant: 'accent' },
              back: {
                href: `/admin/courses/groups/${ownerGroup.id}`,
                label: t('backTo', { name: ownerGroup.name }),
              },
            }
          : {
              title: version.label,
              subtitle: version.course.title,
              badge: {
                label: isPublished ? t('published') : t('draft'),
                variant: isPublished ? 'accent' : 'warning',
              },
              back: { href: `/admin/courses/${courseId}`, label: t('backToVersions') },
            }
      }
      notice={
        ownerGroup && !flashMessage ? (
          <AdminNotice className={styles.statusNotice} variant="banner">
            {t('groupCopyNotice', { name: ownerGroup.name })}
          </AdminNotice>
        ) : flashMessage ? (
          <AdminNotice
            className={styles.statusNotice}
            icon={<FiAlertTriangle size={18} />}
            variant="banner"
          >
            {flashMessage}
          </AdminNotice>
        ) : null
      }
    >
      <section className={styles.editorPageSection}>
        <VersionLessons viewer={viewer} version={version} selectedLessonId={search.lesson} />
      </section>
    </CourseManagementFrame>
  );
}
