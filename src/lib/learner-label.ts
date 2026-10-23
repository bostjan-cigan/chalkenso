/**
 * How the team sees a learner who left feedback: never by name, so instructors read what was
 * written rather than who wrote it, only by the group they're in. Stored as the comment's
 * `proposerName` (and copied to tasks, the margin, the sync API and AI prompts from there); replies
 * still reach the learner through their link, not their name.
 */
export const ANONYMOUS_LEARNER = 'A learner';

export function learnerLabel(groupName?: string | null) {
  const group = groupName?.trim();
  return group ? `${ANONYMOUS_LEARNER} · ${group}` : ANONYMOUS_LEARNER;
}
