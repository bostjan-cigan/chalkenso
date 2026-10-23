import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle } from 'react-icons/fi';
import { CurriculumVersionStatus, Permission } from '@prisma/client';
import AdminNotice from '../../components/ui/AdminNotice';
import AdminSectionCard from '../../components/ui/AdminSectionCard';
import { SheetButton } from '../../components/ui/Sheet';
import CourseManagementFrame from '../components/CourseManagementFrame';
import CourseVersionsSection from '../components/CourseVersionsSection';
import CreateVersionForm from '../components/CreateVersionForm';
import LessonViews from '../components/LessonViews';
import VersionLessons from '../components/VersionLessons';
import VersionPicker from '../components/VersionPicker';
import { getCourseHeader } from '../data';
import { courseFlashMessage } from '../messages';
import { createVersionAction } from '../versions/actions';
import { getVersionDetail, listForkCounts, listVersionsForCourse } from '../versions/data';
import { canEditVersion, canOnCourse, requireCourseAccess } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import styles from '../../admin.module.css';

/** Publishing a version writes every lesson in it: the hobby plan's 60s ceiling, as on the version page. */
export const maxDuration = 60;

type PageParams = Promise<{ courseId: string }>;

type SearchParams = Promise<{
  error?: string;
  status?: string;
  /** Which version the Lessons tab shows (default: the published one). */
  version?: string;
  /** The lesson just saved, to mark. */
  lesson?: string;
}>;

/**
 * A course's Lessons: the published version's lessons straight away (others a pick away), to edit
 * in place; its versions, and making the next one, below. Where the edition adds views of the
 * lessons (the cloud's curriculum analysis), subtabs under the version lead to them.
 */
export default async function CourseDetailPage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  const { courseId } = await params;
  // Unrestricted members, or members limited to this course (or every course).
  const viewer = await requireCourseAccess(courseId, [Permission.READ]);
  const canEdit = canOnCourse(viewer, courseId, [Permission.WRITE]);
  const [search, course, versions, forkCounts] = await Promise.all([
    searchParams,
    getCourseHeader(courseId),
    listVersionsForCourse(courseId),
    listForkCounts(courseId),
  ]);
  if (!course) {
    notFound();
  }

  const published = [...versions].reverse().find((version) => version.status === CurriculumVersionStatus.PUBLISHED);
  const picked = versions.find((version) => version.id === search.version) ?? published ?? versions.at(-1) ?? null;
  const pickedRef = picked ? { id: picked.id, courseId, ownerGroupId: null } : null;
  const editable = Boolean(pickedRef && canEditVersion(viewer, pickedRef, [Permission.WRITE]));
  const [detail, readOnly] = await Promise.all([
    picked && editable ? getVersionDetail(courseId, picked.id) : null,
    picked && !editable
      ? prisma.lesson.findMany({
          where: { curriculumVersionId: picked.id },
          orderBy: { position: 'asc' },
          select: { id: true, title: true, position: true },
        })
      : [],
  ]);
  const [flashMessage, t] = await Promise.all([courseFlashMessage(search), getTranslations('courses.course')]);
  const previewHref = picked ? `/admin/courses/${courseId}/versions/${picked.id}/preview` : null;

  return (
    <CourseManagementFrame
      activeSection="courses"
      pageContext={{
        title: course.title,
        subtitle: course.summary ?? undefined,
        back: { href: '/admin/courses', label: t('back') },
        actions: previewHref ? [{ href: previewHref, label: t('readLessons'), tone: 'secondary' }] : [],
      }}
      courseTabs={{ courseId: course.id, active: 'lessons' }}
      notice={
        flashMessage ? (
          <AdminNotice className={styles.statusNotice} icon={<FiAlertTriangle size={18} />} variant="banner">
            {flashMessage}
          </AdminNotice>
        ) : null
      }
    >
      <section className={styles.editorPageSection}>
        {picked ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 0.9rem' }}>
            <VersionPicker
              courseId={courseId}
              value={picked.id}
              versions={versions.map((version) => ({ id: version.id, label: version.label, status: version.status }))}
            />
            <span className={styles.fieldHint}>
              {picked.status === CurriculumVersionStatus.PUBLISHED
                ? t('publishedHint')
                : t('draftHint')}
            </span>
          </div>
        ) : null}
        {picked ? <LessonViews courseId={courseId} versionId={picked.id} /> : null}

        {detail ? (
          <VersionLessons
            viewer={viewer}
            version={detail}
            selectedLessonId={search.lesson}
            feedbackHref={(lessonId) => `/admin/courses/${courseId}/feedback?lesson=${lessonId}`}
          />
        ) : picked ? (
          <AdminSectionCard kicker={t('lessonsKicker')} title="">
            <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.3rem' }}>
              {readOnly.map((lesson) => (
                <li key={lesson.id}>{lesson.title}</li>
              ))}
            </ol>
            {previewHref ? (
              <p className={styles.fieldHint} style={{ margin: '0.75rem 0 0' }}>
                <Link href={previewHref} className={styles.inlineLink}>
                  {t('readLessons')}
                </Link>
              </p>
            ) : null}
          </AdminSectionCard>
        ) : (
          <div className={styles.emptyState}>
            <h3 className={styles.emptyStateTitle}>{t('emptyTitle')}</h3>
            <p className={styles.emptyStateText}>{t('emptyText')}</p>
          </div>
        )}

        {/* Always open like every other section; a new version is made in a sheet. */}
        <AdminSectionCard
          kicker={t('versionsKicker')}
          title=""
          kickerAction={
            canEdit ? (
              <SheetButton label={t('newVersion')} title={t('newVersion')} testId="new-version">
                <CreateVersionForm
                  action={createVersionAction}
                  courseId={course.id}
                  versions={versions.map((version) => ({ id: version.id, label: version.label }))}
                />
              </SheetButton>
            ) : null
          }
        >
          <CourseVersionsSection
            courseId={course.id}
            versions={versions}
            forkCounts={forkCounts}
            canEdit={canEdit}
            canDelete={canOnCourse(viewer, courseId, [Permission.DELETE])}
          />
        </AdminSectionCard>
      </section>
    </CourseManagementFrame>
  );
}
