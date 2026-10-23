import type { getTranslations } from 'next-intl/server';

/** The words inside the export (README.txt, CSV headings and values), in the reader's language. */
export type ExportWords = Awaited<ReturnType<typeof getTranslations<'account.export.file'>>>;

/** The Feedback tab's CSV words, which the export's feedback file shares. */
export type FeedbackWords = Awaited<ReturnType<typeof getTranslations<'courses.feedbackExport'>>>;
