import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { TbChevronRight } from 'react-icons/tb';
import AdminFrame from './components/AdminFrame';
import AdminButton from './components/ui/AdminButton';
import AdminNotice from './components/ui/AdminNotice';
import AdminSectionCard from './components/ui/AdminSectionCard';
import { Permission, type UserRole } from '@prisma/client';
import type { Locale } from '@/i18n/config';
import IntlProvider from '@/i18n/IntlProvider';
import { isOrgAdmin, requireMember } from '@/lib/admin-auth';
import {
  accessScope,
  canAddInstructorNotes,
  canOnGroup,
  canOpenGroupPreview,
  commentScopeWhere,
  courseScopeWhere,
  groupScopeWhere,
  hasAnyAccess,
  hasCourseLevelAccess,
} from '@/lib/crm-access';
import { canAccessSection, courseGrantIds, groupGrantIds, type Grant } from '@/lib/permissions';
import { findInstructorLinks } from '@/lib/instructor-links';
import { groupIdsTaughtBy } from '@/lib/group-instructors';
import { currentLearnerLinkTemplate } from '@/lib/learner-link-address';
import { countOpenFeedback } from '@/lib/feedback-list';
import InstructorLinksPanel from './courses/groups/components/InstructorLinksPanel';
import { groupRowWords, groupRunState, listGroupsForIndex } from './courses/groups/data';
import { isAiMock } from '@/lib/ai';
import { aiAvailability, showsAiMockNote } from '@/lib/ai-key';
import { serverExtensions } from '@/extensions/server';
import { prisma } from '@/lib/prisma';
import { orgNoticeText, readOrgNotice } from '@/lib/org-notice';
import { loadGettingStarted } from './getting-started/data';
import ShowGettingStarted from './getting-started/ShowGettingStarted';
import { loadNeedsYou } from './needs-you';
import NotesSeen from './components/NotesSeen';
import { feedbackOutcomesSince } from '@/lib/curriculum-comments';
import styles from './admin.module.css';
import { adminNavItems } from '@/app/admin/nav';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ joined?: string; org?: string }>;

/** How many groups and courses Home lists before "All groups" / "All courses". */
const GROUPS_SHOWN = 6;
const COURSES_SHOWN = 8;

/**
 * Home: its title and the two things to create, then what needs you (feedback nobody has answered,
 * changes groups suggested, drafts to review), your groups and your courses, each one click from its
 * own page. Each section is its title and its list; a notice is one sentence. In the reader's
 * language (`app.home`).
 */
