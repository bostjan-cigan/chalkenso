import { planBody } from './plan-scope';

/** A few words of a longer text, cut at a word. */
export function excerpt(text: string, max = 72) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,.;:]+$/, '')}…`;
}

/**
 * What to call an improvement where its lessons are already in view (the lesson's Improvements view,
 * an Improvements list row): its title, unless the title is just a lesson's name (what improvements
 * made from feedback start as, "Lesson 2: …"); then what its feedback asks, or its plan.
 */
export function improvementLabel(
  title: string,
  lessonTitles: string[],
  feedback?: string | null,
  plan?: string | null
): string {
  if (!lessonTitles.some((lessonTitle) => lessonTitle && title.includes(lessonTitle))) return title;
  if (feedback?.trim()) return excerpt(feedback);
  const body = planBody(plan);
  return body ? excerpt(body) : title;
}
