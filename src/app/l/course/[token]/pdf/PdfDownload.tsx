'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FiDownload } from 'react-icons/fi';
import styles from '../../../access.module.css';
import { loadLessons, type ExportLesson } from '../../../components/pdf-export/export-data';

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

  const download = useCallback(async () => {
    setWorking(true);
    setFailed(false);
    try {
      const doc = { courseTitle, author, whole, lessons: await loadLessons({ kind: 'access', token }, lessons, {}) };
      await (await import('../../../components/pdf-export/file-export')).downloadLessonsPdf(doc);
    } catch (error) {
      console.error(error);
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }, [token, courseTitle, author, lessons, whole]);

  useEffect(() => {
    // Once, also where React runs effects twice.
    if (started.current) return;
    started.current = true;
    void download();
  }, [download]);

  return (
    <div>
      <button type="button" className={styles.exportButton} disabled={working} onClick={() => void download()} data-testid="pdf-download">
        <FiDownload aria-hidden /> {working ? t('exporting') : t('exportCourse')}
      </button>
      {failed ? <p className={styles.lessonError}>{t('exportError')}</p> : null}
    </div>
  );
}
