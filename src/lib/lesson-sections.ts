/**
 * A lesson's sections, and the ones an improvement is about. A section is the part before the
 * first "## " heading, or a "## " heading with everything up to the next one ("###" headings stay
 * inside). The sections in focus are those holding a passage the feedback quoted, a heading or a
 * quoted phrase the plan names, or a proposed change; the lesson's Improvements view shows only
 * those, and AI drafts for an improvement rewrite only them. Pure (unit-tested in
 * tests/e2e/unit-lesson-sections.mjs).
 */

import { plainText, splitBlocks } from '@/app/admin/courses/components/workspace/revision';

export type LessonSection = {
  /** The "## " heading's text; null for the part before the first heading. */
  heading: string | null;
  /** Where it is in the lesson's text (Windows line ends counted as one). */
  start: number;
  end: number;
  text: string;
};

/** The lesson split into its sections, in order; a lesson without "## " headings is one section. */
export function lessonSections(markdown: string): LessonSection[] {
  const text = markdown.replace(/\r\n/g, '\n');
  const starts: Array<{ at: number; heading: string }> = [];
  let offset = 0;
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1] === fence) fence = null;
    } else if (fenceMatch) {
      fence = fenceMatch[1];
    } else {
      const heading = line.match(/^##\s+(.+?)\s*#*\s*$/);
      if (heading) starts.push({ at: offset, heading: heading[1].trim() });
    }
    offset += line.length + 1;
  }
  const sections: LessonSection[] = [];
  const firstAt = starts.length ? starts[0].at : text.length;
  if (text.slice(0, firstAt).trim()) sections.push({ heading: null, start: 0, end: firstAt, text: text.slice(0, firstAt) });
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].at : text.length;
    sections.push({ heading: start.heading, start: start.at, end, text: text.slice(start.at, end) });
  });
  return sections;
}

const flat = (markdown: string) => plainText(markdown).toLowerCase();

/** Phrases the plan puts in double quotes ("…", “…”, „…“, «…»): usually a heading or a step it names. */
function quotedPhrases(plan: string) {
  const phrases: string[] = [];
  for (const match of Array.from(plan.matchAll(/["“”„«»]([^"“”„«»\n]{4,160})["“”„«»]/g))) phrases.push(match[1]);
  return phrases;
}

/**
 * The sections an improvement is about, by index into `lessonSections(markdown)`: those holding a
 * quoted passage, a heading or quoted phrase of the plan, or a proposed change (`changeAt`: block
 * indexes into `splitBlocks(markdown)`, as `ProposedChange.at` gives them). Empty when nothing
 * points anywhere: then the whole lesson is shown.
 */
export function focusSections(
  markdown: string,
  hints: { passages?: string[]; plan?: string | null; changeAt?: number[] }
): number[] {
  const sections = lessonSections(markdown);
  if (sections.length < 2) return [];
  const texts = sections.map((section) => flat(section.text));
  const found = new Set<number>();
  const holding = (needle: string) => {
    const words = flat(needle);
    if (words.length < 4) return;
    texts.forEach((text, index) => {
      if (text.includes(words)) found.add(index);
    });
  };
  for (const passage of hints.passages ?? []) holding(passage);
  const plan = hints.plan ? flat(hints.plan) : '';
  if (plan) {
    sections.forEach((section, index) => {
      if (section.heading && section.heading.length >= 4 && plan.includes(flat(section.heading))) found.add(index);
    });
    for (const phrase of quotedPhrases(hints.plan ?? '')) holding(phrase);
  }
  if (hints.changeAt?.length) {
    // Each section's blocks, counted the way the proposed changes count them.
    let first = 0;
    const ranges = sections.map((section) => {
      const count = splitBlocks(section.text).length;
      const range = { first, last: first + count };
      first += count;
      return range;
    });
    for (const at of hints.changeAt) {
      // A change at a section's end (something added after its last block) belongs to it.
      const index = ranges.findIndex((range) => at >= range.first && at <= range.last);
      if (index >= 0) found.add(index);
    }
  }
  return Array.from(found).sort((a, b) => a - b);
}

/** The part of the lesson from the first to the last of these sections, as one piece of text. */
export function sectionSpan(markdown: string, indexes: number[]): { start: number; end: number } | null {
  const sections = lessonSections(markdown);
  const chosen = indexes.map((index) => sections[index]).filter((section): section is LessonSection => Boolean(section));
  if (!chosen.length) return null;
  return { start: Math.min(...chosen.map((section) => section.start)), end: Math.max(...chosen.map((section) => section.end)) };
}

/** The lesson with one span replaced, keeping the whitespace that ended the span. */
export function spliceSpan(markdown: string, span: { start: number; end: number }, replacement: string): string {
  const text = markdown.replace(/\r\n/g, '\n');
  const trailing = text.slice(span.start, span.end).match(/\s*$/)?.[0] ?? '';
  return `${text.slice(0, span.start)}${replacement.replace(/\r\n/g, '\n').trim()}${trailing || (span.end < text.length ? '\n\n' : '\n')}${text.slice(span.end)}`;
}

const squash = (text: string) => flat(text).replace(/\s+/g, ' ').trim();

/**
 * Feedback in the order a reader meets it: by where its passage is in the lesson. Feedback that
 * quotes nothing, or a passage the lesson no longer has, comes last, in the order it came.
 */
export function feedbackOrder<T extends { passage: string }>(markdown: string, feedback: T[]): T[] {
  const text = squash(markdown);
  const at = (passage: string) => {
    const needle = squash(passage);
    if (!needle) return Infinity;
    const index = text.indexOf(needle);
    return index === -1 ? Infinity : index;
  };
  return feedback
    .map((one, index) => ({ one, index, at: at(one.passage) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ one }) => one);
}

/**
 * The heading a passage falls under: the nearest one above the paragraph holding it, of any level,
 * as `ProposedChange.section` names a change's. Null before the first heading; undefined when no
 * paragraph holds the passage.
 */
export function passageHeading(markdown: string, passage: string): string | null | undefined {
  const needle = squash(passage);
  if (needle.length < 4) return undefined;
  const blocks = splitBlocks(markdown);
  const index = blocks.findIndex((block) => squash(block).includes(needle));
  if (index === -1) return undefined;
  for (let k = index; k >= 0; k -= 1) {
    if (/^#{1,6}\s/.test(blocks[k])) return blocks[k].replace(/^#+\s*/, '').trim();
  }
  return null;
}
