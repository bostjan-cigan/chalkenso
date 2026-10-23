import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { TbBook2, TbMessageCircle, TbMessageCircleQuestion, TbSchool, TbSettings, TbUsers } from 'react-icons/tb';
import { formatAccessDate, formatDateTimeLocalValue, getDefaultAccessExpiry } from '@/lib/access-links';
import { Permission, TaskStatus } from '@prisma/client';
import { currentLearnerLinkTemplate } from '@/lib/learner-link-address';
import { ui } from '@/extensions/ui';
import {
  accessScope,
  canAddInstructorNotes,
  canEditVersion,
  canOnCourse,
  canOnGroup,
  canPreviewVersion,
  canReadFeedback,
  canWorkOnFeedback,
  courseScopeWhere,
  groupScopeWhere,
  hasCourseLevelAccess,
  isUnrestricted,
  requireGroupAccess,
} from '@/lib/crm-access';
import { groupFeedbackWhere } from '@/lib/feedback-list';
import { listUnattachedFeedback } from '@/lib/unattached-feedback';
import { TASK_ENTITY_TYPE, TASK_KIND, groupTaskLaneId, listTasksForGroup } from '@/lib/tasks';
import AdminButton from '../../../components/ui/AdminButton';
import AdminNotice from '../../../components/ui/AdminNotice';
import AdminSectionCard from '../../../components/ui/AdminSectionCard';
import AdminTabs from '../../../components/ui/AdminTabs';
import AdminTextareaField from '../../../components/ui/AdminTextareaField';
import AdminField from '../../../components/ui/AdminField';
import { SheetInfoRow, SheetRow, SheetRows } from '../../../components/ui/Sheet';
import FeedbackList from '../../../components/feedback/FeedbackList';
import { feedbackShow } from '../../../components/feedback/feedback-view';
import ImprovementsList from '../../../components/improvements/ImprovementsList';
import { loadImprovements, newFeedbackByLesson } from '../../../components/improvements/data';
import CourseManagementFrame from '../../components/CourseManagementFrame';
import PartnerListField from '../../components/PartnerListField';
import VersionLessons from '../../components/VersionLessons';
import { getVersionDetail } from '../../versions/data';
import GroupMembersPanel from '../components/GroupMembersPanel';
import GroupAccessPanel from '../components/GroupAccessPanel';
import InstructorLinksPanel from '../components/InstructorLinksPanel';
import GroupInstructorsPanel from '../components/GroupInstructorsPanel';
import OpenGroupCourseButton from '../components/OpenGroupCourseButton';
import GroupCopyActions from '../components/GroupCopyActions';
import GroupDeleteButton from '../components/GroupDeleteButton';
import GroupSwitcher from '../components/GroupSwitcher';
import GroupRosterForm from '../components/GroupRosterForm';
import { GroupDateField, GroupLessonsFields, GroupNameFields, GroupRosterFields, GroupSettingsForm } from '../components/GroupSettingsSheets';
import RememberGroup from '../components/RememberGroup';
import { listAssignableInstructors, listGroupInstructors, listPendingGroupInvites } from '@/lib/group-instructors';
import { findInstructorLink, listGroupInstructorLinks } from '@/lib/instructor-links';
import { canAccessSection } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { INTL_LOCALES } from '@/i18n/config';
import {
  getGroupDetail,
  groupRowWords,
  groupRunState,
  listCoursesForGroupForm,
  listPartnersForGroupForm,
  listVersionsByCourseForGroupForm,
} from '../data';
import { getGroupFlashMessage } from '../messages';
import styles from '../../../admin.module.css';

type PageParams = Promise<{ groupId: string }>;

type SearchParams = Promise<{
  error?: string;
  status?: string;
  /** Which tab: lessons, in-class, feedback, people, learner-feedback, settings. */
  tab?: string;
  /** Feedback: open (default), change, done. */
  show?: string;
  /** Feedback on one lesson only. */
  lesson?: string;
}>;

