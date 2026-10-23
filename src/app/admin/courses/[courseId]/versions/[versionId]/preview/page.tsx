import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Permission } from '@prisma/client';
import { canOnCourse, canOnGroup, canOpenPreview, instructorNoteContext, loadVersionRef, requireCrmAccess } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { displayName, getCurrentUserSession } from '@/lib/admin-auth';
import CourseAccessView from '@/app/l/components/CourseAccessView';
import { getVersionForAttendeePreview } from '@/app/admin/courses/versions/data';

type PageParams = Promise<{
  courseId: string;
  versionId: string;
}>;

/** `?group=`: opened for one group (an instructor reading the lessons their group uses). */
type SearchParams = Promise<{ group?: string }>;

/** Admin-only preview; never indexed. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Renders a curriculum version exactly as a learner sees it (same layout, lazy lesson loading),
 * for the team, in the app's language. Team members annotate it while they teach: select a passage to add an instructor
 * note (shared with the team, shows up in Feedback and in AI plans) or a private note. Learner
 * feedback on the lesson shows in the margin too, for those who may read it. A guest instructor
 * reads the lessons their group reads here, with the group's instructor notes, and nothing else.
 */
export default async function VersionPreviewPage({ params, searchParams }: { params: PageParams; searchParams: SearchParams }) {
  const [{ courseId, versionId }, search] = await Promise.all([params, searchParams]);
  // Read-only: the Courses section, READ on this version (core or group curriculum), or a guest
  // instructor of a group that reads it.
  const versionRef = await loadVersionRef(versionId);
  const viewer = await requireCrmAccess(async (candidate) =>
    Boolean(versionRef && versionRef.courseId === courseId && (await canOpenPreview(candidate, versionRef)))
  );
  // Opened for a group: the group's partners when it lists its own (as its learners see them).
  const groupId = search.group?.trim() || versionRef?.ownerGroupId || null;
  // Side by side: where notes go (the course's feedback, or the group's when opened for one; only
  // for those who may work on it), the lessons, and the group.
  const [noteContext, version, found] = await Promise.all([
    versionRef ? instructorNoteContext(viewer, versionRef, search.group?.trim() || null) : { ok: false, groupId: null },
    getVersionForAttendeePreview(courseId, versionId),
    groupId
      ? prisma.courseGroup.findFirst({
          where: { id: groupId, courseId },
          select: {
            id: true,
            name: true,
            partners: {
              orderBy: { position: 'asc' },
              select: { partner: { select: { id: true, name: true, logoUrl: true, websiteUrl: true } } },
            },
          },
        })
      : null,
  ]);

  if (!version) {
    notFound();
  }
  // Only a group the viewer may see: theirs (READ, or a guest's NOTES), never another group's name.
  const group =
    found && [[Permission.READ], [Permission.NOTES]].some((permissions) => canOnGroup(viewer, { id: found.id, courseId }, permissions))
      ? found
      : null;

  const partners =
    group && group.partners.length > 0
      ? group.partners.map((entry) => entry.partner)
      : version.course.partners.map((entry) => entry.partner);
  const [session, locale] = await Promise.all([getCurrentUserSession(), getLocale()]);
  const [t, tNote] = await Promise.all([
    getTranslations({ locale, namespace: 'courses.preview' }),
    getTranslations({ locale, namespace: 'learner.instructorNote' }),
  ]);
  const back = group && canOnGroup(viewer, { id: group.id, courseId }, [Permission.READ])
    ? { href: `/admin/courses/groups/${group.id}`, label: t('backTo', { name: group.name }) }
    : canOnCourse(viewer, courseId, [Permission.READ])
      ? { href: `/admin/courses/${courseId}`, label: t('backTo', { name: version.course.title }) }
      : { href: '/admin', label: t('backHome') };

  return (
    <CourseAccessView
      locale={locale}
      courseTitle={version.course.title}
      courseSummary={version.course.summary}
      githubUrl={version.course.githubUrl}
      partners={partners}
      lessons={version.lessons}
      arcs={version.arcs}
      source={{ courseId, kind: 'preview', versionId }}
      eyebrow={group ? t('eyebrowGroup', { name: group.name }) : t('eyebrow')}
      back={back}
      preparedBy={session?.user.organization?.name ?? null}
      commenting={
        session
          ? {
              role: 'viewer',
              token: noteContext.groupId ? `group:${noteContext.groupId}` : versionId,
              canComment: noteContext.ok,
              proposerName: displayName(session.user),
              api: { comment: '/api/team/comment', note: '/api/team/note' },
              feedbackCopy: { label: tNote('label'), placeholder: tNote('placeholder'), submit: tNote('submit') },
            }
          : null
      }
    />
  );
}
