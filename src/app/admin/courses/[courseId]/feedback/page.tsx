import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Permission, TaskStatus, type Prisma } from '@prisma/client';
import AdminButton from '../../../components/ui/AdminButton';
import AdminSectionCard from '../../../components/ui/AdminSectionCard';
import UrlFilterSelect from '../../../components/ui/UrlFilterSelect';
import FeedbackList from '../../../components/feedback/FeedbackList';
import { feedbackShow } from '../../../components/feedback/feedback-view';
import ImprovementsList from '../../../components/improvements/ImprovementsList';
import { loadImprovements, newFeedbackByLesson } from '../../../components/improvements/data';
import CourseManagementFrame from '../../components/CourseManagementFrame';
import { getCourseHeader } from '../../data';
import {
  accessScope,
  canReadFeedback,
  canWorkOnFeedback,
  groupScopeWhere,
  requireCourseAccess,
  taskScopeWhere,
} from '@/lib/crm-access';
import { courseFeedbackWhere, groupFeedbackWhere } from '@/lib/feedback-list';
import { prisma } from '@/lib/prisma';
import { TASK_ENTITY_TYPE, TASK_KIND } from '@/lib/tasks';
import styles from '../../../admin.module.css';

export const dynamic = 'force-dynamic';

type PageParams = Promise<{ courseId: string }>;
type SearchParams = Promise<{ show?: string; lesson?: string; group?: string }>;

/** `?group=` for the course's own lessons (no group). */
const OWN = 'course';

/**
 * A course's feedback: from every group, or one group (`?group=`), or the course's own lessons; its
 * Improvements view lists the improvements made from it, with where each one is.
 */
export default async function CourseFeedbackPage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  const { courseId } = await params;
  const viewer = await requireCourseAccess(courseId, [Permission.READ]);
  const [search, t] = await Promise.all([searchParams, getTranslations('courses.feedback')]);
  const feedbackRef = { courseId, groupIds: [] };

  const [course, groups, coreVersions] = await Promise.all([
    getCourseHeader(courseId),
    prisma.courseGroup.findMany({
      where: { AND: [{ courseId }, groupScopeWhere(accessScope(viewer, 'groups'))] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.curriculumVersion.findMany({ where: { courseId, ownerGroupId: null }, select: { id: true } }),
  ]);
  if (!course) {
    notFound();
  }

  const group = search.group === OWN ? OWN : groups.find((entry) => entry.id === search.group)?.id ?? '';
  const where: Prisma.CurriculumCommentWhereInput =
    group === OWN
      ? { groupId: null, curriculumVersion: { courseId, ownerGroupId: null } }
      : group
        ? groupFeedbackWhere(group)
        : courseFeedbackWhere(courseId);

  // Improvements: every improvement of the course (its own lessons and its groups'), or one group's,
  // or the course's own lessons only; listed when that view is open, counted always.
  const show = feedbackShow(search.show);
  const canSeeTasks = canReadFeedback(viewer, feedbackRef, 'tasks');
  const improvementWhere: Prisma.TaskWhereInput =
    group === OWN
      ? { entityLinks: { some: { entityType: TASK_ENTITY_TYPE.curriculumVersion, entityId: { in: coreVersions.map((version) => version.id) } } } }
      : group
        ? { entityLinks: { some: { entityType: TASK_ENTITY_TYPE.courseGroup, entityId: group } } }
        : { entityLinks: { some: { entityType: TASK_ENTITY_TYPE.course, entityId: courseId } } };
  const [rows, openCount, lessonFeedback] = canSeeTasks
    ? await Promise.all([
        show === 'change' ? loadImprovements(viewer, improvementWhere) : Promise.resolve([]),
        prisma.task.count({
          where: {
            AND: [
              taskScopeWhere(accessScope(viewer, 'tasks')),
              { kind: TASK_KIND.curriculum, status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] } },
              improvementWhere,
            ],
          },
        }),
        // The new feedback on each lesson, for the list's per-lesson summary.
        show === 'change' ? newFeedbackByLesson(viewer, where) : Promise.resolve([]),
      ])
    : [[], 0, []];

  return (
    <CourseManagementFrame
      activeSection="courses"
      pageContext={{ title: course.title, subtitle: course.summary ?? undefined, back: { href: '/admin/courses', label: t('back') } }}
      courseTabs={{ courseId, active: 'feedback' }}
    >
      <section className={styles.editorPageSection}>
        <AdminSectionCard
          kicker={t('kicker')}
          title=""
          kickerAction={
            <AdminButton
              href={`/admin/api/feedback-export?course=${courseId}${group ? `&group=${group}` : ''}`}
              download
              size="compact"
              tone="secondary"
              data-testid="feedback-export"
            >
              {t('exportCsv')}
            </AdminButton>
          }
        >
          <FeedbackList
            viewer={viewer}
            where={where}
            show={show}
            lessonId={search.lesson ?? null}
            baseHref={`/admin/courses/${courseId}/feedback${group ? `?group=${group}` : ''}`}
            showGroup={!group}
            emptyText={
              group === OWN
                ? t('emptyOwn')
                : group
                  ? t('emptyGroup')
                  : t('emptyAll')
            }
            filters={
              groups.length ? (
                <UrlFilterSelect
                  id="course-feedback-group"
                  label={t('groupFilter')}
                  param="group"
                  value={group}
                  reset={['lesson']}
                  options={[
                    { value: '', label: t('allGroups', { count: groups.length }) },
                    { value: OWN, label: t('ownLessons') },
                    ...groups.map((entry) => ({ value: entry.id, label: entry.name })),
                  ]}
                />
              ) : null
            }
            changeCount={openCount}
            changes={
              canSeeTasks ? (
                <ImprovementsList
                  rows={rows}
                  feedback={lessonFeedback}
                  boardHref={`/admin/tasks?curriculum=${encodeURIComponent(`course:${courseId}`)}`}
                />
              ) : null
            }
          />
        </AdminSectionCard>
      </section>
    </CourseManagementFrame>
  );
}
