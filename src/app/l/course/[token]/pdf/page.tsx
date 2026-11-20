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
 * A lesson's PDF for a learner link, on a page of its own: `?lesson=<id>`. A website that shows the
 * course itself links here, so there is one exporter (the learner page's) and nothing of it on that
 * website. One lesson at a time, as on the learner page: a whole course at once is more than a
 * browser can be asked for. Only where PDF export is on for the link's lessons or group; anything
 * else reads as a link that doesn't exist.
 */

export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/** The course's name, who prepared it and the lesson, if it is one the link may read. */
async function loadExport(courseId: string, versionId: string, lessonId: string, isPreview: boolean) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      title: true,
      language: true,
      organization: { select: { name: true } },
      lessons: {
        // As on the learner page: published lessons in their published wording; a draft preview sees all.
        where: { id: lessonId, curriculumVersionId: versionId, ...(isPreview ? {} : { publishedAt: { not: null } }) },
        select: { id: true, position: true, title: isPreview, publishedTitle: !isPreview },
      },
    },
  });
  const lesson = course?.lessons[0];
  if (!course || !lesson) return null;
  const found: ExportLesson = { id: lesson.id, position: lesson.position, title: (isPreview ? lesson.title : lesson.publishedTitle) ?? '' };
  return { title: course.title, language: course.language, author: course.organization.name, lesson: found };
}

export default async function PdfPage({ params, searchParams }: Props) {
  const { token } = await params;
  const wanted = (await searchParams).lesson;
  const access = await validateCourseAccessToken(token);
  const versionId = access.state === 'valid' && access.pdfExport ? access.curriculumVersionId : null;
  // Read in the link's organisation, whoever is signed in in this browser.
  const course =
    access.state === 'valid' && versionId && typeof wanted === 'string' && wanted
      ? await withOrgScope(access.organizationId, () => loadExport(access.courseId, versionId, wanted, access.isPreview))
      : null;
  const locale = await learnerLocale(course?.language);

  if (!course) {
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
          <h1>{course.lesson.title}</h1>
          <PdfDownload token={token} courseTitle={course.title} author={course.author} lesson={course.lesson} />
        </article>
      </AccessShell>
    </IntlProvider>
  );
}
