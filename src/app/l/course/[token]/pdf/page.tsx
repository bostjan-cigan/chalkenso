import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import contentStyles from '@/components/content/content.module.css';
import IntlProvider from '@/i18n/IntlProvider';
import { validateCourseAccessToken } from '@/lib/course-access';
import { withOrgScope } from '@/lib/org-context';
import { prisma } from '@/lib/prisma';
import { AccessShell } from '../../../components/CourseAccessView';
import type { ExportLesson } from '../../../components/pdf-export/export-data';
import { learnerLocale } from '../../../learner-locale';
import PdfDownload from './PdfDownload';

/**
 * A learner link's PDF, on a page of its own: the whole course, or one lesson with `?lesson=<id>`.
 * A website that shows the course itself links here, so there is one exporter (the learner page's)
 * and nothing of it on that website. Only where PDF export is on for the link's lessons or group;
 * anything else reads as a link that doesn't exist.
 */

export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/** The course's name, who prepared it and its lessons in the outline's order, each section named on its first lesson. */
async function loadExport(courseId: string, versionId: string, isPreview: boolean) {
  const [course, arcs] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        title: true,
        language: true,
        organization: { select: { name: true } },
        lessons: {
          // As on the learner page: published lessons in their published wording; a draft preview sees all.
          where: { curriculumVersionId: versionId, ...(isPreview ? {} : { publishedAt: { not: null } }) },
          orderBy: { position: 'asc' },
          select: { id: true, arcId: true, position: true, title: isPreview, publishedTitle: !isPreview },
        },
      },
    }),
    prisma.lessonArc.findMany({ where: { curriculumVersionId: versionId }, orderBy: { position: 'asc' }, select: { id: true, title: true } }),
  ]);
  if (!course) return null;
  const plain = (lesson: (typeof course.lessons)[number]): ExportLesson => ({
    id: lesson.id,
    position: lesson.position,
    title: (isPreview ? lesson.title : lesson.publishedTitle) ?? '',
  });
  const lessons: ExportLesson[] = [
    ...course.lessons.filter((lesson) => !lesson.arcId).map(plain),
    ...arcs.flatMap((arc) =>
      course.lessons.filter((lesson) => lesson.arcId === arc.id).map((lesson, index) => ({ ...plain(lesson), arcTitle: index === 0 ? arc.title : null }))
    ),
  ];
  return { title: course.title, language: course.language, author: course.organization.name, lessons };
}

export default async function PdfPage({ params, searchParams }: Props) {
  const { token } = await params;
  const wanted = (await searchParams).lesson;
  const access = await validateCourseAccessToken(token);
  const versionId = access.state === 'valid' && access.pdfExport ? access.curriculumVersionId : null;
  // Read in the link's organisation, whoever is signed in in this browser.
  const course =
    access.state === 'valid' && versionId ? await withOrgScope(access.organizationId, () => loadExport(access.courseId, versionId, access.isPreview)) : null;
  const only = typeof wanted === 'string' ? (course?.lessons.find((lesson) => lesson.id === wanted) ?? null) : null;
  const locale = await learnerLocale(course?.language);

  if (!course || course.lessons.length === 0 || (wanted !== undefined && !only)) {
    const t = await getTranslations({ locale, namespace: 'learner.access' });
    return (
      <IntlProvider locale={locale} namespaces={['common']}>
        <AccessShell locale={locale}>
          <article className={contentStyles.article} data-testid="pdf-unavailable">
            <h1>{t('unavailableTitle')}</h1>
            <p className={contentStyles.lead}>{t('unavailableDescription')}</p>
          </article>
        </AccessShell>
      </IntlProvider>
    );
  }

  return (
    <IntlProvider locale={locale} namespaces={['common', 'learner.lessons']}>
      <AccessShell locale={locale}>
        <article className={contentStyles.article}>
          <h1>{only ? only.title : course.title}</h1>
          <PdfDownload token={token} courseTitle={course.title} author={course.author} lessons={only ? [{ ...only, arcTitle: null }] : course.lessons} whole={!only} />
        </article>
      </AccessShell>
    </IntlProvider>
  );
}
