import { transformObsidianCallouts } from '@/lib/content/callouts';
import { resolveLessonMarkdownAssetUrls } from '@/lib/course-markdown';
import { renderCourseMarkdownToHtml } from '@/lib/markdown';
import { changedWords } from './revision';

/**
 * Word marks in rendered lessons: what changed in a paragraph shown as learners see it (callouts,
 * code, links and all), not in its Markdown. Both versions are rendered, the words a reader sees
 * are compared (text nodes, in order; icons left out), and the changed ones are wrapped in
 * `<del>` / `<ins>`. Rendering runs twice: once to read the words, once to mark them.
 */

export type DiffClasses = { removed: string; added: string };

type HastText = { type: 'text'; value: string };
type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[] };
type Word = { node: HastText; parent: HastNode; start: number; end: number; word: string; space: string };

/** A word (letters, digits, apostrophes, hyphens) or a run of punctuation: "page." is "page" and ".". */
const TOKEN = /[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]+/gu;

/** The words a reader sees, in order, each with the spaces after it in its text node. */
function wordsOf(tree: HastNode): Word[] {
  const words: Word[] = [];
  const walk = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'svg') return;
    for (const child of node.children ?? []) {
      if (child.type === 'text') {
        const value = child.value ?? '';
        const inNode = Array.from(value.matchAll(TOKEN), (match) => ({ start: match.index ?? 0, word: match[0] }));
        inNode.forEach(({ start, word }, index) => {
          const end = start + word.length;
          const space = value.slice(end, index + 1 < inNode.length ? inNode[index + 1].start : value.length);
          words.push({ node: child as HastText, parent: node, start, end, word, space });
        });
      } else {
        walk(child);
      }
    }
  };
  walk(tree);
  return words;
}

const text = (value: string): HastText => ({ type: 'text', value });
const mark = (tagName: 'del' | 'ins', className: string, value: string): HastNode => ({
  type: 'element',
  tagName,
  properties: { className: [className] },
  children: [text(value)],
} as HastNode);

/**
 * Wraps the marked words (`marked`, by their index among all words) in `tag`, a run of them in one
 * text node as one element with its spaces; and puts each removed run (`insert`: before the word at
 * that index, or at the end) in as struck-out words.
 */
function marker(marked: Set<number>, tag: 'del' | 'ins', className: string, insert?: { at: Map<number, string>; className: string }) {
  return (tree: HastNode) => {
    const words = wordsOf(tree);
    const byNode = new Map<HastText, { parent: HastNode; words: { index: number; start: number; end: number }[] }>();
    words.forEach((word, index) => {
      const entry = byNode.get(word.node) ?? { parent: word.parent, words: [] };
      entry.words.push({ index, start: word.start, end: word.end });
      byNode.set(word.node, entry);
    });
    const last = words.at(-1);
    for (const [node, { parent, words: inNode }] of Array.from(byNode)) {
      const value = node.value;
      const out: HastNode[] = [];
      let cursor = 0;
      let run: { start: number; end: number } | null = null;
      const pushText = (until: number) => {
        if (until > cursor) out.push(text(value.slice(cursor, until)));
        cursor = Math.max(cursor, until);
      };
      const flushRun = () => {
        if (!run) return;
        pushText(run.start);
        out.push(mark(tag, className, value.slice(run.start, run.end)));
        cursor = run.end;
        run = null;
      };
      for (const word of inNode) {
        const removed = insert?.at.get(word.index);
        if (removed) {
          flushRun();
          pushText(word.start);
          // One space between it and its neighbours: after it when a space comes before, else before.
          const spaced = word.start === 0 || /\s/.test(value[word.start - 1]);
          out.push(...(spaced ? [mark('del', insert!.className, removed), text(' ')] : [text(' '), mark('del', insert!.className, removed)]));
        }
        if (marked.has(word.index)) {
          if (run) run.end = word.end;
          else run = { start: word.start, end: word.end };
        } else {
          flushRun();
        }
      }
      flushRun();
      pushText(value.length);
      const atEnd = insert?.at.get(words.length);
      if (atEnd && last?.node === node) out.push(text(' '), mark('del', insert!.className, atEnd));
      if (out.length === 1 && out[0].type === 'text' && out[0].value === value) continue;
      const children = parent.children ?? [];
      children.splice(children.indexOf(node), 1, ...out);
    }
  };
}

const render = (markdown: string, assets: Map<string, string>, afterHighlight: ((tree: HastNode) => void)[] = []) =>
  renderCourseMarkdownToHtml(resolveLessonMarkdownAssetUrls(markdown, assets), {
    hastTransforms: [transformObsidianCallouts],
    afterHighlight,
  });

/** Both versions rendered, and the words a reader sees in each. */
function read(before: string, after: string, assets: Map<string, string>) {
  let a: Word[] = [];
  let b: Word[] = [];
  const plain = {
    before: render(before, assets, [(tree) => (a = wordsOf(tree))]),
    after: render(after, assets, [(tree) => (b = wordsOf(tree))]),
  };
  return { plain, diff: changedWords(a.map((word) => word.word), b.map((word) => word.word)), a };
}

/** Before and after side by side: removed words struck out in the one, new words marked in the other. */
export function renderedDiff(before: string, after: string, assets: Map<string, string>, classes: DiffClasses) {
  const { plain, diff } = read(before, after, assets);
  if (!diff) return plain;
  return {
    before: render(before, assets, [marker(diff.removed, 'del', classes.removed)]),
    after: render(after, assets, [marker(diff.added, 'ins', classes.added)]),
  };
}

/**
 * The new version with what changed in place, as track changes shows it: new words marked, and
 * each removed run struck out where it was (as plain words: it's gone, its formatting with it).
 * Unmarked when the versions are too long to compare word by word.
 */
export function renderedInlineDiff(before: string, after: string, assets: Map<string, string>, classes: DiffClasses) {
  const { plain, diff, a } = read(before, after, assets);
  if (!diff) return plain.after;
  const at = new Map(Array.from(diff.removedAt, ([index, removed]) => [index, removed.map((k) => a[k].word + a[k].space).join('').replace(/\s+/g, ' ').trim()]));
  return render(after, assets, [marker(diff.added, 'ins', classes.added, { at, className: classes.removed })]);
}
