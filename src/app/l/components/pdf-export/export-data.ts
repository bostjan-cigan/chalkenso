import { buildLessonRequest, type LessonSource } from '../lesson-source';

/** A lesson to export: what the outline knows about it. */
export type ExportLesson = {
  id: string;
  position: number;
  title: string;
  /** The section it opens (set on a section's first lesson when the whole course is exported). */
  arcTitle?: string | null;
};

export type LoadedLesson = ExportLesson & { html: string };

/** What a PDF holds: one lesson, or the whole course (a title page with its contents, then every lesson). */
export type ExportDocument = {
  courseTitle: string;
  /** Who prepared the course (the organisation): on the title page, in every page's footer and in the file's details. */
  author: string | null;
  whole: boolean;
  lessons: LoadedLesson[];
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

/** The lessons with their text, a few at a time, in order; `known` are the ones already open on the page. */
export async function loadLessons(
  source: LessonSource,
  lessons: ExportLesson[],
  known: Record<string, string | undefined>,
  /** Called as each lesson arrives, with how many have. */
  onLoaded?: (done: number, total: number) => void
): Promise<LoadedLesson[]> {
  const loaded = new Array<LoadedLesson>(lessons.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < lessons.length) {
      const index = next;
      next += 1;
      const lesson = lessons[index];
      loaded[index] = { ...lesson, html: known[lesson.id] ?? (await fetchLessonHtml(source, lesson.id)) };
      done += 1;
      onLoaded?.(done, lessons.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, lessons.length) }, worker));
  return loaded;
}

/**
 * The whole export, from the outline's lessons to the downloaded file. `step(reached, next)` says how
 * far it is in percent, and how far it may creep until the next call: lessons to 40, the PDF library
 * to 45, images to 65, and the rest for laying the PDF out, which reports nothing until it is done.
 */
export async function exportLessonsPdf(
  source: LessonSource,
  doc: Omit<ExportDocument, 'lessons'>,
  lessons: ExportLesson[],
  known: Record<string, string | undefined>,
  step: (reached: number, next: number) => void
) {
  step(0, 5);
  const loaded = await loadLessons(source, lessons, known, (done, total) => step((40 * done) / total, (40 * Math.min(total, done + 1)) / total));
  step(40, 45);
  // The PDF library is only loaded for someone who exports.
  const { downloadLessonsPdf } = await import('./file-export');
  step(45, 48);
  await downloadLessonsPdf({ ...doc, lessons: loaded }, source, step);
  step(100, 100);
}

/** "Course" or "Course – 03 Lesson": the PDF's name. */
export function exportName(doc: ExportDocument) {
  const only = doc.whole ? null : doc.lessons[0];
  return only ? `${doc.courseTitle} – ${lessonNumber(only.position)} ${only.title}` : doc.courseTitle;
}

export function lessonNumber(position: number) {
  return String(position).padStart(2, '0');
}
