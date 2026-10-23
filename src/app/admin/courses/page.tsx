import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { FiClock, FiPlus, FiUsers } from 'react-icons/fi';
import AdminButton from '../components/ui/AdminButton';
import AdminCard from '../components/ui/AdminCard';
import AdminSectionCard from '../components/ui/AdminSectionCard';
import CourseManagementFrame from './components/CourseManagementFrame';
import CourseListInfo from './components/CourseListInfo';
import { courseListMetaGroupStyle, formatLessonUpdatedAt } from './components/courseListShared';
import { listCoursesForIndexLite } from './data';
import { Permission } from '@prisma/client';
import { redirect } from 'next/navigation';
import { accessScope, courseScopeWhere, hasAnyAccess, hasCourseLevelAccess, requireCrmAccess } from '@/lib/crm-access';
import { canAccessSection } from '@/lib/permissions';
import styles from '../admin.module.css';

export default async function CoursesPage() {
  const viewer = await requireCrmAccess(hasAnyAccess);
  // Instructors of groups only work from their groups.
  if (!hasCourseLevelAccess(viewer)) {
    redirect('/admin/courses/groups');
  }

  const courses = await listCoursesForIndexLite(courseScopeWhere(accessScope(viewer, 'courses')));
  const canCreate = canAccessSection(viewer, 'courses', [Permission.WRITE]);
  const [t, locale] = await Promise.all([getTranslations('courses.list'), getLocale()]);

  return (
    <CourseManagementFrame
      activeSection="courses"
    >
      <section className={styles.editorPageSection}>
        <AdminSectionCard
          kicker={t('kicker')}
          title=""
          kickerAction={
            canCreate ? (
              <AdminButton href="/admin/courses/new" size="compact">
                <FiPlus size={15} />
                {t('newCourse')}
              </AdminButton>
            ) : undefined
          }
        >
          {courses.length > 0 ? (
            <div className={styles.entityList}>
              {courses.map((course) => {
                return (
                  <AdminCard
                    key={course.id}
                    variant="compact"
                    className={`${styles.entityRow} ${styles.courseListRow}`}
                  >
                    <Link
                      href={`/admin/courses/${course.id}`}
                      className={`${styles.entityRowMainLink} ${styles.courseListMainLink}`}
                    >
                      <div className={`${styles.entityRowBody} ${styles.courseListBody}`}>
                        <div className={styles.courseListTitleRow}>
                          <h3 className={styles.courseListTitle}>{course.title}</h3>
                          <div style={courseListMetaGroupStyle}>
                            <CourseListInfo>
                              {t('lessons', { count: course.lessonCount })}
                              {course.draftLessonCount ? ` · ${t('inDraft', { count: course.draftLessonCount })}` : ''}
                            </CourseListInfo>
                            {course.activeForkCount > 0 ? (
                              <CourseListInfo>
                                <FiUsers size={10} aria-hidden="true" />
                                {t('groupCopies', { count: course.activeForkCount })}
                              </CourseListInfo>
                            ) : null}
                            <CourseListInfo>
                              <FiClock size={10} aria-hidden="true" />
                              {course.lessonsUpdatedAt
                                ? t('updated', { date: formatLessonUpdatedAt(course.lessonsUpdatedAt, locale) })
                                : t('updatedNever')}
                            </CourseListInfo>
                          </div>
                        </div>
                      </div>
                    </Link>

                  </AdminCard>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <h3 className={styles.emptyStateTitle}>{t('emptyTitle')}</h3>
              <p className={styles.emptyStateText}>{t('emptyText')}</p>
            </div>
          )}
        </AdminSectionCard>
      </section>
    </CourseManagementFrame>
  );
}
