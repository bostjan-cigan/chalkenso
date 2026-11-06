/**
 * Working through a course's (or a group copy's) lessons one after another: the lessons whose
 * changes wait for review or are being written, and those just published in this pass, in lesson
 * order. Where the lesson open now is among them ("Lesson 3 of 8"), and which to go to next: the next
 * one waiting for review after it (round the end), else the next one still being written. Pure
 * (unit-tested in tests/e2e/unit-review-queue.mjs).
 */

export type QueueLesson = { lessonId: string; position: number; title: string; taskId: string | null; state: 'review' | 'writing' | 'done' };

export type QueuePlace = {
  /** Where this lesson is, counted from 1; null when it isn't in the queue. */
  at: number | null;
  total: number;
  next: QueueLesson | null;
  /** Lessons still waiting for review or being written (not this one). */
  left: number;
};

export function queueOf(items: QueueLesson[], currentId: string): QueuePlace {
  const lessons = [...items].sort((a, b) => a.position - b.position);
  const index = lessons.findIndex((lesson) => lesson.lessonId === currentId);
  const after = index === -1 ? lessons : [...lessons.slice(index + 1), ...lessons.slice(0, index)];
  const others = after.filter((lesson) => lesson.lessonId !== currentId);
  const next = others.find((lesson) => lesson.state === 'review') ?? others.find((lesson) => lesson.state === 'writing') ?? null;
  return {
    at: index === -1 ? null : index + 1,
    total: lessons.length,
    next,
    left: others.filter((lesson) => lesson.state !== 'done').length,
  };
}
