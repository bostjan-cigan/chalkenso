import type { FeedbackRow } from '@/lib/feedback-list';

/** A feedback row as the list shows it to this viewer: where its lesson opens, and where to fix it. */
export type FeedbackItemView = FeedbackRow & {
  /** The lesson in the editor (or the read-only lessons when they can't edit them); null: neither. */
  lessonHref: string | null;
  /** The lesson's Improvements view (its improvements are worked on there); null when they can't edit the lesson. */
  improvementsHref: string | null;
  /** "group copy" when a list that mixes the course's lessons and copies shows one on a copy. */
  copyLabel: string | null;
};

/** Which part of a feedback list is shown (`?show=`): open feedback, the changes being made, or done. */
export type FeedbackShow = 'open' | 'change' | 'done';

export function feedbackShow(value: string | undefined): FeedbackShow {
  return value === 'change' || value === 'done' ? value : 'open';
}
