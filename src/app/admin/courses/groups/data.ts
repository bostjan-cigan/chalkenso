import 'server-only';

import { Prisma } from '@prisma/client';
import { getLocale, getTranslations } from 'next-intl/server';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { prisma } from '@/lib/prisma';

/** Courses a group can be in; `where` limits them to the ones the viewer can edit. */
export async function listCoursesForGroupForm(where: Prisma.CourseWhereInput = {}) {
  return prisma.course.findMany({
    where,
    orderBy: {
      title: 'asc',
    },
    select: {
      id: true,
      slug: true,
      title: true,
    },
  });
}

export type GroupFormVersionOption = {
  id: string;
  label: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
};

/** All course versions keyed by course id, for the group form's version selector. */
export async function listVersionsByCourseForGroupForm(
  courseWhere: Prisma.CourseWhereInput = {}
): Promise<Record<string, GroupFormVersionOption[]>> {
  // Groups are assigned core versions; a group's own curriculum is managed from its page.
  const versions = await prisma.curriculumVersion.findMany({
    where: { ownerGroupId: null, course: courseWhere },
    orderBy: {
      version: 'asc',
    },
    select: {
      courseId: true,
      id: true,
      label: true,
      status: true,
      version: true,
    },
  });

  return versions.reduce<Record<string, GroupFormVersionOption[]>>((byCourse, version) => {
    const list = byCourse[version.courseId] ?? [];
    list.push({
      id: version.id,
      label: version.label,
      status: version.status,
      version: version.version,
    });
    byCourse[version.courseId] = list;
    return byCourse;
  }, {});
}

export async function listPartnersForGroupForm() {
  return prisma.partner.findMany({
    orderBy: {
      name: 'asc',
    },
    select: {
      id: true,
      name: true,
    },
  });
}

/**
 * Groups for the directory, in one query; `where` limits it to the groups the viewer may see
 * (`groupScopeWhere`).
 */
export async function listGroupsForIndex(where: Prisma.CourseGroupWhereInput = {}) {
  const groups = await prisma.courseGroup.findMany({
    where,
    orderBy: [{ course: { title: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      feedbackDriven: true,
      startsAt: true,
      endsAt: true,
      course: { select: { id: true, title: true } },
      curriculumVersion: { select: { label: true, ownerGroupId: true } },
      groupCurriculum: { select: { id: true, archivedAt: true, baseVersion: { select: { label: true } } } },
      _count: { select: { members: true } },
    },
  });

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    feedbackDriven: group.feedbackDriven,
    startsAt: group.startsAt,
    endsAt: group.endsAt,
    /** Its own copy of the lessons (and whether it is closed), or the course version it reads. */
    ownCopy: group.groupCurriculum
      ? {
          id: group.groupCurriculum.id,
          closed: group.groupCurriculum.archivedAt !== null,
          from: group.groupCurriculum.baseVersion?.label ?? null,
        }
      : null,
    readsVersion: group.curriculumVersion && !group.curriculumVersion.ownerGroupId ? group.curriculumVersion.label : null,
    course: group.course,
    memberCount: group._count.members,
  }));
}

