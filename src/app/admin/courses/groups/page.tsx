import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FiAlertTriangle, FiPlus } from 'react-icons/fi';
import { Permission } from '@prisma/client';
import AdminButton from '../../components/ui/AdminButton';
import AdminNotice from '../../components/ui/AdminNotice';
import AdminSectionCard from '../../components/ui/AdminSectionCard';
import SegmentedControl from '../../components/ui/SegmentedControl';
import CourseManagementFrame from '../components/CourseManagementFrame';
import GroupDirectory, { type GroupDirectoryRow } from './components/GroupDirectory';
import { groupRowWords, groupRunState, listGroupsForIndex } from './data';
import { getGroupFlashMessage } from './messages';
import { LAST_GROUP_COOKIE } from './last-group';
import { accessScope, commentScopeWhere, groupScopeWhere, hasAnyAccess, isGroupOnly, requireCrmAccess } from '@/lib/crm-access';
import { canAccessSection, courseGrantIds } from '@/lib/permissions';
import { groupIdsTaughtBy, instructorsByGroup } from '@/lib/group-instructors';
import { countOpenFeedback } from '@/lib/feedback-list';
import styles from '../../admin.module.css';

type SearchParams = Promise<{
  error?: string;
  status?: string;
  /** "My groups": only the groups the viewer teaches. */
  mine?: string;
}>;

export default async function CourseGroupsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Every group for unrestricted members; limited ones see their courses' groups and their own groups.
  const viewer = await requireCrmAccess(hasAnyAccess);

  const params = await searchParams;
  const mine = params.mine === '1';
  const taught = mine ? await groupIdsTaughtBy(viewer.id) : [];
  const scope = groupScopeWhere(accessScope(viewer, 'groups'));
  // The groups and their open feedback (counted in the database) side by side.
  const [groups, openFeedback] = await Promise.all([
    listGroupsForIndex(mine ? { AND: [scope, { id: { in: taught } }] } : scope),
    countOpenFeedback(commentScopeWhere(accessScope(viewer, 'comments'))),
  ]);
  // An instructor of one group only: their group is the place to be.
  if (!mine && groups.length === 1 && isGroupOnly(viewer) && !params.error && !params.status) {
    redirect(`/admin/courses/groups/${groups[0].id}`);
  }
  const [instructors, cookieStore, words, t] = await Promise.all([
    instructorsByGroup(groups.map((group) => group.id)),
    cookies(),
    groupRowWords(),
    getTranslations('groups.list'),
  ]);
  // The group opened last (this browser), offered first when there are many.
  const lastGroupId = cookieStore.get(LAST_GROUP_COOKIE)?.value;
  const lastGroup = groups.length > 4 ? groups.find((group) => group.id === lastGroupId) ?? null : null;
  // New groups: unrestricted members, or members who can edit a whole course.
  const editableCourses = courseGrantIds(viewer.grants, [Permission.WRITE]);
  const canCreate =
    canAccessSection(viewer, 'groups', [Permission.WRITE]) || editableCourses === '*' || editableCourses.length > 0;
  const canDelete = canAccessSection(viewer, 'groups', [Permission.DELETE]);
  const flashMessage = await getGroupFlashMessage(params);
  const now = new Date();

  const rows: GroupDirectoryRow[] = groups.map((group) => {
    const taughtBy = instructors.get(group.id) ?? [];
    return {
      id: group.id,
      name: group.name,
      courseTitle: group.course.title,
      lessons: words.lessons(group),
      dates: words.dates(group.startsAt, group.endsAt),
      learners: group.memberCount,
      // Its learners' and notes for it, and notes on its own copy without a group.
      openFeedback:
        (openFeedback.byGroup.get(group.id) ?? 0) + (group.ownCopy ? openFeedback.byVersion.get(group.ownCopy.id) ?? 0 : 0),
      taughtBy: taughtBy.length ? { names: words.names(taughtBy.map((instructor) => instructor.name)), count: taughtBy.length } : null,
      state: groupRunState(group, now),
      canDelete,
      hasOwnCopy: Boolean(group.ownCopy),
    };
  });

  return (
    <CourseManagementFrame
      activeSection="groups"
      notice={
        flashMessage ? (
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
        <AdminSectionCard
          kicker={t('kicker')}
          title=""
          kickerAction={
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* All or mine: a switch, so a segmented control; New is the card's one filled button. */}
              <SegmentedControl
                label={t('all')}
                segments={[
                  { key: 'all', label: t('all'), href: '/admin/courses/groups', active: !mine, testId: 'groups-all' },
                  { key: 'mine', label: t('mine'), href: '/admin/courses/groups?mine=1', active: mine, testId: 'groups-mine' },
                ]}
              />
              {canCreate ? (
                <AdminButton href="/admin/courses/groups/new" size="compact">
                  <FiPlus size={15} />
                  {t('new')}
                </AdminButton>
              ) : null}
            </div>
          }
        >
          {lastGroup ? (
            <p className={styles.fieldHint} style={{ margin: '0 0 0.9rem' }}>
              {t('lastOpened')}{' '}
              <Link href={`/admin/courses/groups/${lastGroup.id}`} className={styles.inlineLink}>
                {lastGroup.name} →
              </Link>
            </p>
          ) : null}
          {rows.length > 0 ? (
            <GroupDirectory rows={rows} />
          ) : (
            <div className={styles.emptyState}>
              <h3 className={styles.emptyStateTitle}>{mine ? t('emptyMine.title') : t('empty.title')}</h3>
              <p className={styles.emptyStateText}>{mine ? t('emptyMine.text') : t('empty.text')}</p>
            </div>
          )}
        </AdminSectionCard>
      </section>
    </CourseManagementFrame>
  );
}