const TABS = ['lessons', 'in-class', 'feedback', 'people', 'learner-feedback', 'settings'] as const;
type GroupTab = (typeof TABS)[number];
/** Each tab's name (in `groups.detail.tabs`) and icon. */
const TAB_WORDS = { lessons: 'lessons', 'in-class': 'inClass', feedback: 'feedback', people: 'people', 'learner-feedback': 'learnerFeedback', settings: 'settings' } as const;
const TAB_ICONS = { lessons: TbBook2, 'in-class': TbSchool, feedback: TbMessageCircle, people: TbUsers, 'learner-feedback': TbMessageCircleQuestion, settings: TbSettings };

/**
 * A group: one run of a course, with its learners and (usually) its own copy of the lessons. A header
 * (the group's name with a switcher, its course, dates and learners) and its tabs: its Lessons, In
 * class (the edition's own, where the page opens for its instructors), the Feedback its learners sent
 * (and the changes made from it), its People, Learner feedback (the edition's own) and its Settings,
 * for those who set them (as a course's Settings: rows with their value that open a sheet for the
 * part they name, saved on its own).
 */
export default async function GroupDetailPage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  const { groupId } = await params;
  // The Groups section, the group's course, or an instructor of this group.
  const viewer = await requireGroupAccess(groupId, [Permission.READ]);
  const search = await searchParams;

  // The group, who teaches it, and the viewer's other groups (for the switcher) side by side.
  const [group, instructors, switchable, t, words] = await Promise.all([
    getGroupDetail(groupId),
    listGroupInstructors(groupId),
    prisma.courseGroup.findMany({
      where: groupScopeWhere(accessScope(viewer, 'groups')),
      orderBy: [{ course: { title: 'asc' } }, { name: 'asc' }],
      select: { id: true, name: true, course: { select: { title: true } } },
    }),
    getTranslations('groups.detail'),
    groupRowWords(),
  ]);
  if (!group) {
    notFound();
  }

  // Group settings are course work; instructors manage only the roster and links.
  const canManageGroup = canOnCourse(viewer, group.course.id, [Permission.WRITE]);
  const canDeleteGroup = canAccessSection(viewer, 'groups', [Permission.DELETE]);
  const shownTabs = TABS.filter(
    (name) => ((name !== 'learner-feedback' && name !== 'in-class') || ui.GroupPanels) && (name !== 'settings' || canManageGroup || canDeleteGroup)
  );
  // Whoever teaches the group without managing its course opens it on In class: saying how each lesson went is their work.
  const teaches = instructors.some((instructor) => instructor.userId === viewer.id);
  const defaultTab: GroupTab = teaches && !canManageGroup && shownTabs.includes('in-class') ? 'in-class' : 'lessons';
  const tab: GroupTab = (shownTabs as readonly string[]).includes(search.tab ?? '') ? (search.tab as GroupTab) : defaultTab;
  const feedbackRef = { courseId: group.course.id, groupIds: [group.id] };
  const canWork = canWorkOnFeedback(viewer, feedbackRef, 'tasks');
  // Whoever teaches it opens its course from the top, through their own instructor link.
  const canNote = canAddInstructorNotes(viewer, feedbackRef);
  const canViewGroupTasks = canReadFeedback(viewer, feedbackRef, 'tasks');
  const copy = group.groupCurriculum;
  // The lessons the group reads: its own copy, or the version it is assigned.
  const readVersion = group.curriculumVersionId
    ? { id: group.curriculumVersionId, courseId: group.course.id, ownerGroupId: group.curriculumVersion?.ownerGroupId ?? null }
    : null;
  const readLessonsHref =
    readVersion && canPreviewVersion(viewer, readVersion)
      ? `/admin/courses/${group.course.id}/versions/${readVersion.id}/preview?group=${group.id}`
      : null;
  const canEditCopy = copy ? canEditVersion(viewer, { id: copy.id, courseId: group.course.id, ownerGroupId: group.id }, [Permission.WRITE]) : false;
  const groupHref = `/admin/courses/groups/${group.id}`;
  const tabHref = (name: GroupTab) => (name === defaultTab ? groupHref : `${groupHref}?tab=${name}`);

  // What each tab needs, loaded only for the tab that is open, all side by side.
  const editableCourses = courseScopeWhere(accessScope(viewer, 'courses', [Permission.WRITE]));
  const [copyDetail, readDetail, groupTasks, people, settingsData, learnerLinkTemplate, locale, ownLink] = await Promise.all([
    tab === 'lessons' && copy && canEditCopy ? getVersionDetail(group.course.id, copy.id) : null,
    // The lessons it reads, as the course has them (giving the group its own copy is in Settings).
    tab === 'lessons' && readVersion && !copy
      ? prisma.curriculumVersion.findUnique({
          where: { id: readVersion.id },
          select: { label: true, lessons: { orderBy: { position: 'asc' }, select: { id: true, title: true, position: true } } },
        })
      : null,
    tab === 'feedback' && canViewGroupTasks ? listTasksForGroup(group.id, TASK_KIND.curriculum) : [],
    tab === 'people' ? loadPeople(viewer, group.id, group.course.id, canManageGroup) : null,
    tab === 'settings' && canManageGroup
      ? Promise.all([
          listCoursesForGroupForm(editableCourses),
          isUnrestricted(viewer) ? listPartnersForGroupForm() : [],
          listVersionsByCourseForGroupForm(editableCourses),
        ])
      : null,
    tab === 'people' || canNote ? currentLearnerLinkTemplate() : null,
    getLocale(),
    canNote ? findInstructorLink(viewer.id, group.id) : null,
  ]);

  const [flashMessage, form] = await Promise.all([getGroupFlashMessage(search), getTranslations('groups.form')]);
  const none = t('settings.none');
  const shortDate = (date: Date) => new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: 'medium' }).format(date);
  const state = groupRunState({ startsAt: group.startsAt, endsAt: group.endsAt, ownCopy: copy ? { closed: copy.archivedAt !== null } : null });
  const lessonsLabel = copy
    ? copy.baseVersion
      ? t('subtitle.ownCopyOf', { version: copy.baseVersion.label })
      : t('subtitle.ownCopyOfCourse')
    : group.curriculumVersion
      ? t('subtitle.reads', { version: group.curriculumVersion.label })
      : t('subtitle.noLessons');
  const subtitle = [
    lessonsLabel,
    words.dates(group.startsAt, group.endsAt),
    t('subtitle.learners', { count: group.members.length }),
    state === 'undated' ? null : t(`subtitle.run.${state}`),
    instructors.length
      ? t('subtitle.taughtBy', { names: words.names(instructors.map((instructor) => instructor.name)), count: instructors.length })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const openTasks = groupTasks.filter((task) => task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS).length;

  // Its improvements, with where each one is (listed when that view is open).
  const listsImprovements = tab === 'feedback' && canViewGroupTasks && feedbackShow(search.show) === 'change';
  const [improvements, lessonFeedback] = listsImprovements
    ? await Promise.all([
        loadImprovements(viewer, { entityLinks: { some: { entityType: TASK_ENTITY_TYPE.courseGroup, entityId: group.id } } }),
        newFeedbackByLesson(viewer, groupFeedbackWhere(group.id)),
      ])
    : [[], []];

  return (
    <CourseManagementFrame
      activeSection="groups"
      notice={
        flashMessage ? (
          <AdminNotice className={styles.statusNotice} icon={<FiAlertTriangle size={18} />} variant="banner">
            {/* A new group starts with only its lessons, name and learners: the rest is in Settings. */}
            {search.status === 'group-created' && canManageGroup
              ? t.rich('created', {
                  link: (chunks: ReactNode) => (
                    <Link href={tabHref('settings')} className={styles.inlineLink}>
                      {chunks}
                    </Link>
                  ),
                })
              : flashMessage}
          </AdminNotice>
        ) : null
      }
    >
      <RememberGroup groupId={group.id} />
      <div className={styles.coursePageContext}>
        <div className={styles.coursePageContextRow}>
          <div className={styles.coursePageContextLead}>
            <Link href="/admin/courses/groups" className={styles.coursePageContextBack}>
              <span className={styles.coursePageContextBackCaret} aria-hidden="true">
                &lt;
              </span>
              {t('back')}
            </Link>
            <div className={styles.coursePageContextTitleRow}>
              <GroupSwitcher
                current={{ id: group.id, name: group.name }}
                groups={switchable.map((entry) => ({ id: entry.id, name: entry.name, course: entry.course.title }))}
                tab={tab}
              />
            </div>
            <p className={styles.coursePageContextSubtitle}>
              {canOnCourse(viewer, group.course.id, [Permission.READ]) ? (
                <Link href={`/admin/courses/${group.course.id}`} className={styles.inlineLink}>
                  {group.course.title}
                </Link>
              ) : (
                group.course.title
              )}
              {' · '}
              {subtitle}
            </p>
          </div>
          <div className={styles.coursePageContextActions}>
            {canNote ? <OpenGroupCourseButton groupId={group.id} initialToken={ownLink?.token ?? null} learnerLinkTemplate={learnerLinkTemplate} /> : null}
            {readLessonsHref ? (
              <AdminButton href={readLessonsHref} tone="secondary">
                {t('readLessons')}
              </AdminButton>
            ) : null}
            {ui.courseTabs.some((extra) => extra.key === 'insights') && hasCourseLevelAccess(viewer) && canOnCourse(viewer, group.course.id, [Permission.READ]) ? (
              <AdminButton href={`/admin/courses/${group.course.id}/insights?group=${group.id}`} tone="secondary">
                {t('insights')}
              </AdminButton>
            ) : null}
          </div>
        </div>
      </div>

      <AdminTabs
        label={t('tabs.label')}
        tabs={shownTabs.map((name) => ({
          href: tabHref(name),
          label: t(`tabs.${TAB_WORDS[name]}`),
          Icon: TAB_ICONS[name],
          active: tab === name,
        }))}
      />

      <section className={styles.editorPageSection}>
        {tab === 'lessons' ? (
          <>
            {copy && copyDetail ? (
              <VersionLessons
                viewer={viewer}
                version={copyDetail}
                feedbackHref={(lessonId) => `${groupHref}?tab=feedback&lesson=${lessonId}`}
                intro={
                  <p className={styles.fieldHint} style={{ margin: '0 0 0.9rem' }}>
                    {copy.archivedAt
                      ? t('lessons.closed')
                      : copy.baseVersion
                        ? t('lessons.ownCopyFrom', { version: copy.baseVersion.label })
                        : t('lessons.ownCopyFromCourse')}
                  </p>
                }
              />
            ) : copy || !readVersion ? (
              <AdminSectionCard kicker={t('lessons.kicker')} title="">
                <p className={styles.fieldHint} style={{ margin: 0 }}>
                  {copy ? t('lessons.ownCopy') : t('lessons.none')}
                </p>
              </AdminSectionCard>
            ) : readDetail?.lessons.length ? (
              // Reading the course as it is: its lessons. Giving the group its own copy is in Settings.
              <AdminSectionCard kicker={t('lessons.kicker')} title="">
                <ol className={styles.stackList} style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {readDetail.lessons.map((lesson) => (
                    <li key={lesson.id}>{lesson.title}</li>
                  ))}
                </ol>
              </AdminSectionCard>
            ) : null}
          </>
        ) : null}

        {tab === 'in-class' && ui.GroupPanels ? <ui.GroupPanels groupId={group.id} canManage={canManageGroup} canWork={canWork} place="inClass" /> : null}

        {tab === 'feedback' ? (
          <AdminSectionCard
            kicker={t('feedback.kicker')}
            title=""
            kickerAction={
              <AdminButton href={`/admin/api/feedback-export?group=${group.id}`} download size="compact" tone="secondary" data-testid="feedback-export">
                {t('feedback.export')}
              </AdminButton>
            }
          >
            <FeedbackList
              viewer={viewer}
              where={groupFeedbackWhere(group.id)}
              show={feedbackShow(search.show)}
              lessonId={search.lesson ?? null}
              baseHref={`${groupHref}?tab=feedback`}
              roster={
                canOnGroup(viewer, { id: group.id, courseId: group.course.id }, [Permission.READ]) && group.members.length
                  ? { groupId: group.id, learners: group.members.map((member) => ({ id: member.id, label: `${member.position}. ${member.fullName}` })) }
                  : null
              }
              emptyText={t('feedback.empty')}
              top={ui.GroupPanels ? <ui.GroupPanels groupId={group.id} canManage={canManageGroup} canWork={canWork} place="feedback" /> : null}
              changeCount={openTasks}
              changes={
                canViewGroupTasks ? (
                  <ImprovementsList
                    rows={improvements}
                    feedback={lessonFeedback}
                    boardHref={`/admin/tasks?curriculum=${encodeURIComponent(groupTaskLaneId(group.id))}`}
                  />
                ) : null
              }
            />
          </AdminSectionCard>
        ) : null}

        {tab === 'people' && people ? (
          <>
            <AdminSectionCard kicker={t('people.learners')} title="">
              {!canManageGroup ? <GroupRosterForm groupId={group.id} initialRoster={group.sourceRosterText ?? ''} /> : null}
              {group.members.length > 0 ? (
                <GroupMembersPanel
                  defaultExpiryValue={formatDateTimeLocalValue(getDefaultAccessExpiry())}
                  groupId={group.id}
                  members={group.members.map((member) => ({
                    id: member.id,
                    position: member.position,
                    fullName: member.fullName,
                    accessLink: member.accessLinks[0]
                      ? {
                          id: member.accessLinks[0].id,
                          expiresAt: member.accessLinks[0].expiresAt.toISOString(),
                          lastAccessedAt: member.accessLinks[0].lastAccessedAt?.toISOString() ?? null,
                          token: member.accessLinks[0].token,
                        }
                      : null,
                  }))}
                  learnerLinkTemplate={learnerLinkTemplate}
                  unattached={people.unattached}
                />
              ) : (
                <div className={styles.emptyState}>
                  <h3 className={styles.emptyStateTitle}>{t('people.empty.title')}</h3>
                  <p className={styles.emptyStateText}>
                    {canManageGroup
                      ? t.rich('people.empty.inSettings', {
                          link: (chunks: ReactNode) => <Link href={tabHref('settings')}>{chunks}</Link>,
                        })
                      : t('people.empty.above')}
                  </p>
                </div>
              )}
            </AdminSectionCard>

            <AdminSectionCard kicker={t('people.instructors')} title="">
              <GroupInstructorsPanel
                groupId={group.id}
                canManage={canManageGroup}
                instructors={instructors.map((instructor) => ({ userId: instructor.userId, name: instructor.name }))}
                pendingInvites={people.pendingInvites.map((invite) => ({ id: invite.id, label: invite.label, expiresAt: invite.expiresAt.toISOString() }))}
                candidates={people.candidates.map((candidate) => ({
                  userId: candidate.userId,
                  name: candidate.name,
                  gives:
                    candidate.access.kind === 'none'
                      ? null
                      : candidate.access.permissions.length === 1 && candidate.access.permissions[0] === Permission.NOTES
                        ? t('people.givesNotes')
                        : t('people.givesAccess'),
                }))}
              />
            </AdminSectionCard>

            {/* Links made now and then: rows that open sheets, as a version's Share a preview. */}
            <SheetRows testId="group-links">
              <SheetRow
                label={t('people.groupLink')}
                value={group.accessLinks[0] ? t('people.until', { date: shortDate(group.accessLinks[0].expiresAt) }) : none}
                testId="group-link-row"
              >
                <GroupAccessPanel
                  defaultExpiryValue={formatDateTimeLocalValue(getDefaultAccessExpiry())}
                  groupId={group.id}
                  learnerLinkTemplate={learnerLinkTemplate}
                  initialActiveLink={
                    group.accessLinks[0]
                      ? {
                          expiresAt: group.accessLinks[0].expiresAt.toISOString(),
                          id: group.accessLinks[0].id,
                          lastAccessedAt: group.accessLinks[0].lastAccessedAt?.toISOString() ?? null,
                          token: group.accessLinks[0].token,
                        }
                      : null
                  }
                />
              </SheetRow>
              {people.canNote || (people.instructorLinks && people.instructorLinks.length > 0) ? (
                <SheetRow
                  label={t('people.instructorLinks')}
                  value={
                    people.instructorLinks
                      ? people.instructorLinks.length
                        ? t('people.linkCount', { count: people.instructorLinks.length })
                        : none
                      : people.ownLink
                        ? t('people.yoursUntil', { date: shortDate(people.ownLink.expiresAt) })
                        : none
                  }
                  testId="instructor-links-row"
                >
                  <InstructorLinksPanel
                    groupId={group.id}
                    learnerLinkTemplate={learnerLinkTemplate}
                    canNote={people.canNote}
                    initialLink={people.ownLink ? { token: people.ownLink.token, expiresAt: people.ownLink.expiresAt.toISOString() } : null}
                    links={
                      people.instructorLinks
                        ? people.instructorLinks.map((link) => ({
                            id: link.id,
                            name: link.name,
                            mine: link.userId === viewer.id,
                            expiresAt: link.expiresAt.toISOString(),
                            lastAccessedAt: link.lastAccessedAt?.toISOString() ?? null,
                          }))
                        : null
                    }
                  />
                </SheetRow>
              ) : null}
            </SheetRows>
          </>
        ) : null}

        {tab === 'learner-feedback' && ui.GroupPanels ? (
          <ui.GroupPanels groupId={group.id} canManage={canManageGroup} canWork={canWork} place="learnerFeedback" />
        ) : null}

        {tab === 'settings' ? (
          <>
            {canManageGroup && settingsData ? (
              <>
                <SheetRows title={t('settings.group')} testId="group-details">
                  <SheetRow label={t('settings.name')} title={t('settings.nameSheet')} value={group.name} testId="group-name-row">
                    <GroupSettingsForm groupId={group.id}>
                      <GroupNameFields initialName={group.name} initialSlug={group.slug} />
                    </GroupSettingsForm>
                  </SheetRow>
                  <SheetRow label={form('description')} value={group.description || none} testId="group-description-row">
                    <GroupSettingsForm groupId={group.id}>
                      <AdminTextareaField
                        id="group-description"
                        name="description"
                        label={form('description')}
                        hint={form('descriptionHint')}
                        placeholder={form('descriptionPlaceholder')}
                        defaultValue={group.description ?? ''}
                      />
                    </GroupSettingsForm>
                  </SheetRow>
                  {/* Partners are shared by every course: only unrestricted members set them. */}
                  {isUnrestricted(viewer) ? (
                    <SheetRow label={form('partners')} value={group.partners.length || none} testId="group-partners-row">
                      <GroupSettingsForm groupId={group.id}>
                        <PartnerListField
                          id="group-partners"
                          label={form('partners')}
                          hint={form('partnersHint')}
                          options={settingsData[1]}
                          initialPartnerIds={group.partners.map((partner) => partner.partnerId)}
                        />
                      </GroupSettingsForm>
                    </SheetRow>
                  ) : null}
                  <SheetRow label={t('settings.slack')} value={group.slackHandle || none} testId="group-slack-row">
                    <GroupSettingsForm groupId={group.id}>
                      <AdminField
                        id="group-slack-handle"
                        name="slackHandle"
                        label={form('slack')}
                        hint={form('slackHint')}
                        placeholder={form('slackPlaceholder')}
                        defaultValue={group.slackHandle ?? ''}
                      />
                    </GroupSettingsForm>
                  </SheetRow>
                </SheetRows>

                <SheetRows title={t('settings.dates')} testId="group-dates">
                  <SheetRow
                    label={t('settings.starts')}
                    value={group.startsAt ? formatAccessDate(group.startsAt, locale) : none}
                    testId="group-starts-row"
                  >
                    <GroupSettingsForm groupId={group.id}>
                      <GroupDateField
                        id="group-starts-at"
                        name="startsAt"
                        label={t('settings.hasStart')}
                        initialValue={group.startsAt ? formatDateTimeLocalValue(group.startsAt) : ''}
                      />
                    </GroupSettingsForm>
                  </SheetRow>
                  <SheetRow label={t('settings.ends')} value={group.endsAt ? formatAccessDate(group.endsAt, locale) : none} testId="group-ends-row">
                    <GroupSettingsForm groupId={group.id}>
                      <GroupDateField
                        id="group-ends-at"
                        name="endsAt"
                        label={t('settings.hasEnd')}
                        initialValue={group.endsAt ? formatDateTimeLocalValue(group.endsAt) : ''}
                      />
                    </GroupSettingsForm>
                  </SheetRow>
                </SheetRows>

                <SheetRows title={t('settings.learners')} testId="group-learners">
                  <SheetRow label={t('settings.roster')} value={form('learners', { count: group.members.length })} testId="group-roster-row">
                    {/* A group added without a pasted roster opens with its learners as they are. */}
                    <GroupSettingsForm groupId={group.id}>
                      <GroupRosterFields initialRoster={group.sourceRosterText || group.members.map((member) => member.fullName).join('\n')} />
                    </GroupSettingsForm>
                  </SheetRow>
                </SheetRows>

                {/* What it reads, and what can happen to its own copy. A group with its own copy keeps its course and version. */}
                <GroupCopyActions
                  mode={copy ? 'manage' : group.curriculumVersion ? 'start' : null}
                  groupId={group.id}
                  groupName={group.name}
                  readsLabel={copy ? (copy.baseVersion?.label ?? null) : (group.curriculumVersion?.label ?? null)}
                  closed={copy ? copy.archivedAt !== null : false}
                  title={t('settings.copy.kicker')}
                  footer={
                    copy
                      ? t('settings.copy.footer', { closed: copy.archivedAt ? 'yes' : 'no' })
                      : group.curriculumVersion
                        ? t('settings.copy.reads', { version: group.curriculumVersion.label })
                        : undefined
                  }
                >
                  {copy ? (
                    <SheetInfoRow
                      label={t('settings.lessons')}
                      value={copy.baseVersion ? t('settings.ownCopyOf', { version: copy.baseVersion.label }) : t('settings.ownCopyOfCourse')}
                      testId="group-lessons-row"
                    />
                  ) : (
                    <SheetRow
                      label={t('settings.lessons')}
                      title={t('settings.lessonsSheet')}
                      value={group.curriculumVersion?.label ?? none}
                      testId="group-lessons-row"
                    >
                      <GroupSettingsForm groupId={group.id}>
                        <GroupLessonsFields
                          courses={settingsData[0]}
                          versionsByCourseId={settingsData[2]}
                          initialCourseId={group.course.id}
                          initialVersionId={group.curriculumVersionId ?? ''}
                          editing
                        />
                      </GroupSettingsForm>
                    </SheetRow>
                  )}
                </GroupCopyActions>
              </>
            ) : null}

            {canDeleteGroup ? (
              <SheetRows footer={copy ? t('settings.delete.textWithCopy') : t('settings.delete.text')} testId="group-delete-rows">
                <GroupDeleteButton row groupId={group.id} groupName={group.name} hasGroupCurriculum={Boolean(copy)} />
              </SheetRows>
            ) : null}
          </>
        ) : null}
      </section>
    </CourseManagementFrame>
  );
}

/** The People tab: instructors, who can be added or invited, and instructor links. */
async function loadPeople(
  viewer: Awaited<ReturnType<typeof requireGroupAccess>>,
  groupId: string,
  courseId: string,
  canManageGroup: boolean
) {
  const feedbackRef = { courseId, groupIds: [groupId] };
  const canNote = canAddInstructorNotes(viewer, feedbackRef);
  const groupRef = { id: groupId, courseId };
  const [ownLink, instructorLinks, candidates, pendingInvites, unattached] = await Promise.all([
    canNote ? findInstructorLink(viewer.id, groupId) : null,
    canManageGroup ? listGroupInstructorLinks(groupId) : null,
    canManageGroup && viewer.organizationId ? listAssignableInstructors(viewer.organizationId, groupRef) : [],
    canManageGroup && viewer.organizationId ? listPendingGroupInvites(viewer.organizationId, groupId) : [],
    // Feedback whose learner left the roster, to move to one on it (the People tab's own work: READ).
    listUnattachedFeedback(groupId),
  ]);
  return { canNote, ownLink, instructorLinks, candidates, pendingInvites, unattached };
}
