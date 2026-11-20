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

/** The lessons with their text, a few at a time, in order; `known` are the ones already open on the page. */
export async function loadLessons(source: LessonSource, lessons: ExportLesson[], known: Record<string, string | undefined>): Promise<LoadedLesson[]> {
  const loaded = new Array<LoadedLesson>(lessons.length);
  let next = 0;
  const worker = async () => {
    while (next < lessons.length) {
      const index = next;
      next += 1;
      const lesson = lessons[index];
      loaded[index] = { ...lesson, html: known[lesson.id] ?? (await fetchLessonHtml(source, lesson.id)) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, lessons.length) }, worker));
  return loaded;
}

/** "Course" or "Course – 03 Lesson": the PDF's name. */
export function exportName(doc: ExportDocument) {
  const only = doc.whole ? null : doc.lessons[0];
  return only ? `${doc.courseTitle} – ${lessonNumber(only.position)} ${only.title}` : doc.courseTitle;
}

export function lessonNumber(position: number) {
  return String(position).padStart(2, '0');
}
