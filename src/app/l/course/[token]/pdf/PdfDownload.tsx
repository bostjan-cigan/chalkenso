'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../../../access.module.css';
import { exportLessonsPdf, type ExportLesson } from '../../../components/pdf-export/export-data';
import PdfExportButton from '../../../components/pdf-export/PdfExportButton';
import { useExportProgress } from '../../../components/pdf-export/use-export-progress';

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
  const [working, setWorking] = useState(true);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const { percent, step, stop } = useExportProgress();

  const download = useCallback(async () => {
    setWorking(true);
    setFailed(false);
    try {
      await exportLessonsPdf({ kind: 'access', token }, { courseTitle, author, whole }, lessons, {}, step);
    } catch (error) {
      console.error(error);
      setFailed(true);
    } finally {
      setWorking(false);
      stop();
    }
  }, [token, courseTitle, author, lessons, whole, step, stop]);

  useEffect(() => {
    // Once, also where React runs effects twice.
    if (started.current) return;
    started.current = true;
    void download();
  }, [download]);

  return (
    <div>
      <PdfExportButton
        label={t('exportCourse')}
        working={t('exporting')}
        percent={working ? (percent ?? 0) : null}
        disabled={working}
        onClick={() => void download()}
        testId="pdf-download"
      />
      {failed ? <p className={styles.lessonError}>{t('exportError')}</p> : null}
    </div>
  );
}
