'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { TbFileTypePdf } from 'react-icons/tb';
import courseStyles from '@/components/courses/courses.module.css';
import styles from '../../access.module.css';
import type { LessonSource } from '../lesson-source';
import { exportLessonPdf, type ExportLesson } from './export-data';
import { useExportProgress } from './use-export-progress';

/**
 * Saves a lesson as a PDF: the page's own button (as the course's code link beside it), which while
 * the PDF is made says "Exporting…" and fills up behind the words, as far as the export is.
 */
export default function PdfExportButton({
  source,
  courseTitle,
  author,
  lesson,
  label,
  knownHtml,
  autoStart = false,
  testId,
}: {
  source: LessonSource;
  courseTitle: string;
  author: string | null;
  lesson: ExportLesson;
  label: string;
  /** The lesson's text, when the page already has it. */
  knownHtml?: () => string | undefined;
  /** Start as the page opens (the PDF page of a link); the button then makes it again. */
  autoStart?: boolean;
  testId: string;
}) {
  const t = useTranslations('learner.lessons');
  const [working, setWorking] = useState(autoStart);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const { percent, step, stop } = useExportProgress();

  const save = useCallback(async () => {
    setWorking(true);
    setFailed(false);
    try {
      await exportLessonPdf(source, { courseTitle, author }, lesson, knownHtml?.(), step);
    } catch (error) {
      console.error(error);
      setFailed(true);
    } finally {
      setWorking(false);
      stop();
    }
  }, [source, courseTitle, author, lesson, knownHtml, step, stop]);

  useEffect(() => {
    // Once, also where React runs effects twice.
    if (!autoStart || started.current) return;
    started.current = true;
    void save();
  }, [autoStart, save]);

  return (
    <>
      <button
        type="button"
        className={`${courseStyles.button} ${working ? styles.exportBusy : ''}`}
        style={working ? ({ '--export-progress': `${percent ?? 0}%` } as CSSProperties) : undefined}
        disabled={working}
        aria-busy={working}
        // How far it is shows as the fill only: said as a number for a screen reader.
        aria-label={working ? `${t('exporting')} ${percent ?? 0}%` : undefined}
        onClick={() => void save()}
        data-testid={testId}
      >
        <TbFileTypePdf aria-hidden size={18} />
        {working ? t('exporting') : label}
      </button>
      {failed ? <p className={styles.exportError}>{t('exportError')}</p> : null}
    </>
  );
}
