import { changeSteps, proposeChanges } from '@/app/admin/courses/components/workspace/revision';
import { partialTag, type RevisionLive } from './ai-draft-progress';
import { lessonSections } from './lesson-sections';

/**
 * How far a revision is, read from Claude's answer so far (`<summary>…</summary><lesson>…`) against
 * the text it rewrites: its summary as soon as it's written, and the text's own sections, done (with
 * how many changes each got), being written, or still to come. A section's changes are told once it's
 * finished: until then the rest of it isn't written, and would read as removed. Pure (unit-tested in
 * tests/e2e/unit-ai-drafts.mjs).
 */
export function revisionLive(answer: string, original: string): RevisionLive {
  const written = partialTag(answer, 'lesson');
  const closed = answer.includes('</lesson>');
  const sections = lessonSections(original);
  const live: RevisionLive = {
    summary: partialTag(answer, 'summary'),
    sections: sections.map((section) => ({ heading: section.heading, state: 'todo', changes: 0 })),
    changes: 0,
  };
  if (!written) return live;

  // Each written section against the original one with its heading, in order; a new heading counts
  // as one change of the section it follows.
  let at = -1;
  const pieces = lessonSections(written);
  pieces.forEach((piece, index) => {
    const found = sections.findIndex((section, position) => position > at && section.heading === piece.heading);
    if (found === -1) {
      if (at >= 0) live.sections[at].changes += 1;
      return;
    }
    at = found;
    if (index < pieces.length - 1 || closed) live.sections[found].changes = changeSteps(proposeChanges(sections[found].text, piece.text)).length;
  });
  live.sections.forEach((section, index) => {
    section.state = closed || index < at ? 'done' : index === at ? 'writing' : 'todo';
    if (section.state === 'writing') section.changes = 0;
  });
  live.changes = live.sections.reduce((sum, section) => sum + section.changes, 0);
  return live;
}
