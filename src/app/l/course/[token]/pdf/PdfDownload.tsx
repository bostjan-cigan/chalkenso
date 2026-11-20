'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import courseStyles from '@/components/courses/courses.module.css';
import type { ExportLesson } from '../../../components/pdf-export/export-data';
import PdfExportButton from '../../../components/pdf-export/PdfExportButton';

/** Makes the PDF as soon as the page opens; the button makes it again (or for a browser that held the first one back). */
export default function PdfDownload({
  token,
  courseTitle,
  author,
  lessons,
  whole,
}: {
  token: string;
  courseTitle: string;
  author: string | null;
  lessons: ExportLesson[];
  whole: boolean;
}) {
  const t = useTranslations('learner.lessons');
  const source = useMemo(() => ({ kind: 'access', token }) as const, [token]);
  return (
    <div className={courseStyles.actions}>
      <PdfExportButton source={source} courseTitle={courseTitle} author={author} lessons={lessons} whole={whole} label={t('exportCourse')} autoStart testId="pdf-download" />
    </div>
  );
}
