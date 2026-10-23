import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { touchCourseAccessLink, validateCourseAccessToken, type AccessValidationResult } from '@/lib/course-access';
import { withOrgScope } from '@/lib/org-context';
import { prisma } from '@/lib/prisma';
import contentStyles from '@/components/content/content.module.css';
import courseStyles from '@/components/courses/courses.module.css';
import CourseAccessView, { AccessShell } from '../../components/CourseAccessView';
import { PRODUCT_NAME } from '@/lib/site';
import { serverExtensions } from '@/extensions/server';
import { publicInstructorNames } from '@/lib/group-instructors';
import IntlProvider from '@/i18n/IntlProvider';
import type { Locale } from '@/i18n/config';
import { claimPreviewLinkAction } from './actions';
import { learnerLocale } from '../../learner-locale';

type PageParams = Promise<{
  token: string;
}>;

async function getAccessPayload(token: string) {
  const access = await validateCourseAccessToken(token);

  if (access.state === 'invalid') {
    return access;
  }

  // Read in the link's organisation, whoever is signed in in this browser (a team member opening
  // a learner link of another organisation would otherwise find nothing).
  if (access.state === 'closed') {
    return withOrgScope(access.organizationId, () => loadClosedPayload(access.courseId));
  }
  return withOrgScope(access.organizationId, () => loadAccessPayload(access));
}

/** The organisation's learner pages have closed: only the course's language, for the page's words. */
async function loadClosedPayload(courseId: string) {
  const course = await prisma.course.findUnique({ select: { language: true }, where: { id: courseId } });
  return { state: 'closed' as const, language: course?.language ?? null };
}

async function loadAccessPayload(access: Exclude<AccessValidationResult, { state: 'invalid' | 'closed' }>) {
  const partnerSelect = {
    orderBy: {
      position: 'asc',
    },
    select: {
      partner: {
        select: {
          id: true,
          logoUrl: true,
          name: true,
          websiteUrl: true,
        },
      },
      partnerId: true,
      position: true,
    },
  } as const;

  const courseShellSelect = {
    organization: { select: { name: true } },
    // The language of the page, unless the learner picked their own.
    language: true,
    partners: partnerSelect,
    githubUrl: true,
    summary: true,
    title: true,
  } as const;

  /** Group partners override course partners; preview links (no group) use the course's. */
  const findGroupPartners = (groupId: string | null) =>
    groupId
      ? prisma.courseGroup.findUnique({
          where: {
            id: groupId,
          },
          select: {
            partners: partnerSelect,
          },
        })
      : Promise.resolve(null);

  if (access.state === 'unclaimed') {
    const course = await prisma.course.findUnique({
      select: courseShellSelect,
      where: {
        id: access.courseId,
      },
    });

    if (!course) {
      return {
        state: 'invalid' as const,
      };
    }

    return {
      course,
      endsAt: null,
      isPreview: true,
      partners: course.partners.map((entry) => entry.partner),
      slackHandle: null,
      startsAt: null,
      state: access.state,
      organizationId: access.organizationId,
    };
  }

  if (access.state === 'expired' || access.state === 'revoked' || access.state === 'used') {
    const [course, group] = await Promise.all([
      prisma.course.findUnique({
        select: courseShellSelect,
        where: {
          id: access.courseId,
        },
      }),
      findGroupPartners(access.groupId),
    ]);

    if (!course) {
      return {
        state: 'invalid' as const,
      };
    }

    return {
      course,
      endsAt: access.endsAt,
      isPreview: access.groupId === null,
      partners:
        group && group.partners.length > 0
          ? group.partners.map((entry) => entry.partner)
          : course.partners.map((entry) => entry.partner),
      slackHandle: access.slackHandle,
      startsAt: access.startsAt,
      state: access.state,
      organizationId: access.organizationId,
    };
  }

  if (access.state === 'valid') {
    const [course, group, arcs, instructors] = await Promise.all([
      prisma.course.findUnique({
        select: {
          ...courseShellSelect,
          lessons: {
            /**
             * Only lessons of the version this token serves ('' matches none). Learners see
             * published lessons only (in their published wording); draft preview links see all.
             */
            where: {
              curriculumVersionId: access.curriculumVersionId ?? '',
              ...(access.isPreview ? {} : { publishedAt: { not: null } }),
            },
            orderBy: {
              position: 'asc',
            },
            // Learners' requests never load the working copy (draft) fields at all.
            select: {
              arcId: true,
              id: true,
              position: true,
              shortDescription: access.isPreview,
              title: access.isPreview,
              publishedShortDescription: !access.isPreview,
              publishedTitle: !access.isPreview,
            },
          },
        },
        where: {
          id: access.courseId,
        },
      }),
      findGroupPartners(access.groupId),
      prisma.lessonArc.findMany({
        where: {
          curriculumVersionId: access.curriculumVersionId ?? '',
        },
        orderBy: {
          position: 'asc',
        },
        select: {
          id: true,
          title: true,
          description: true,
        },
      }),
      publicInstructorNames(access.groupId),
      // Alongside the reads, not before them.
      touchCourseAccessLink(access.accessLinkId),
    ]);

    if (!course) {
      return {
        state: 'invalid' as const,
      };
    }

    const lessons = course.lessons.map((lesson) => ({
      arcId: lesson.arcId,
      id: lesson.id,
      position: lesson.position,
      title: (access.isPreview ? lesson.title : lesson.publishedTitle) ?? '',
      shortDescription:
        (access.isPreview ? lesson.shortDescription : lesson.publishedShortDescription) ?? null,
    }));

    return {
      arcs,
      /** Personal (member-bound) and instructor links may leave comments; group links may not. */
      canComment: access.instructor != null || (access.memberId != null && access.memberName != null),
      /** An instructor link: whose it is (their marks are instructor notes). */
      instructorName: access.instructor?.name ?? null,
      /** Who teaches the group, as learners see them. */
      instructors,
      course: { ...course, lessons },
      endsAt: access.endsAt,
      expiresAt: access.expiresAt,
      groupId: access.groupId,
      isPreview: access.isPreview,
      partners:
        group && group.partners.length > 0
          ? group.partners.map((entry) => entry.partner)
          : course.partners.map((entry) => entry.partner),
      proposerName: access.memberName,
      slackHandle: access.slackHandle,
      startsAt: access.startsAt,
      state: 'valid' as const,
      organizationId: access.organizationId,
    };
  }

  return {
    state: 'invalid' as const,
  };
}

