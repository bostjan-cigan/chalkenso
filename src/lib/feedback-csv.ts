import type { useTranslations } from 'next-intl';
import type { CsvCell } from './csv';
import type { FeedbackRow } from './feedback-list';

/**
 * Feedback as CSV rows: the Feedback tab's download (`/admin/api/feedback-export`) and the
 * feedback file of "Export everything" write the same columns. Learners stay unnamed ("A learner ·
 * <group>"), as in the app. Headings and labels in the reader's language (`courses.feedbackExport`).
 */

export type FeedbackCsvWords = ReturnType<typeof useTranslations<'courses.feedbackExport'>>;

/** The columns, in order (their headings: `courses.feedbackExport.columns`). */
export const FEEDBACK_COLUMNS = [
  'date',
  'course',
  'lessons',
  'lesson',
  'group',
  'from',
  'kind',
  'passage',
  'feedback',
  'status',
  'reply',
  'task',
  'taskStatus',
] as const;

/** A day as 2026-10-18 (UTC), the way spreadsheets sort it. */
export const csvDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });

export function feedbackCsvHeader(t: FeedbackCsvWords): string[] {
  return FEEDBACK_COLUMNS.map((column) => t(`columns.${column}`));
}

export function feedbackCsvRow(row: FeedbackRow, t: FeedbackCsvWords): CsvCell[] {
  return [
    csvDay.format(new Date(row.createdAt)),
    row.courseTitle,
    row.copyOfGroupId
      ? row.groupName
        ? t('groupCopy', { group: row.groupName, version: row.versionLabel })
        : t('groupCopyUnnamed', { version: row.versionLabel })
      : t('ownLessons', { version: row.versionLabel }),
    `${row.lessonPosition}. ${row.lessonTitle}`,
    row.groupName,
    row.proposerName,
    row.isInstructorNote ? t('kind.note') : t('kind.learner'),
    row.selectedText,
    row.body,
    t(`stage.${row.stage}`),
    row.adminResponse,
    row.task?.title ?? null,
    row.task ? t(`taskStatus.${row.task.status}`) : null,
  ];
}
