import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FiPlus } from 'react-icons/fi';
import { Permission } from '@prisma/client';
import AdminButton from '../../../components/ui/AdminButton';
import AdminSectionCard from '../../../components/ui/AdminSectionCard';
import CourseManagementFrame from '../../components/CourseManagementFrame';
import { ForkDecisions } from '../../components/ForkDecisions';
import GroupDirectory, { type GroupDirectoryRow } from '../../groups/components/GroupDirectory';
import { groupRowWords, groupRunState, listGroupsForIndex } from '../../groups/data';
import { getCourseHeader } from '../../data';
import { listCourseForks } from '../../versions/data';
import {
  accessScope,
  canOnCourse,
  canWorkOnFeedback,
  commentScopeWhere,
  groupScopeWhere,
  requireCourseAccess,
} from '@/lib/crm-access';
import { countOpenFeedback } from '@/lib/feedback-list';
import { instructorsByGroup } from '@/lib/group-instructors';
import { canAccessSection } from '@/lib/permissions';
import styles from '../../../admin.module.css';

export const dynamic = 'force-dynamic';

type PageParams = Promise<{ courseId: string }>;

/**
 * A course's groups: the ones running it, by when they run, and what their copies suggest for the
 * course (keep it in the group, or bring it to the course's own lessons).
 */
export default async function CourseGroupsPage({ params }: { params: PageParams }) {
  const { courseId } = await params;
  const viewer = await requireCourseAccess(courseId, [Permission.READ]);
  const [course, groups, openFeedback, forks] = await Promise.all([
    getCourseHeader(courseId),
    listGroupsForIndex({ AND: [{ courseId }, groupScopeWhere(accessScope(viewer, 'groups'))] }),
    countOpenFeedback({ AND: [commentScopeWhere(accessScope(viewer, 'comments')), { curriculumVersion: { courseId } }] }),
    listCourseForks(courseId),
  ]);
  if (!course) {
    notFound();
  }
  const [instructors, words, t] = await Promise.all([
    instructorsByGroup(groups.map((group) => group.id)),
    groupRowWords(),
    getTranslations('groups.courseTab'),
  ]);
  const canWork = canWorkOnFeedback(viewer, { courseId, groupIds: [] }, 'tasks');
  const canDelete = canAccessSection(viewer, 'groups', [Permission.DELETE]);
  const now = new Date();
  const rows: GroupDirectoryRow[] = groups.map((group) => {
    const taughtBy = instructors.get(group.id) ?? [];
    return {
      id: group.id,
      name: group.name,
      courseTitle: course.title,
      lessons: words.lessons(group),
      dates: words.dates(group.startsAt, group.endsAt),
      learners: group.memberCount,
      openFeedback: (openFeedback.byGroup.get(group.id) ?? 0) + (group.ownCopy ? openFeedback.byVersion.get(group.ownCopy.id) ?? 0 : 0),
      taughtBy: taughtBy.length ? { names: words.names(taughtBy.map((instructor) => instructor.name)), count: taughtBy.length } : null,
      state: groupRunState(group, now),
      canDelete,
      hasOwnCopy: Boolean(group.ownCopy),
    };
  });
  // What the course decides about its groups' copies: changes suggested for it, and finished group
  // work nobody decided about. A group's own open tasks are on its page.
  const allForks = [...Array.from(forks.byBaseVersion.values()).flat(), ...forks.orphaned];
  const deciding = allForks.filter((fork) => fork.pending.proposals.length + fork.pending.unproposed.length > 0);
  const returnPath = `/admin/courses/${courseId}/groups`;

  return (
    <CourseManagementFrame
      activeSection="courses"
      pageContext={{ title: course.title, subtitle: course.summary ?? undefined, back: { href: '/admin/courses', label: t('back') } }}
      courseTabs={{ courseId, active: 'groups' }}
    >
      <section className={styles.editorPageSection}>
        {canWork && deciding.length ? (
          <AdminSectionCard kicker={t('suggested.kicker')} title="">
            <p className={styles.fieldHint} style={{ margin: '0 0 0.75rem' }}>
              {t('suggested.text')}
            </p>
            <div style={{ display: 'grid', gap: '1rem' }}>
              {deciding.map((fork) => (
                <div key={fork.id}>
                  <h3 className={styles.versionForkTitle} style={{ margin: '0 0 0.35rem' }}>
                    {fork.group.name}
                  </h3>
                  <ForkDecisions fork={fork} returnPath={returnPath} suggestionsOnly />
                </div>
              ))}
            </div>
          </AdminSectionCard>
        ) : null}

        <AdminSectionCard
          kicker={t('kicker')}
          title=""
          kickerAction={
            canOnCourse(viewer, courseId, [Permission.WRITE]) ? (
              <AdminButton href={`/admin/courses/groups/new?course=${courseId}`} size="compact">
                <FiPlus size={15} />
                {t('new')}
              </AdminButton>
            ) : null
          }
        >
          {rows.length ? (
            <GroupDirectory rows={rows} />
          ) : (
            <div className={styles.emptyState}>
              <h3 className={styles.emptyStateTitle}>{t('empty.title')}</h3>
              <p className={styles.emptyStateText}>{t('empty.text')}</p>
            </div>
          )}
        </AdminSectionCard>
      </section>
    </CourseManagementFrame>
  );
}
