import { buildLessonRequest, type LessonSource } from '../lesson-source';

/** A lesson to export: what the outline knows about it. */
export type ExportLesson = {
  id: string;
  position: number;
  title: string;
};

/**
 * What a PDF holds: one lesson. Never a whole course: laying out many lessons at once is more than
 * a browser can be asked for.
 */
export type ExportDocument = {
  courseTitle: string;
  /** Who prepared the course (the organisation): above the title, in every page's footer and in the file's details. */
  author: string | null;
  lesson: ExportLesson & { html: string };
};

/** One lesson's rendered HTML, as the reader may see it (the same request that opens it on the page). */
export async function fetchLessonHtml(source: LessonSource, lessonId: string): Promise<string> {
  const request = buildLessonRequest(source, lessonId);
  const response = await fetch(request.url, {
    cache: 'no-store',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    throw new Error('Unable to load lesson content.');
  }
  const payload = (await response.json()) as { lesson?: { html: string } };
  if (!payload.lesson?.html) {
    throw new Error('Lesson content is unavailable.');
  }
  return payload.lesson.html;
}

/**
 * An image of a lesson, as bytes the export can read: through this site (the lesson's own images;
 * the file storage's address can't be read from a page), else straight from where it is (an image
 * from elsewhere, where that site allows it). Null when it can't be read.
 */
export async function fetchLessonImage(source: LessonSource, lessonId: string, src: string): Promise<Blob | null> {
  const request = buildLessonRequest(source, lessonId);
  try {
    const own = await fetch(`${request.url}-image`, {
      cache: 'no-store',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request.body, src }),
    });
    if (own.ok) return await own.blob();
    const direct = await fetch(src, { cache: 'no-store' });
    return direct.ok ? await direct.blob() : null;
  } catch {
    return null;
  }
}

/**
 * The whole export, from the lesson to the downloaded file. `step(reached, next)` says how far it is
 * in percent, and how far it may creep until the next call: the lesson's text to 40, the PDF library
 * to 45, images to 65, and the rest for laying the PDF out, which reports nothing until it is done.
 * `knownHtml` is the lesson's text when the page already has it.
 */
export async function exportLessonPdf(
  source: LessonSource,
  doc: Omit<ExportDocument, 'lesson'>,
  lesson: ExportLesson,
  knownHtml: string | undefined,
  step: (reached: number, next: number) => void
) {
  step(0, 35);
  const html = knownHtml ?? (await fetchLessonHtml(source, lesson.id));
  step(40, 45);
  // The PDF library is only loaded for someone who exports.
  const { downloadLessonPdf } = await import('./file-export');
  step(45, 48);
  await downloadLessonPdf({ ...doc, lesson: { ...lesson, html } }, source, step);
  step(100, 100);
}

/** "Course – 03 Lesson": the PDF's name. */
export function exportName(doc: ExportDocument) {
  return `${doc.courseTitle} – ${lessonNumber(doc.lesson.position)} ${doc.lesson.title}`;
}

export function lessonNumber(position: number) {
  return String(position).padStart(2, '0');
}
