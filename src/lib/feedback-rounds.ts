/**
 * The rules of one improvement per lesson that need no database, so they're unit-tested
 * (tests/e2e/unit-feedback-rounds.mjs): which open improvement is the lesson's, what feedback joined
 * after its plan was written, and what feedback its drafts were written for (the rest waits for the
 * next improvement). The database side is `lesson-improvement.ts`.
 */

/** Feedback an improvement uses, with when it joined. */
export type JoinedFeedback = { id: string; linkedAt: Date };

/** An open improvement about a lesson, as far as choosing the lesson's one goes. */
export type ImprovementCandidate = {
  id: string;
  /** Its lesson links: lesson ids and their roles ("subject", or "brief" for a lesson brief). */
  lessons: Array<{ lessonId: string; role: string }>;
  /** A change for it is saved on this lesson already. */
  saved: boolean;
  /** Changes for it are being drafted, or wait for review. */
  drafted: boolean;
};

/**
 * The lesson's open improvement among candidates in the order they were made: about this lesson
 * only (not a brief, not several lessons), not saved on it yet; of several (an earlier way of
 * working left them), the first without changes drafted, else the first. Null when none.
 */
export function pickLessonImprovement(lessonId: string, candidates: ImprovementCandidate[]): string | null {
  const open = candidates.filter(
    (candidate) => !candidate.saved && candidate.lessons.length > 0 && candidate.lessons.every((link) => link.lessonId === lessonId && link.role === 'subject')
  );
  return (open.find((candidate) => !candidate.drafted) ?? open[0])?.id ?? null;
}

/** Feedback that joined after the plan was written (none without a plan). */
export function feedbackSincePlan(plan: string | null | undefined, planUpdatedAt: Date | null | undefined, feedback: JoinedFeedback[]): string[] {
  if (!plan?.trim() || !planUpdatedAt) return [];
  return feedback.filter((one) => one.linkedAt > planUpdatedAt).map((one) => one.id);
}

/** A draft that went into a save: the feedback it says it was written for (null: it doesn't say), and when it was started. */
export type SavedDraft = { noteIds: unknown; createdAt: Date };

/**
 * Of an improvement's feedback on a lesson, what a save answers and what came later: changes made by
 * hand cover it all; drafts cover the feedback they were written for (one that doesn't say, e.g.
 * from someone's Claude, covers what had joined when it was started). The rest waits for the next
 * improvement.
 */
export function coveredFeedback(feedback: JoinedFeedback[], drafts: SavedDraft[]): { covered: string[]; later: string[] } {
  const covers = (one: JoinedFeedback) =>
    !drafts.length || drafts.some((draft) => (Array.isArray(draft.noteIds) ? draft.noteIds.includes(one.id) : one.linkedAt <= draft.createdAt));
  return { covered: feedback.filter(covers).map((one) => one.id), later: feedback.filter((one) => !covers(one)).map((one) => one.id) };
}