export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireMember();

  // Everything counts only what the viewer reaches (limited members: their courses and groups).
  const courseWhere = courseScopeWhere(accessScope(viewer, 'courses'));
  const groupWhere = groupScopeWhere(accessScope(viewer, 'groups'));
  const courseLevel = hasCourseLevelAccess(viewer);
  const anyAccess = hasAnyAccess(viewer);
  const canCreateCourse = canAccessSection(viewer, 'courses', [Permission.WRITE]);
  const editableCourses = courseGrantIds(viewer.grants, [Permission.WRITE]);
  const canCreateGroup = canAccessSection(viewer, 'groups', [Permission.WRITE]) || editableCourses === '*' || editableCourses.length > 0;
  // None of these needs another's answer: they all run at once.
  const [
    ai,
    params,
    orgNotice,
    taughtGroups,
    needsYou,
    groups,
    openFeedback,
    courses,
    gettingStarted,
    t,
    rowWords,
    locale,
  ] = await Promise.all([
    aiAvailability(),
    searchParams,
    searchParams.then((current) => (current.org === 'notice' ? readOrgNotice() : null)),
    yourGroups(viewer),
    anyAccess ? loadNeedsYou() : Promise.resolve([]),
    anyAccess ? listGroupsForIndex(groupWhere) : Promise.resolve([]),
    anyAccess ? countOpenFeedback(commentScopeWhere(accessScope(viewer, 'comments'))) : null,
    courseLevel
      ? prisma.course.findMany({
          where: courseWhere,
          orderBy: { title: 'asc' },
          take: COURSES_SHOWN + 1,
          select: { id: true, title: true, _count: { select: { groups: true } } },
        })
      : Promise.resolve([]),
    loadGettingStarted(),
    getTranslations('app.home'),
    groupRowWords(),
    getLocale() as Promise<Locale>,
  ]);
  // AI in the app, only when it isn't simply working, in one sentence: why it's off, that it runs
  // without a refused key (to those who can replace it), or (to developers running it locally) that it
  // gives sample answers.
  const aiNote =
    ai.reason === 'paused'
      ? t('ai.paused')
      : ai.reason === 'key-invalid'
        ? t('ai.keyInvalid')
        : ai.reason === 'cap'
          ? t('ai.cap')
          : ai.refusedKeyFallback && isOrgAdmin(viewer)
            ? t(ai.refusedKeyFallback === 'hosted' ? 'ai.keyRefusedHosted' : 'ai.keyRefusedInstallation')
            : isAiMock()
              ? showsAiMockNote()
                ? t('ai.mock')
                : null
              : ai.inApp
                ? null
                : ai.reason === 'plan'
                  ? t('ai.plan')
                  : serverExtensions.aiOrganizationKeys
                    ? t('ai.offUntilKey')
                    : t('ai.offInstallation');

  // Your groups: the ones you teach first; otherwise the ones running now, busiest first.
  const now = new Date();
  const taught = new Set(taughtGroups.groups.map((group) => group.id));
  const crmViewer = { id: viewer.id, role: viewer.role, grants: viewer.grants, organizationId: viewer.organization.id };
  const groupCards = groups
    .map((group) => ({
      ...group,
      state: groupRunState(group, now),
      open: openFeedback
        ? (openFeedback.byGroup.get(group.id) ?? 0) + (group.ownCopy ? openFeedback.byVersion.get(group.ownCopy.id) ?? 0 : 0)
        : 0,
    }))
    .filter((group) => (taught.size ? taught.has(group.id) : group.state === 'running'))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  // A guest instructor can't open the group's page: their instructor link is how they reach it.
  const guestGroups = taughtGroups.groups.filter((group) => !canOnGroup(crmViewer, { id: group.id, courseId: group.courseId }, [Permission.READ]));
  // What happened to the person's instructor notes since they last looked: changed a lesson, or answered.
  const seenAt = (await prisma.user.findUnique({ where: { id: viewer.id }, select: { notesSeenAt: true } }))?.notesSeenAt ?? null;
  const yourNotes = seenAt ? await feedbackOutcomesSince({ authorUserId: viewer.id, isInstructorNote: true }, seenAt) : [];
  const noteLinks = yourNotes.length
    ? new Map(
        (
          await prisma.curriculumComment.findMany({
            where: { id: { in: yourNotes.map((note) => note.id) } },
            select: { id: true, curriculumVersionId: true, groupId: true, lesson: { select: { courseId: true, position: true } } },
          })
        ).map((note) => [note.id, { href: `/admin/courses/${note.lesson.courseId}/versions/${note.curriculumVersionId}/preview${note.groupId ? `?group=${note.groupId}` : ''}`, position: note.lesson.position }])
      )
    : new Map<string, { href: string; position: number }>();

  return (
    <AdminFrame
      navItems={adminNavItems('overview')}
      title={t('title')}
      actions={[
        ...(canCreateCourse ? [{ label: t('newCourse'), href: '/admin/courses/new' }] : []),
        ...(canCreateGroup ? [{ label: t('newGroup'), href: '/admin/courses/groups/new', tone: 'secondary' as const }] : []),
      ]}
    >
      {/* The sidebar names the organisation they are in now. */}
      {orgNotice ? (
        <section className={styles.editorPageSection}>
          <AdminNotice>{orgNoticeText(orgNotice, locale)}</AdminNotice>
        </section>
      ) : null}

      {params.joined ? (
        <section className={styles.editorPageSection}>
          <AdminNotice>{t('joined', { organization: viewer.organization.name })}</AdminNotice>
        </section>
      ) : null}

      {yourNotes.length ? (
        <section className={styles.editorPageSection} data-testid="your-notes">
          <NotesSeen />
          <p className={styles.quietText} style={{ margin: 0 }}>
            {[
              yourNotes.some((note) => note.outcome === 'changed') ? t('yourNotes.changed', { count: yourNotes.filter((note) => note.outcome === 'changed').length }) : null,
              yourNotes.some((note) => note.outcome === 'replied') ? t('yourNotes.replied', { count: yourNotes.filter((note) => note.outcome === 'replied').length }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <ul className={styles.needsYouList}>
            {yourNotes.map((note) => (
              <li key={note.id}>
                <Link href={noteLinks.get(note.id)?.href ?? '/admin'} className={styles.needsYouItem}>
                  <span>
                    {t('yourNotes.lesson', { position: noteLinks.get(note.id)?.position ?? 0 })} · “{note.quote}”
                  </span>
                  <TbChevronRight size={16} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {anyAccess ? (
        <section className={styles.editorPageSection}>
          <AdminSectionCard title={t('needsYou')}>
            {needsYou.length ? (
              <ul className={styles.needsYouList} data-testid="needs-you">
                {needsYou.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className={styles.needsYouItem}>
                      <span>{item.text}</span>
                      <TbChevronRight size={16} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.quietText} style={{ margin: 0 }} data-testid="needs-you">
                {t('nothingWaits')}
              </p>
            )}
          </AdminSectionCard>
        </section>
      ) : null}

      {guestGroups.length || (taughtGroups.groups.length && !anyAccess) ? (
        <section className={styles.editorPageSection}>
          <AdminSectionCard title={t('yourGroups')}>
            {/* The instructor links' own words are the groups' (`groups.instructorLinks`). */}
            <IntlProvider namespaces={['common', 'app', 'groups.instructorLinks']}>
              <div style={{ display: 'grid', gap: '1rem' }} data-testid="guest-groups">
                {(anyAccess ? guestGroups : taughtGroups.groups).map((group) => (
                  <div key={group.id} style={{ display: 'grid', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <strong>
                        {group.name} <span style={{ fontWeight: 400, opacity: 0.7 }}>· {group.course.title}</span>
                      </strong>
                      {group.previewHref ? (
                        <AdminButton href={group.previewHref} size="compact" tone="plain" data-testid="guest-preview">
                          {t('readLessons')}
                        </AdminButton>
                      ) : null}
                    </div>
                    <InstructorLinksPanel
                      groupId={group.id}
                      learnerLinkTemplate={taughtGroups.template}
                      canNote={group.canNote}
                      initialLink={group.link}
                      links={null}
                    />
                  </div>
                ))}
              </div>
            </IntlProvider>
          </AdminSectionCard>
        </section>
      ) : null}

      {!anyAccess && !taughtGroups.groups.length ? (
        <section className={styles.editorPageSection}>
          <AdminNotice>{t('noAccess')}</AdminNotice>
        </section>
      ) : null}

      {anyAccess && (groupCards.length || groups.length) ? (
        <section className={styles.editorPageSection}>
          <AdminSectionCard
            title={taught.size ? t('groupsYouTeach') : t('runningNow')}
            action={
              <AdminButton href="/admin/courses/groups" size="compact" tone="plain">
                {t('allGroups')}
              </AdminButton>
            }
          >
            {groupCards.length ? (
              <div className={styles.homeGrid} data-testid="home-groups">
                {groupCards.slice(0, GROUPS_SHOWN).map((group) => (
                  <Link key={group.id} href={`/admin/courses/groups/${group.id}`} className={styles.homeCard}>
                    <strong>{group.name}</strong>
                    <span className={styles.homeCardMeta}>{group.course.title}</span>
                    <span className={styles.homeCardMeta}>
                      {[rowWords.dates(group.startsAt, group.endsAt), t('learners', { count: group.memberCount })]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {group.open ? <span className={styles.homeCardBadge}>{t('openFeedback', { count: group.open })}</span> : null}
                  </Link>
                ))}
              </div>
            ) : (
              <p className={styles.quietText} style={{ margin: 0 }}>
                {t('noneRunning')}
              </p>
            )}
          </AdminSectionCard>
        </section>
      ) : null}

      {courseLevel && courses.length ? (
        <section className={styles.editorPageSection}>
          <AdminSectionCard
            title={t('courses')}
            action={
              <AdminButton href="/admin/courses" size="compact" tone="plain">
                {t('allCourses')}
              </AdminButton>
            }
          >
            <div className={styles.homeGrid}>
              {courses.slice(0, COURSES_SHOWN).map((course) => (
                <Link key={course.id} href={`/admin/courses/${course.id}`} className={styles.homeCard}>
                  <strong>{course.title}</strong>
                  <span className={styles.homeCardMeta}>{t('groups', { count: course._count.groups })}</span>
                </Link>
              ))}
            </div>
          </AdminSectionCard>
        </section>
      ) : null}

      {anyAccess && aiNote ? (
        <section className={styles.editorPageSection}>
          <p className={styles.quietText} style={{ margin: 0 }}>
            {aiNote}
            {!ai.inApp && ai.connector && ai.reason !== 'plan' ? ` ${t('ai.connector')}` : ''}
          </p>
        </section>
      ) : null}

      {/* Getting started lives in the corner; hidden, it can come back from here while steps are left. */}
      {gettingStarted?.hidden ? (
        <section className={styles.editorPageSection}>
          <ShowGettingStarted />
        </section>
      ) : null}
    </AdminFrame>
  );
}

/**
 * The groups someone teaches (assigned as an instructor) and a guest instructor's groups (their NOTES
 * grants), with their instructor links and the team preview of the lessons each group reads.
 */
async function yourGroups(viewer: { id: string; role: UserRole; grants: Grant[]; organization: { id: string } }) {
  const ids = Array.from(new Set([...(await groupIdsTaughtBy(viewer.id)), ...groupGrantIds(viewer.grants, [Permission.NOTES])]));
  if (!ids.length) {
    return { groups: [], template: null };
  }
  const [groups, template, links] = await Promise.all([
    prisma.courseGroup.findMany({
      where: { id: { in: ids } },
      orderBy: [{ course: { title: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        courseId: true,
        course: { select: { title: true } },
        curriculumVersion: { select: { id: true, courseId: true, ownerGroupId: true } },
      },
    }),
    currentLearnerLinkTemplate(),
    // Their own links to these groups, in one query (only the groups listed above are shown).
    findInstructorLinks(viewer.id, ids),
  ]);
  const crmViewer = { id: viewer.id, role: viewer.role, grants: viewer.grants, organizationId: viewer.organization.id };
  return {
    template,
    groups: groups.map(({ curriculumVersion: version, ...group }) => {
      const link = links.get(group.id);
      return {
        ...group,
        canNote: canAddInstructorNotes(crmViewer, { courseId: group.courseId, groupIds: [group.id] }),
        link: link ? { token: link.token, expiresAt: link.expiresAt.toISOString() } : null,
        previewHref:
          version && canOpenGroupPreview(crmViewer, { id: group.id, courseId: group.courseId }, version)
            ? `/admin/courses/${group.courseId}/versions/${version.id}/preview?group=${group.id}`
            : null,
      };
    }),
  };
}
