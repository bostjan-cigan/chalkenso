/**
 * Helpers for reviewing an AI revision the way a teacher reads it: changed paragraphs and sections
 * (not Markdown lines), plus plain checks on what the revision kept.
 */

export type Block = { text: string };
export type BlockChange = { kind: 'same' | 'added' | 'removed'; text: string };

/** Splits Markdown into top-level blocks: paragraphs, headings, lists, code blocks, callouts. */
export function splitBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
  };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fence) {
      current.push(line);
      if (fenceMatch && fenceMatch[1] === fence) {
        fence = null;
        flush();
      }
      continue;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A heading is its own block even without a blank line around it.
    if (/^#{1,6}\s/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * A block as compared: spacing collapsed, and list markers alike (`*`, `+` and `-` are the same
 * list to a reader; the visual editor writes `-`), so reformatting alone never counts as a change.
 */
const normalise = (block: string) =>
  block
    .replace(/^(\s*)[*+](\s)/gm, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim();

/** Longest-common-subsequence lengths for two lists of normalised blocks. */
function lcsTable(na: string[], nb: string[]) {
  const table: Uint32Array[] = Array.from({ length: na.length + 1 }, () => new Uint32Array(nb.length + 1));
  for (let i = na.length - 1; i >= 0; i -= 1) {
    for (let j = nb.length - 1; j >= 0; j -= 1) {
      table[i][j] = na[i] === nb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/** For each block of `na`, the index of the same block in `nb` (in order), or -1. */
function matchBlocks(na: string[], nb: string[]): number[] {
  const table = lcsTable(na, nb);
  const matches = new Array<number>(na.length).fill(-1);
  let i = 0;
  let j = 0;
  while (i < na.length && j < nb.length) {
    if (na[i] === nb[j]) {
      matches[i] = j;
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

/** Block-level diff (longest common subsequence). Lessons have a few hundred blocks at most. */
export function diffBlocks(before: string, after: string): BlockChange[] {
  const a = splitBlocks(before);
  const b = splitBlocks(after);
  const na = a.map(normalise);
  const nb = b.map(normalise);
  const table = lcsTable(na, nb);
  const changes: BlockChange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (na[i] === nb[j]) {
      changes.push({ kind: 'same', text: b[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      changes.push({ kind: 'removed', text: a[i] });
      i += 1;
    } else {
      changes.push({ kind: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) changes.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) changes.push({ kind: 'added', text: b[j++] });
  return changes;
}

/** A passage both the person and the draft changed: the person's version was kept. */
export type SkippedChange = { yours: string; draft: string };
export type BlockMerge = { text: string; applied: number; skipped: SkippedChange[] };

/**
 * Applies a draft's changes on top of the person's own edits (a three-way merge over blocks).
 * `base` is the text the draft was written from, `ours` the editor's text now, `theirs` the draft.
 * Between blocks all three still share: only the draft changed it → the draft's; only the person
 * changed it → theirs kept; both made the same change → that; both changed it differently → the
 * person's version stays and the passage is listed in `skipped`.
 *
 * `oursBase` is the same base as the editor writes it (the visual editor re-serialises Markdown,
 * e.g. `*` lists as `-`): the person's text is compared with it, so reformatting alone never
 * counts as an edit. Ignored unless it has the same blocks as `base`.
 */
export function mergeBlocks(base: string, ours: string, theirs: string, oursBase?: string): BlockMerge {
  const b = splitBlocks(base);
  const o = splitBlocks(ours);
  const t = splitBlocks(theirs);
  const nb = b.map(normalise);
  const asOurs = oursBase ? splitBlocks(oursBase).map(normalise) : null;
  const nbo = asOurs && asOurs.length === nb.length ? asOurs : nb;
  const no = o.map(normalise);
  const nt = t.map(normalise);
  const inOurs = matchBlocks(nbo, no);
  const inTheirs = matchBlocks(nb, nt);
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((value, index) => value === y[index]);

  const out: string[] = [];
  const skipped: SkippedChange[] = [];
  let applied = 0;
  let bi = 0;
  let oi = 0;
  let ti = 0;
  // Anchors: base blocks the person and the draft both kept; the stretches between them merge.
  const anchors = nb.map((_, index) => index).filter((index) => inOurs[index] !== -1 && inTheirs[index] !== -1);
  for (const anchor of [...anchors, -1]) {
    const bEnd = anchor === -1 ? b.length : anchor;
    const oEnd = anchor === -1 ? o.length : inOurs[anchor];
    const tEnd = anchor === -1 ? t.length : inTheirs[anchor];
    const chunkB = nb.slice(bi, bEnd);
    const chunkO = no.slice(oi, oEnd);
    const chunkT = nt.slice(ti, tEnd);
    if (same(chunkO, nbo.slice(bi, bEnd))) {
      out.push(...t.slice(ti, tEnd));
      if (!same(chunkT, chunkB)) applied += 1;
    } else if (same(chunkT, chunkB) || same(chunkO, chunkT)) {
      out.push(...o.slice(oi, oEnd));
    } else if (chunkB.length === chunkO.length && matchBlocks(chunkB, chunkT).every((index) => index !== -1)) {
      // You edited paragraphs in place; the draft only added paragraphs around them: both.
      const kept = matchBlocks(chunkB, chunkT);
      for (let k = 0; k < chunkT.length; k += 1) {
        const at = kept.indexOf(k);
        out.push(at === -1 ? t[ti + k] : o[oi + at]);
      }
      applied += 1;
    } else if (chunkB.length === chunkT.length && matchBlocks(nbo.slice(bi, bEnd), chunkO).every((index) => index !== -1)) {
      // The draft edited paragraphs in place; you only added paragraphs around them: both.
      const kept = matchBlocks(nbo.slice(bi, bEnd), chunkO);
      for (let k = 0; k < chunkO.length; k += 1) {
        const at = kept.indexOf(k);
        out.push(at === -1 ? o[oi + k] : t[ti + at]);
      }
      applied += 1;
    } else if (chunkB.length === chunkO.length && chunkB.length === chunkT.length) {
      // Edits side by side (yours in one paragraph, the draft's in the next): block by block.
      for (let k = 0; k < chunkB.length; k += 1) {
        if (no[oi + k] === nbo[bi + k]) {
          out.push(t[ti + k]);
          if (nt[ti + k] !== nb[bi + k]) applied += 1;
        } else if (nt[ti + k] === nb[bi + k] || no[oi + k] === nt[ti + k]) {
          out.push(o[oi + k]);
        } else {
          out.push(o[oi + k]);
          skipped.push({ yours: o[oi + k], draft: t[ti + k] });
        }
      }
    } else {
      out.push(...o.slice(oi, oEnd));
      skipped.push({ yours: o.slice(oi, oEnd).join('\n\n'), draft: t.slice(ti, tEnd).join('\n\n') });
    }
    if (anchor !== -1) out.push(o[oEnd]);
    bi = bEnd + 1;
    oi = oEnd + 1;
    ti = tEnd + 1;
  }
  return { text: `${out.join('\n\n')}${/\n$/.test(ours) ? '\n' : ''}`, applied, skipped };
}

// -------------------------------------------------------------------------------------------------
// Words: what changed inside a paragraph
// -------------------------------------------------------------------------------------------------

export type WordChange = { kind: 'same' | 'added' | 'removed'; text: string };

/** A word with the space that follows it, so a diff can be shown with the original line breaks. */
type Piece = { word: string; space: string };

const pieces = (text: string): Piece[] =>
  Array.from(text.matchAll(/(\S+)(\s*)/g), (match) => ({ word: match[1], space: match[2] }));

/** Beyond this many cells (words × words) a word diff isn't worth the time: the pair shows whole. */
const MAX_CELLS = 250_000;

/**
 * A word-level diff (longest common subsequence of the words, spaces kept with the word before
 * them). Runs of the same kind are merged. Null when the texts are too long to compare word by word.
 */
export function diffWords(before: string, after: string): WordChange[] | null {
  const a = pieces(before);
  const b = pieces(after);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return null;
  const table = lcsTable(
    a.map((piece) => piece.word),
    b.map((piece) => piece.word)
  );
  const changes: WordChange[] = [];
  const push = (kind: WordChange['kind'], text: string) => {
    const last = changes[changes.length - 1];
    if (last && last.kind === kind) last.text += text;
    else changes.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].word === b[j].word) {
      push('same', a[i].word + b[j].space);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push('removed', a[i].word + a[i].space);
      i += 1;
    } else {
      push('added', b[j].word + b[j].space);
      j += 1;
    }
  }
  while (i < a.length) push('removed', a[i].word + a[i++].space);
  while (j < b.length) push('added', b[j].word + b[j++].space);
  return changes;
}

/**
 * Which words of two word lists changed (longest common subsequence, as `diffWords`): the removed
 * ones by their index in `a`, the added ones by their index in `b`, and where each removed run sits
 * in `b` (`removedAt`: before the word at that index; `b.length` is the end). Null when too long.
 */
export function changedWords(
  a: string[],
  b: string[]
): { removed: Set<number>; added: Set<number>; removedAt: Map<number, number[]> } | null {
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return null;
  const table = lcsTable(a, b);
  const removed = new Set<number>();
  const added = new Set<number>();
  const removedAt = new Map<number, number[]>();
  let i = 0;
  let j = 0;
  const remove = () => {
    removed.add(i);
    removedAt.set(j, [...(removedAt.get(j) ?? []), i]);
    i += 1;
  };
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      remove();
    } else {
      added.add(j);
      j += 1;
    }
  }
  while (i < a.length) remove();
  while (j < b.length) added.add(j++);
  return { removed, added, removedAt };
}

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** How alike two blocks are: 2 × common words ÷ all words (1 = the same words in the same order). */
export function similarity(before: string, after: string): number {
  const a = wordsOf(before);
  const b = wordsOf(after);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return 0;
  return (2 * lcsTable(a, b)[0][0]) / (a.length + b.length);
}

const isCode = (block: string) => /^\s*(```|~~~)/.test(block);

export type DiffItem =
  | { kind: 'same'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string }
  /** A paragraph that was edited: the removed and the added version, and the words that changed. */
  | { kind: 'changed'; before: string; after: string; words: WordChange[] | null };

/** Paragraphs this alike (see `similarity`) count as one edited paragraph, not one removed and one added. */
export const PAIR_THRESHOLD = 0.4;

/**
 * In one run of changes, which added block is the edited version of which removed block: greedy,
 * in order, a removed block takes the first later added block of the same type (code or not) that
 * shares enough words. `partner[a]` is the removed block's index, or -1.
 */
function pairRun(removed: string[], added: string[]): number[] {
  const partner = new Array<number>(added.length).fill(-1);
  let from = 0;
  removed.forEach((block, r) => {
    for (let a = from; a < added.length; a += 1) {
      if (isCode(block) === isCode(added[a]) && similarity(block, added[a]) >= PAIR_THRESHOLD) {
        partner[a] = r;
        from = a + 1;
        return;
      }
    }
  });
  return partner;
}

/**
 * The block diff with edited paragraphs paired up: inside each run of changes, a removed block and
 * a later added block that are alike become one "changed" item, in the order of the new version.
 */
export function pairChanges(changes: BlockChange[]): DiffItem[] {
  const items: DiffItem[] = [];
  let at = 0;
  while (at < changes.length) {
    if (changes[at].kind === 'same') {
      items.push({ kind: 'same', text: changes[at].text });
      at += 1;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (at < changes.length && changes[at].kind !== 'same') {
      (changes[at].kind === 'removed' ? removed : added).push(changes[at].text);
      at += 1;
    }
    const partner = pairRun(removed, added);
    // Unpaired removed blocks go first (as in the block diff), but never past the pair they come before.
    let next = 0;
    const flushRemoved = (until: number) => {
      for (; next < until; next += 1) if (!partner.includes(next)) items.push({ kind: 'removed', text: removed[next] });
    };
    added.forEach((block, a) => {
      const pair = partner.slice(a).find((r) => r >= 0);
      flushRemoved(pair === undefined ? removed.length : pair);
      const r = partner[a];
      if (r < 0) {
        items.push({ kind: 'added', text: block });
        return;
      }
      items.push({ kind: 'changed', before: removed[r], after: block, words: diffWords(removed[r], block) });
      next = r + 1;
    });
    flushRemoved(removed.length);
  }
  return items;
}

// -------------------------------------------------------------------------------------------------
// Proposed changes: a draft as separate changes, each kept or skipped
// -------------------------------------------------------------------------------------------------

/**
 * One change a draft proposes, against the text it was written from (`base`): an edited
 * paragraph, new paragraphs, or removed ones. `at` is where it sits in the base's blocks: the
 * first block it replaces or removes, or the block new ones go before (the base's length at the end).
 */
export type ProposedChange = {
  id: string;
  kind: 'edit' | 'add' | 'remove';
  at: number;
  /** The base blocks it replaces or removes (none for new paragraphs). */
  before: string[];
  /** The blocks it puts in their place (none for a removal). */
  after: string[];
  /** For an edited paragraph, the words that changed (null when too long to compare). */
  words: WordChange[] | null;
  /** The heading it falls under in the base, to say where it is. */
  section: string | null;
};

/** Where a change stands against the editor's text now (`placeChanges`). */
export type ChangeState = 'clean' | 'conflict' | 'gone' | 'done';

/** Short, stable ids: the same change in the same draft keeps its id across renders. */
function hash(text: string) {
  let value = 5381;
  for (let i = 0; i < text.length; i += 1) value = ((value << 5) + value + text.charCodeAt(i)) | 0;
  return (value >>> 0).toString(36);
}

const headingText = (block: string) => (/^#{1,6}\s/.test(block) ? block.replace(/^#+\s*/, '').trim() : null);

/**
 * The draft as separate changes against the text it was written from. Whitespace and list-marker
 * differences are not changes. Neighbouring new paragraphs are one change, as are neighbouring
 * removed ones; an edited paragraph is one change with its word diff.
 */
export function proposeChanges(base: string, draft: string): ProposedChange[] {
  const a = splitBlocks(base);
  const b = splitBlocks(draft);
  const na = a.map(normalise);
  const nb = b.map(normalise);
  const inDraft = matchBlocks(na, nb);
  const changes: ProposedChange[] = [];
  const sectionAt = (index: number) => {
    for (let k = Math.min(index, a.length) - 1; k >= 0; k -= 1) {
      const heading = headingText(a[k]);
      if (heading) return heading;
    }
    return null;
  };
  const push = (change: Omit<ProposedChange, 'id' | 'section'>) => {
    const section = sectionAt(change.at + (change.kind === 'add' ? 0 : 1));
    changes.push({
      ...change,
      section,
      id: `${change.kind}-${change.at}-${hash(change.before.join('\n') + '\u0000' + change.after.join('\n'))}`,
    });
  };

  let i = 0;
  let j = 0;
  // Walk the anchors (blocks both keep); each stretch between them is one run of changes.
  const anchors = na.map((_, index) => index).filter((index) => inDraft[index] !== -1);
  for (const anchor of [...anchors, -1]) {
    const iEnd = anchor === -1 ? a.length : anchor;
    const jEnd = anchor === -1 ? b.length : inDraft[anchor];
    const removed = a.slice(i, iEnd);
    const added = b.slice(j, jEnd);
    if (removed.length || added.length) {
      const partner = pairRun(removed, added);
      let next = 0; // the next base block of this run not yet accounted for
      let pendingAdd: string[] = [];
      let pendingAddAt = i;
      const flushAdd = () => {
        if (pendingAdd.length) push({ kind: 'add', at: pendingAddAt, before: [], after: pendingAdd, words: null });
        pendingAdd = [];
      };
      const flushRemoved = (until: number) => {
        let start = -1;
        const out: string[] = [];
        for (; next < until; next += 1) {
          if (partner.includes(next)) continue;
          if (start === -1) start = next;
          out.push(removed[next]);
        }
        if (out.length) push({ kind: 'remove', at: i + start, before: out, after: [], words: null });
      };
      added.forEach((block, k) => {
        const pair = partner.slice(k).find((r) => r >= 0);
        const r = partner[k];
        if (r < 0) {
          if (!pendingAdd.length) {
            // New paragraphs go before the next base block still to come in this run.
            const upcoming = pair === undefined ? removed.length : pair;
            flushRemoved(upcoming);
            pendingAddAt = i + next;
          }
          pendingAdd.push(block);
          return;
        }
        flushAdd();
        flushRemoved(r);
        push({ kind: 'edit', at: i + r, before: [removed[r]], after: [block], words: diffWords(removed[r], block) });
        next = r + 1;
      });
      flushAdd();
      flushRemoved(removed.length);
    }
    i = iEnd + 1;
    j = jEnd + 1;
  }
  return changes;
}

/**
 * The changes as a reader takes them, one step each, in the lesson's order: a removal directly
 * followed by new paragraphs in its place is one step (a rewrite too unlike the old to pair as an
 * edit); everything else is a step of its own.
 */
export function changeSteps(changes: ProposedChange[]): ProposedChange[][] {
  const steps: ProposedChange[][] = [];
  for (let k = 0; k < changes.length; k += 1) {
    const change = changes[k];
    const next = changes[k + 1];
    if (change.kind === 'remove' && next?.kind === 'add' && next.at === change.at + change.before.length) {
      steps.push([change, next]);
      k += 1;
    } else {
      steps.push([change]);
    }
  }
  return steps;
}

/** What a step is to a reader: a rewrite (removed, then new in its place) or its one change's kind. */
export const stepKind = (step: ProposedChange[]): ProposedChange['kind'] | 'rewrite' => (step.length > 1 ? 'rewrite' : step[0].kind);

/** The base with only the kept changes made: what the draft would be had it proposed just those. */
export function applyChanges(base: string, changes: ProposedChange[], keep: (change: ProposedChange) => boolean): string {
  const blocks = splitBlocks(base);
  const replaced = new Map<number, ProposedChange>();
  const inserted = new Map<number, string[]>();
  for (const change of changes) {
    if (!keep(change)) continue;
    if (change.kind === 'add') inserted.set(change.at, [...(inserted.get(change.at) ?? []), ...change.after]);
    else replaced.set(change.at, change);
  }
  const out: string[] = [];
  for (let index = 0; index <= blocks.length; index += 1) {
    out.push(...(inserted.get(index) ?? []));
    if (index === blocks.length) break;
    const change = replaced.get(index);
    if (change) {
      out.push(...change.after);
      index += change.before.length - 1;
      continue;
    }
    out.push(blocks[index]);
  }
  return `${out.join('\n\n')}${/\n$/.test(base) ? '\n' : ''}`;
}

/**
 * Where each change stands against the editor's text now (the person may have typed since the
 * draft was written): `clean` goes in as proposed; `conflict` meets the person's own edit there;
 * `gone` had its paragraph removed by the person; `done` is already in the text. `oursBase` is the
 * base as the editor writes it (see `mergeBlocks`).
 */
export function placeChanges(base: string, current: string, changes: ProposedChange[], oursBase?: string): Record<string, ChangeState> {
  const states: Record<string, ChangeState> = {};
  const now = splitBlocks(current).map(normalise);
  for (const change of changes) {
    const alone = applyChanges(base, [change], () => true);
    const merged = mergeBlocks(base, current, alone, oursBase);
    if (merged.skipped.length) {
      states[change.id] = merged.skipped.every((skip) => !skip.yours.trim()) ? 'gone' : 'conflict';
      continue;
    }
    const unchanged = splitBlocks(merged.text).map(normalise).join('\n') === now.join('\n');
    states[change.id] = unchanged ? 'done' : 'clean';
  }
  return states;
}

/**
 * The kept changes put onto the editor's text now: the person's edits since the draft stay, and
 * for a conflict where they chose the proposed version (`proposalWins`), the proposal replaces theirs.
 * Returns the new text and how many changes went in.
 */
export function applyOnto(
  base: string,
  current: string,
  changes: ProposedChange[],
  keep: (change: ProposedChange) => boolean,
  proposalWins: (change: ProposedChange) => boolean = () => false,
  oursBase?: string
): { text: string; applied: number } {
  const kept = changes.filter(keep);
  const merged = mergeBlocks(base, current, applyChanges(base, kept, () => true), oursBase);
  let text = merged.text;
  for (const skip of merged.skipped) {
    // A conflict: theirs replaces the person's paragraphs only where they chose the proposal.
    const change = kept.find((candidate) => normalise(candidate.after.join('\n\n')) === normalise(skip.draft));
    if (!change || !proposalWins(change) || !skip.yours.trim()) continue;
    text = text.replace(skip.yours, skip.draft);
  }
  return { text, applied: kept.length };
}

/**
 * Changes made in one copy of a lesson (`before` → `after`, a group's copy) carried onto another
 * copy (`target`, the main course's lesson, or a draft for it): each goes in where the same text is
 * there, and failing that where the text is alike (`placeNearby`: the copies drift apart a little
 * as each is edited). What has nowhere to go (its paragraph was rewritten there, or is gone) is left
 * out and returned, for someone to do by hand. Changes the target already has count as placed.
 * `nearby`: how many went in where the text differs, for the reviewer to check.
 */
export function transplantChanges(
  before: string,
  after: string,
  target: string
): { text: string; total: number; placed: number; unplaced: ProposedChange[]; nearby: number } {
  const changes = proposeChanges(before, after);
  const states = placeChanges(before, target, changes);
  // A rewrite (a removal and new paragraphs in its place) goes in whole or not at all: half of one
  // would leave the old paragraph and the new one side by side.
  const whole = new Set(
    changeSteps(changes)
      .filter((step) => step.every((change) => states[change.id] === 'clean' || states[change.id] === 'done'))
      .flat()
      .map((change) => change.id)
  );
  const fits = (change: ProposedChange) => states[change.id] === 'clean' && whole.has(change.id);
  const { text } = applyOnto(before, target, changes, fits);
  const left = changes.filter((change) => states[change.id] === 'conflict' || states[change.id] === 'gone' || (states[change.id] === 'clean' && !whole.has(change.id)));
  const nearby = placeNearby(before, text, left);
  // Nothing changed after all: the target as it was, its own spacing too (the merge rejoins
  // paragraphs, which can change blank lines and line endings without changing a word).
  const same = proposeChanges(target, nearby.text).length === 0;
  return {
    text: same ? target : nearby.text,
    total: changes.length,
    placed: changes.length - nearby.left.length,
    unplaced: nearby.left,
    nearby: nearby.placed.length,
  };
}

/**
 * Which of the changes made on another copy of a lesson `text` doesn't have yet, in the copy's
 * words or its own: a removal whose paragraph (or one nearly the same) is still there, new
 * paragraphs that aren't, an edit with no paragraph closer to its new version than to its old one.
 * What's left of a group's changes on the main course's lesson, done by hand there.
 */
export function changesNotIn(text: string, changes: ProposedChange[]): ProposedChange[] {
  const blocks = splitBlocks(text);
  const exact = new Set(blocks.map(normalise));
  const has = (block: string, least: number) => exact.has(normalise(block)) || nearest(blocks, block, least, null) !== -1;
  return changes.filter((change) => {
    if (change.kind === 'remove') return change.before.some((block) => has(block, NEARBY_REMOVE));
    if (change.kind === 'add') return !change.after.every((block) => has(block, NEARBY_ADDED));
    const [old, now] = [change.before[0], change.after[0]];
    if (exact.has(normalise(now))) return false;
    return !blocks.some((block) => {
      const toNew = similarity(block, now);
      return toNew >= NEARBY_EDIT && toNew > similarity(block, old);
    });
  });
}

// -------------------------------------------------------------------------------------------------
// Carrying a change to text that differs a little
// -------------------------------------------------------------------------------------------------

/** Paragraphs at least this alike (see `similarity`) are the same paragraph, reworded a little: an edit goes there. */
const NEARBY_EDIT = 0.5;
/** A paragraph new ones followed (or preceded) is found when at least this alike. */
const NEARBY_ANCHOR = 0.6;
/** New paragraphs count as there when one this alike is. */
const NEARBY_ADDED = 0.8;
/** A paragraph is removed only when it's nearly the same: removing the wrong one costs more. */
const NEARBY_REMOVE = 0.7;

/** The heading each block is under (its own, for a heading). */
function sectionsOf(blocks: string[]): (string | null)[] {
  let current: string | null = null;
  return blocks.map((block) => {
    current = headingText(block) ?? current;
    return current;
  });
}

/**
 * The block of `blocks` most like `block`, of the same kind (code or not, heading or not), at least
 * `least` alike; in its own section when that's a close call. `skip`: blocks not to choose. -1: none.
 */
function nearest(blocks: string[], block: string, least: number, section: string | null, skip?: boolean[]) {
  const sections = sectionsOf(blocks);
  const heading = headingText(block) !== null;
  let best = -1;
  let score = 0;
  blocks.forEach((candidate, index) => {
    if (skip?.[index] || isCode(candidate) !== isCode(block) || (headingText(candidate) !== null) !== heading) return;
    const alike = normalise(candidate) === normalise(block) ? 1 : similarity(candidate, block);
    if (alike < least) return;
    const value = alike + (section !== null && sections[index] === section ? 0.05 : 0);
    if (value > score) {
      best = index;
      score = value;
    }
  });
  return best;
}

/**
 * An edit's words (`before` → `after`) made in a paragraph that differs a little (`target`): each run
 * of changed words goes in where the words around it are the same there, so the target's own wording
 * elsewhere in the paragraph stays. Null when a run's own words were changed there too.
 */
export function patchWords(before: string, after: string, target: string): string | null {
  const a = pieces(before);
  const b = pieces(after);
  const c = pieces(target);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS || (a.length + 1) * (c.length + 1) > MAX_CELLS) return null;
  // Where each word of `before` is in `target` (-1: not there).
  const inTarget = matchBlocks(
    a.map((piece) => piece.word),
    c.map((piece) => piece.word)
  );
  // The runs of `before` that `after` changes: [from, to) replaced by `words`.
  const table = lcsTable(
    a.map((piece) => piece.word),
    b.map((piece) => piece.word)
  );
  const runs: { from: number; to: number; words: Piece[] }[] = [];
  let run: { from: number; to: number; words: Piece[] } | null = null;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) {
      if (run) runs.push(run);
      run = null;
      i += 1;
      j += 1;
    } else if (j >= b.length || (i < a.length && table[i + 1][j] >= table[i][j + 1])) {
      run ??= { from: i, to: i, words: [] };
      i += 1;
      run.to = i;
    } else {
      run ??= { from: i, to: i, words: [] };
      run.words.push(b[j]);
      j += 1;
    }
  }
  if (run) runs.push(run);

  const out = [...c];
  for (const change of runs.reverse()) {
    let start: number;
    let end: number;
    if (change.from < change.to) {
      const at = inTarget.slice(change.from, change.to);
      if (at.some((index, k) => index === -1 || (k > 0 && index !== at[k - 1] + 1))) return null;
      start = at[0];
      end = at[at.length - 1] + 1;
    } else {
      const left = change.from > 0 ? inTarget[change.from - 1] : null;
      const right = change.from < a.length ? inTarget[change.from] : null;
      if (left === -1 || right === -1 || (left !== null && right !== null && right !== left + 1)) return null;
      start = left !== null ? left + 1 : right ?? out.length;
      end = start;
    }
    // A run at the end keeps the target's own ending (its full stop's space, its newline).
    const words = change.words.map((piece) => ({ ...piece }));
    if (words.length && end === c.length && end > start) words[words.length - 1].space = c[end - 1].space;
    out.splice(start, end - start, ...words);
  }
  return out.map((piece) => piece.word + piece.space).join('');
}

/**
 * Where new paragraphs go in `blocks`: after the paragraph they followed in the base (or before the
 * one they preceded), found by likeness; failing that, at the end of their section. Null: nowhere.
 */
function insertionPoint(base: string[], blocks: string[], change: ProposedChange): number | null {
  if (change.at === 0) return 0;
  const previous = base[change.at - 1];
  const after = previous === undefined ? -1 : nearest(blocks, previous, NEARBY_ANCHOR, change.section);
  if (after !== -1) return after + 1;
  const following = base[change.at];
  const before = following === undefined ? -1 : nearest(blocks, following, NEARBY_ANCHOR, change.section);
  if (before !== -1) return before;
  const start = change.section === null ? -1 : blocks.findIndex((block) => headingText(block) === change.section);
  if (start === -1) return null;
  const level = (blocks[start].match(/^#+/)?.[0] ?? '#').length;
  let end = start + 1;
  while (end < blocks.length && !((blocks[end].match(/^(#{1,6})\s/)?.[1].length ?? 7) <= level)) end += 1;
  return end;
}

/**
 * The changes that found no identical text in `target` placed by likeness instead: an edit's words
 * into the most alike paragraph (the whole new paragraph when its words were changed there too), new
 * paragraphs after the one they followed, a removal on a paragraph that's nearly the same. What has
 * nowhere to go is `left`. Everything placed is still a proposal: someone reviews it before it's saved.
 */
function placeNearby(base: string, target: string, changes: ProposedChange[]) {
  const b = splitBlocks(base);
  const blocks = splitBlocks(target);
  // Blocks this carry put in or changed: no other change lands on them.
  const fresh = blocks.map(() => false);
  const placed: ProposedChange[] = [];
  const left: ProposedChange[] = [];
  for (const step of changeSteps(changes)) {
    if (step.length > 1) {
      // A rewrite, whole: the new paragraphs take the old ones' place, found nearly the same there,
      // or (one paragraph) the one most like it, reworded more there. Not found: neither goes in.
      const [removal, addition] = step;
      let found = Array.from(new Set(removal.before.map((block) => nearest(blocks, block, NEARBY_REMOVE, removal.section, fresh)).filter((index) => index !== -1)));
      if (!found.length && removal.before.length === 1) found = [nearest(blocks, removal.before[0], NEARBY_EDIT, removal.section, fresh)].filter((index) => index !== -1);
      if (!found.length) {
        left.push(...step);
        continue;
      }
      found.sort((x, y) => x - y);
      for (const index of [...found].reverse()) {
        blocks.splice(index, 1);
        fresh.splice(index, 1);
      }
      blocks.splice(found[0], 0, ...addition.after);
      fresh.splice(found[0], 0, ...addition.after.map(() => true));
      placed.push(...step);
      continue;
    }
    const change = step[0];
    if (change.kind === 'edit') {
      const at = nearest(blocks, change.before[0], NEARBY_EDIT, change.section, fresh);
      if (at === -1) {
        left.push(change);
        continue;
      }
      blocks[at] = patchWords(change.before[0], change.after[0], blocks[at]) ?? change.after[0];
      fresh[at] = true;
      placed.push(change);
    } else if (change.kind === 'remove') {
      const found = Array.from(new Set(change.before.map((block) => nearest(blocks, block, NEARBY_REMOVE, change.section, fresh)).filter((index) => index !== -1)));
      if (!found.length) {
        left.push(change);
        continue;
      }
      for (const index of found.sort((x, y) => y - x)) {
        blocks.splice(index, 1);
        fresh.splice(index, 1);
      }
      placed.push(change);
    } else {
      const at = insertionPoint(b, blocks, change);
      if (at === null) {
        left.push(change);
        continue;
      }
      blocks.splice(at, 0, ...change.after);
      fresh.splice(at, 0, ...change.after.map(() => true));
      placed.push(change);
    }
  }
  if (!placed.length) return { text: target, placed, left };
  return { text: `${blocks.join('\n\n')}${/\n$/.test(target) ? '\n' : ''}`, placed, left };
}

/**
 * Undo after Apply, keeping what the person typed since: the text as it was just after Apply is
 * the base, the text now is theirs, the text before Apply is what to go back to.
 */
export function revertApplied(afterApply: string, now: string, beforeApply: string): string {
  return mergeBlocks(afterApply, now, beforeApply).text;
}

/**
 * A block's text as the visual editor holds it, to find the block there: its plain text, or for a
 * code block its code (plain text leaves code out).
 */
export function blockAnchor(block: string): string {
  if (isCode(block)) return block.replace(/^\s*(```|~~~)[^\n]*\n?/, '').replace(/\n?\s*(```|~~~)\s*$/, '');
  return plainText(block);
}

/** What a check found, as a message key: `editor.revision.checks.<key>` (and `.problems.<key>` for a failed one). */
export type RevisionCheckKey =
  | 'headingsChanged'
  | 'headingsKept'
  | 'codeChanged'
  | 'codeKept'
  | 'imagesAndLinksRemoved'
  | 'imagesRemoved'
  | 'linksRemoved'
  | 'imagesAndLinksKept'
  | 'sameLength'
  | 'longer'
  | 'shorter';

/**
 * A check on a revision: `label` for a checklist, and for a failed one `problem`, a sentence for the
 * review, both in English (the free Markdown diff tool reads `label` back); `key` and `values` say
 * the same for a translated message.
 */
export type RevisionCheck = {
  ok: boolean;
  label: string;
  problem?: string;
  key: RevisionCheckKey;
  values?: Record<string, string | number>;
};

function outsideCode(markdown: string) {
  return splitBlocks(markdown)
    .filter((block) => !/^\s*(```|~~~)/.test(block))
    .join('\n\n');
}

const headings = (markdown: string) =>
  outsideCode(markdown)
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.replace(/^#+\s*/, '').trim());

const codeBlocks = (markdown: string) => splitBlocks(markdown).filter((block) => /^\s*(```|~~~)/.test(block));

const images = (markdown: string) => [
  ...Array.from(markdown.matchAll(/!\[\[([^\]]+)\]\]/g), (match) => match[1]),
  ...Array.from(markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g), (match) => match[1]),
];

const links = (markdown: string) => [
  ...Array.from(markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)/g), (match) => match[1]),
  ...Array.from(markdown.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g), (match) => match[1]),
];

const words = (markdown: string) => outsideCode(markdown).split(/\s+/).filter(Boolean).length;

function missing(before: string[], after: string[]) {
  const pool = [...after];
  return before.filter((item) => {
    const index = pool.indexOf(item);
    if (index < 0) return true;
    pool.splice(index, 1);
    return false;
  });
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What the revision kept and changed, checked on the text itself. */
export function revisionChecks(before: string, after: string): RevisionCheck[] {
  const checks: RevisionCheck[] = [];

  const lostHeadings = missing(headings(before), headings(after));
  checks.push(
    lostHeadings.length
      ? {
          ok: false,
          label: `Changed ${plural(lostHeadings.length, 'heading')}: “${lostHeadings[0]}”`,
          problem: `This draft changes ${plural(lostHeadings.length, 'heading')}: “${lostHeadings[0]}”.`,
          key: 'headingsChanged',
          values: { count: lostHeadings.length, first: lostHeadings[0] },
        }
      : { ok: true, label: `Kept all ${plural(headings(before).length, 'heading')}`, key: 'headingsKept', values: { count: headings(before).length } }
  );

  const beforeCode = codeBlocks(before);
  const lostCode = missing(beforeCode.map(normalise), codeBlocks(after).map(normalise));
  if (beforeCode.length) {
    checks.push(
      lostCode.length
        ? {
            ok: false,
            label: `Changed ${plural(lostCode.length, 'code block')}`,
            problem: `This draft changes ${plural(lostCode.length, 'code block')}.`,
            key: 'codeChanged',
            values: { count: lostCode.length },
          }
        : { ok: true, label: `Kept all ${plural(beforeCode.length, 'code block')}`, key: 'codeKept', values: { count: beforeCode.length } }
    );
  }

  const lostImages = missing(images(before), images(after));
  const lostLinks = missing(links(before), links(after));
  if (images(before).length || links(before).length) {
    const lost = [lostImages.length && plural(lostImages.length, 'image'), lostLinks.length && plural(lostLinks.length, 'link')].filter(Boolean).join(' and ');
    const removed: Pick<RevisionCheck, 'key' | 'values'> =
      lostImages.length && lostLinks.length
        ? { key: 'imagesAndLinksRemoved', values: { images: lostImages.length, links: lostLinks.length } }
        : lostImages.length
          ? { key: 'imagesRemoved', values: { count: lostImages.length } }
          : { key: 'linksRemoved', values: { count: lostLinks.length } };
    checks.push(
      lostImages.length || lostLinks.length
        ? { ok: false, label: `Removed ${lost}`, problem: `This draft removes ${lost}.`, ...removed }
        : { ok: true, label: 'Kept every image and link', key: 'imagesAndLinksKept' }
    );
  }

  const delta = words(after) - words(before);
  const base = Math.max(words(before), 1);
  const percent = Math.round((Math.abs(delta) / base) * 100);
  checks.push({
    ok: percent <= 25,
    label:
      delta === 0
        ? 'Same length'
        : `${delta > 0 ? '+' : '−'}${plural(Math.abs(delta), 'word')} (${percent}% ${delta > 0 ? 'longer' : 'shorter'})`,
    ...(percent > 25 ? { problem: `This draft is ${percent}% ${delta > 0 ? 'longer' : 'shorter'}.` } : {}),
    ...(delta === 0
      ? { key: 'sameLength' as const }
      : { key: delta > 0 ? ('longer' as const) : ('shorter' as const), values: { count: Math.abs(delta), percent } }),
  });

  return checks;
}

/** Plain text of Markdown, for short quotes and comparisons. */
export function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, target, alias) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?\[![\w-]+\][+-]?/gm, '')
    .replace(/^[>#\-*+\d.\s]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the visual editor would keep this Markdown's text: the round trip may change spacing,
 * list markers or escapes, but not the words. If it would lose text, the lesson opens in Markdown.
 */
export function roundTripKeepsText(original: string, roundTripped: string) {
  const squash = (value: string) =>
    value
      .replace(/^\s*\d+[.)]\s/gm, '')
      .replace(/\\([\\`*_{}\[\]()#+\-.!~|>])/g, '$1')
      .replace(/[\s*_\-+>#|`~=:]+/g, '')
      .toLowerCase();
  return squash(original) === squash(roundTripped);
}
