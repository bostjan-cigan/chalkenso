import 'server-only';

import { revalidateTag } from 'next/cache';
import { afterCommit } from './prisma';

/**
 * The hints learners see (a lesson updated after feedback, how a check question went) are counted
 * per curriculum version and kept a few minutes. Deleting answers or feedback clears them, so what
 * was deleted stops counting at once.
 */

/** The cache tag of one version's learner hints. */
export const learnerHintsTag = (curriculumVersionId: string) => `learner-hints:${curriculumVersionId}`;

/** These versions' hints are counted again on their next view; inside a transaction, once it commits. */
export function forgetLearnerHints(curriculumVersionIds: Iterable<string>) {
  const ids = Array.from(new Set(curriculumVersionIds));
  if (ids.length === 0) {
    return Promise.resolve();
  }
  return afterCommit(() => {
    for (const id of ids) {
      try {
        revalidateTag(learnerHintsTag(id), { expire: 0 });
      } catch {
        // Outside a request (scripts): nothing was cached.
      }
    }
  });
}