/** The tab's title: the course's, or "Access unavailable" (or "no longer available") in the learner's language. */
async function resolveAccessPageDocumentTitle(token: string): Promise<string> {
  const access = await validateCourseAccessToken(token);

  if (access.state === 'closed') {
    const language = (await withOrgScope(access.organizationId, () => loadClosedPayload(access.courseId))).language;
    const t = await getTranslations({ locale: await learnerLocale(language), namespace: 'learner.access' });
    return `${t('closedTitle')} | ${PRODUCT_NAME}`;
  }

  const course =
    access.state === 'invalid'
      ? null
      : await withOrgScope(access.organizationId, () =>
          prisma.course.findUnique({
            select: {
              title: true,
            },
            where: {
              id: access.courseId,
            },
          })
        );

  if (!course) {
    const t = await getTranslations({ locale: await learnerLocale(null), namespace: 'learner.access' });
    return `${t('unavailableTitle')} | ${PRODUCT_NAME}`;
  }

  return course.title;
}

export async function generateMetadata({
  params,
}: {
  params: PageParams;
}): Promise<Metadata> {
  const { token } = await params;
  const title = await resolveAccessPageDocumentTitle(token);
  return {
    robots: { index: false, follow: false },
    title: {
      absolute: title,
    },
  };
}