export async function getGroupDetail(groupId: string) {
  const now = new Date();

  return prisma.courseGroup.findUnique({
    where: {
      id: groupId,
    },
    select: {
      accessLinks: {
        where: {
          expiresAt: {
            gt: now,
          },
          // The group's own link, not instructors' links (src/lib/instructor-links.ts).
          instructorUserId: null,
          revokedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          createdAt: true,
          expiresAt: true,
          id: true,
          lastAccessedAt: true,
          token: true,
        },
        take: 1,
      },
      course: {
        select: {
          id: true,
          slug: true,
          title: true,
        },
      },
      curriculumVersionId: true,
      curriculumVersion: {
        select: { id: true, label: true, status: true, ownerGroupId: true },
      },
      feedbackDriven: true,
      groupCurriculum: {
        select: {
          id: true,
          label: true,
          archivedAt: true,
          createdAt: true,
          baseVersion: { select: { id: true, label: true } },
          _count: { select: { lessons: true } },
        },
      },
      description: true,
      id: true,
      members: {
        orderBy: {
          position: 'asc',
        },
        select: {
          accessLinks: {
            where: {
              expiresAt: {
                gt: now,
              },
              revokedAt: null,
            },
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              createdAt: true,
              expiresAt: true,
              id: true,
              lastAccessedAt: true,
              token: true,
            },
            take: 1,
          },
          fullName: true,
          id: true,
          position: true,
        },
      },
      name: true,
      partners: {
        orderBy: {
          position: 'asc',
        },
        select: {
          partnerId: true,
        },
      },
      slackHandle: true,
      slug: true,
      sourceRosterText: true,
      startsAt: true,
      endsAt: true,
      updatedAt: true,
    },
  });
}


/** When a group runs, from its dates (and whether its copy of the lessons is closed). */
export type GroupRunState = 'running' | 'upcoming' | 'finished' | 'undated';

export function groupRunState(
  group: { startsAt: Date | null; endsAt: Date | null; ownCopy?: { closed: boolean } | null },
  now: Date = new Date()
): GroupRunState {
  if (group.ownCopy?.closed) return 'finished';
  if (group.endsAt && group.endsAt < now) return 'finished';
  if (group.startsAt && group.startsAt > now) return 'upcoming';
  if (group.startsAt || group.endsAt) return 'running';
  return 'undated';
}

/** The language of a group's dates, and the words around a date on its own ("from …", "until …"). */
type DateWords = { locale: Locale; from: (date: string) => string; until: (date: string) => string };

const ENGLISH_DATES: DateWords = { locale: 'en', from: (date) => `from ${date}`, until: (date) => `until ${date}` };

/**
 * "23 Sep – 12 Nov 2026", "from 23 Sep 2026", "until 12 Nov 2026", or null. English unless `words`
 * says otherwise (`groupRowWords` gives the request's language).
 */
export function groupDates(startsAt: Date | null, endsAt: Date | null, words: DateWords = ENGLISH_DATES): string | null {
  const intlLocale = INTL_LOCALES[words.locale];
  const dayMonth = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short' });
  const dayMonthYear = new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', year: 'numeric' });
  if (startsAt && endsAt) {
    const sameYear = startsAt.getFullYear() === endsAt.getFullYear();
    return `${(sameYear ? dayMonth : dayMonthYear).format(startsAt)} – ${dayMonthYear.format(endsAt)}`;
  }
  if (startsAt) return words.from(dayMonthYear.format(startsAt));
  if (endsAt) return words.until(dayMonthYear.format(endsAt));
  return null;
}

/**
 * What a group's row says (the groups list, a course's Groups tab, its page), in the request's
 * language: its dates, the lessons it reads ("Own copy of v1", "Reads v1"), and names in a sentence
 * ("Ana, Bo and Cene").
 */
export async function groupRowWords() {
  const [locale, t] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('groups.row')]);
  const dateWords: DateWords = {
    locale,
    from: (date) => t('from', { date }),
    until: (date) => t('until', { date }),
  };
  const nameList = new Intl.ListFormat(INTL_LOCALES[locale], { type: 'conjunction' });
  return {
    locale,
    dates: (startsAt: Date | null, endsAt: Date | null) => groupDates(startsAt, endsAt, dateWords),
    lessons: (group: { ownCopy: { from: string | null } | null; readsVersion: string | null }) =>
      group.ownCopy
        ? group.ownCopy.from
          ? t('ownCopyOf', { version: group.ownCopy.from })
          : t('ownCopy')
        : group.readsVersion
          ? t('reads', { version: group.readsVersion })
          : null,
    names: (names: string[]) => nameList.format(names),
  };
}