async function getRestrictedNotice(
  state: 'expired' | 'revoked' | 'used' | 'unclaimed',
  token: string,
  locale: Locale
) {
  const t = await getTranslations({ locale, namespace: 'learner.access' });

  if (state === 'unclaimed') {
    return {
      title: t('unclaimedTitle'),
      description: t('unclaimedDescription'),
      action: (
        <form action={claimPreviewLinkAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className={`${courseStyles.button} ${courseStyles.buttonPrimary}`}>
            {t('openPreview')}
          </button>
        </form>
      ),
    };
  }

  if (state === 'used') {
    return {
      title: t('usedTitle'),
      description: t('usedDescription'),
    };
  }

  /** Shown when the link is expired or revoked (course shell still visible above). */
  return {
    title: state === 'expired' ? t('expiredTitle') : t('revokedTitle'),
    description: t('restrictedDescription'),
  };
}

export default async function AccessPage({
  params,
}: {
  params: PageParams;
}) {
  const { token } = await params;
  const accessPayload = await getAccessPayload(token);
  // The learner's pick, else the course's language (read with the course above), else English.
  const locale = await learnerLocale(
    accessPayload.state === 'invalid' ? null : accessPayload.state === 'closed' ? accessPayload.language : accessPayload.course.language
  );
  const t = await getTranslations({ locale, namespace: 'learner' });

  // The organisation's learner pages have closed (its plan ended): nothing of the course, calmly.
  if (accessPayload.state === 'closed') {
    return (
      <IntlProvider locale={locale} namespaces={['common']}>
        <AccessShell locale={locale} languageMenu>
          <article className={contentStyles.article} data-testid="learner-closed">
            <h1>{t('access.closedTitle')}</h1>
            <p className={contentStyles.lead}>{t('access.closedDescription')}</p>
          </article>
        </AccessShell>
      </IntlProvider>
    );
  }

  if (accessPayload.state === 'invalid') {
    return (
      <IntlProvider locale={locale} namespaces={['common']}>
        <AccessShell locale={locale} languageMenu>
          <article className={contentStyles.article}>
            <h1>{t('access.unavailableTitle')}</h1>
            <p className={contentStyles.lead}>{t('access.unavailableDescription')}</p>
          </article>
        </AccessShell>
      </IntlProvider>
    );
  }

  const { course, isPreview, partners, slackHandle, startsAt, endsAt } = accessPayload;
  const isValid = accessPayload.state === 'valid';
  const lessons = isValid ? accessPayload.course.lessons : [];
  const arcs = isValid ? accessPayload.arcs : [];
  const instructorName = isValid ? accessPayload.instructorName : null;
  // Paused between classes (`isPaused`): every lesson reads as usual, and nothing is sent.
  const paused = isValid && !isPreview && (await serverExtensions.isPaused(accessPayload.organizationId));
  const linkCommenting = instructorName
    ? ({
        role: 'viewer' as const,
        token,
        proposerName: instructorName,
        feedbackCopy: {
          label: t('instructorNote.label'),
          placeholder: t('instructorNote.placeholder'),
          submit: t('instructorNote.submit'),
        },
      })
    : isValid && accessPayload.canComment && accessPayload.proposerName
      ? ({
          role: 'viewer' as const,
          token,
          proposerName: accessPayload.proposerName,
        })
      : null;
  const commenting = paused ? null : linkCommenting;
  // The edition's own on learner pages (`learnerSignals`): learners' personal links only, never an
  // instructor's.
  const signalsState =
    commenting && !isPreview && !instructorName
      ? await withOrgScope(accessPayload.organizationId, () => serverExtensions.learnerSignals(token))
      : null;

  return (
    <CourseAccessView
      locale={locale}
      languageMenu
      courseTitle={course.title}
      courseSummary={course.summary}
      githubUrl={course.githubUrl}
      partners={partners}
      lessons={lessons}
      arcs={arcs}
      source={isValid ? { kind: 'access', token } : undefined}
      commenting={commenting}
      preparedBy={course.organization.name}
      slackHandle={slackHandle}
      instructors={isValid ? accessPayload.instructors : []}
      startsAt={startsAt}
      endsAt={endsAt}
      eyebrow={isPreview ? t('access.draftPreview') : instructorName ? t('access.instructorView') : undefined}
      restrictedNotice={isValid ? null : await getRestrictedNotice(accessPayload.state, token, locale)}
      readOnlyNotice={paused ? { title: t('access.pausedTitle'), description: t('access.pausedDescription') } : null}
      learnerSignals={signalsState ? { token, state: signalsState } : null}
    />
  );
}
