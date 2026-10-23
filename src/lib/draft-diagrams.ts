import { extractMarkdownImageReferences } from './course-markdown';
import { sanitizeSvg } from './sanitize/svg';

/**
 * Diagrams an AI draft adds to a lesson: separate SVG files next to its Markdown, embedded as
 * `![[diagrams/request-flow.svg|What it shows]]`. Made in the app (`<diagram path="…">` after the
 * lesson, `parseDiagrams`) or sent by someone's Claude (`propose_lesson_revision`'s `assets`). Each
 * is cleaned when the draft arrives (`cleanDraftDiagrams`), so the review shows what Save stores;
 * Save cleans it again and stores it like any lesson image.
 */

export type DraftDiagram = { path: string; svg: string };

export const MAX_DIAGRAMS = 4;
export const MAX_DIAGRAM_CHARS = 100_000;
const MAX_DIAGRAM_ELEMENTS = 1_500;
/** `diagrams/<kebab-name>.svg`: a file of its own in the lesson's images (the vault's `_attachments/diagrams/`). */
export const DIAGRAM_PATH = /^diagrams\/[a-z0-9][a-z0-9-]{0,60}\.svg$/;

export type DiagramRefusal = {
  path: string;
  reason: 'path' | 'tooMany' | 'tooLarge' | 'notSvg' | 'tooComplex' | 'noSize' | 'notEmbedded';
};

/** Why a diagram was refused, for someone's Claude to fix and send again. */
export const REFUSAL_TEXT: Record<DiagramRefusal['reason'], string> = {
  path: 'name it diagrams/<lowercase-words-with-dashes>.svg',
  tooMany: `send at most ${MAX_DIAGRAMS} diagrams`,
  tooLarge: `keep it under ${MAX_DIAGRAM_CHARS.toLocaleString('en')} characters`,
  notSvg: 'send one <svg> drawing (shapes, paths, text); nothing was left once scripts, links and HTML were taken out',
  tooComplex: `keep it under ${MAX_DIAGRAM_ELEMENTS.toLocaleString('en')} elements`,
  noSize: 'give the <svg> a viewBox',
  notEmbedded: 'embed it in the Markdown as ![[path|what it shows]], or leave it out',
};

/** The `<diagram path="…">…</diagram>` blocks of an AI answer (the text after its lesson). */
export function parseDiagrams(text: string): DraftDiagram[] {
  return Array.from(text.matchAll(/<diagram\s+path\s*=\s*"([^"]{1,200})"\s*>([\s\S]*?)<\/diagram>/g), (match) => ({
    path: match[1].trim(),
    svg: match[2].trim(),
  }));
}

/** One diagram as it's safe to store and show (`sanitizeSvg`), within the limits, with a size. */
export function cleanDiagram(svg: string): { svg: string } | { reason: DiagramRefusal['reason'] } {
  if (svg.length > MAX_DIAGRAM_CHARS) return { reason: 'tooLarge' };
  const clean = sanitizeSvg(svg);
  if (!clean) return { reason: 'notSvg' };
  if ((clean.match(/<[a-zA-Z]/g) ?? []).length > MAX_DIAGRAM_ELEMENTS) return { reason: 'tooComplex' };
  // In an <img> it needs a size of its own: its width and height, or its viewBox's.
  const root = clean.match(/^<svg\b[^>]*>/)?.[0] ?? '';
  const sized = /\swidth="/.test(root) && /\sheight="/.test(root);
  const box = root.match(/\sviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
  if (sized) return { svg: clean };
  if (!box || !Number(box[1]) || !Number(box[2])) return { reason: 'noSize' };
  const tag = root.replace(/\s(?:width|height)="[^"]*"/g, '').replace(/^<svg\b/, `<svg width="${Number(box[1])}" height="${Number(box[2])}"`);
  return { svg: tag + clean.slice(root.length) };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every embed of the image at `from` pointed at `to` (both kinds of embed, alt text and size kept). */
export function renameImage(markdown: string, from: string, to: string) {
  const path = escape(from);
  return markdown
    .replace(new RegExp(`(!\\[\\[)${path}(?=[|#\\]])`, 'g'), `$1${to}`)
    .replace(new RegExp(`(!\\[[^\\]]*\\]\\(\\s*<?)${path}(?=\\s*>?\\s*(?:["')]))`, 'g'), `$1${to}`);
}

/** The embeds of the image at `path` taken out (a line that only held one goes with it). */
function removeImage(markdown: string, path: string) {
  const embed = `(?:!\\[\\[${escape(path)}(?:[|#][^\\]\\n]*)?\\]\\]|!\\[[^\\]]*\\]\\(\\s*<?${escape(path)}>?(?:\\s+["'][^\\n]*?["'])?\\s*\\))`;
  return markdown.replace(new RegExp(`^[ \\t]*${embed}[ \\t]*(?:\\r?\\n|$)`, 'gm'), '').replace(new RegExp(embed, 'g'), '');
}

/** Lines outside fenced code: where a raw `<svg>` the model wrote into the lesson could be. */
function outsideFences(markdown: string) {
  const spans: Array<{ start: number; end: number }> = [];
  let fence: string | null = null;
  let start = 0;
  let at = 0;
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1] ?? null;
    if (fence === null && marker) {
      spans.push({ start, end: at });
      fence = marker;
    } else if (fence !== null && marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) {
      fence = null;
      start = at + line.length + 1;
    }
    at += line.length + 1;
  }
  if (fence === null) spans.push({ start, end: markdown.length });
  return spans;
}

/**
 * Raw `<svg>` drawings the model put in the lesson although it was asked not to (outside code, on
 * lines of their own, and not already in the lesson): each becomes a file and an embed, its
 * `<title>` the alt text.
 */
function extractInlineSvgs(markdown: string, base: string, taken: Set<string>) {
  const found: Array<{ start: number; end: number; svg: string }> = [];
  for (const span of outsideFences(markdown)) {
    const text = markdown.slice(span.start, span.end);
    for (const match of Array.from(text.matchAll(/^ {0,3}(<svg\b[\s\S]*?<\/svg>)[ \t]*$/gim))) {
      if (base.includes(match[1])) continue;
      const start = span.start + (match.index ?? 0);
      found.push({ start, end: start + match[0].length, svg: match[1] });
    }
  }
  const diagrams = found.map((item) => {
    let n = 1;
    while (taken.has(`diagrams/diagram-${n}.svg`)) n += 1;
    taken.add(`diagrams/diagram-${n}.svg`);
    return { path: `diagrams/diagram-${n}.svg`, svg: item.svg };
  });
  let result = markdown;
  for (let index = found.length - 1; index >= 0; index -= 1) {
    const { start, end, svg } = found[index];
    const title = svg.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1].replace(/[[\]|\n]/g, ' ').trim();
    result = `${result.slice(0, start)}![[${diagrams[index].path}${title ? `|${title}` : ''}]]${result.slice(end)}`;
  }
  return { markdown: result, diagrams };
}

/**
 * A draft's diagrams as they're kept: each cleaned (`cleanDiagram`) and embedded in the Markdown;
 * a path the lesson or another open draft already uses gets a new name (`-2`), raw `<svg>` in the
 * Markdown becomes a file. What can't be kept is refused (and its embeds taken out of the Markdown):
 * the app drops it, the connector tells Claude why.
 */
export function cleanDraftDiagrams(input: { markdown: string; base: string; diagrams: DraftDiagram[]; taken?: Iterable<string> }) {
  const inBase = new Set(extractMarkdownImageReferences(input.base).map((reference) => reference.sourcePath));
  const taken = new Set(Array.from(inBase).concat(Array.from(input.taken ?? [])));
  const refused: DiagramRefusal[] = [];
  const inline = extractInlineSvgs(input.markdown, input.base, new Set(Array.from(taken).concat(input.diagrams.map((diagram) => diagram.path))));
  let markdown = inline.markdown;
  const embedded = new Set(extractMarkdownImageReferences(markdown).map((reference) => reference.sourcePath));
  const kept: DraftDiagram[] = [];
  const seen = new Set<string>();

  for (const diagram of [...input.diagrams, ...inline.diagrams]) {
    const path = diagram.path.trim();
    if (seen.has(path)) continue;
    seen.add(path);
    const refuse = (reason: DiagramRefusal['reason']) => {
      refused.push({ path, reason });
      // An image the lesson already shows stays (only a new embed of nothing goes).
      if (reason !== 'notEmbedded' && !inBase.has(path)) markdown = removeImage(markdown, path);
    };
    if (!DIAGRAM_PATH.test(path)) refuse('path');
    else if (!embedded.has(path)) refuse('notEmbedded');
    else if (kept.length >= MAX_DIAGRAMS) refuse('tooMany');
    else {
      const clean = cleanDiagram(diagram.svg);
      if ('reason' in clean) refuse(clean.reason);
      else kept.push({ path, svg: clean.svg });
    }
  }

  // A name already in use: the next free one, and the Markdown's embeds follow.
  const used = new Set(Array.from(taken).concat(kept.map((diagram) => diagram.path)));
  const diagrams = kept.map((diagram) => {
    if (!taken.has(diagram.path)) return diagram;
    const stem = diagram.path.replace(/\.svg$/, '');
    let n = 2;
    while (used.has(`${stem}-${n}.svg`)) n += 1;
    const path = `${stem}-${n}.svg`;
    used.add(path);
    markdown = renameImage(markdown, diagram.path, path);
    return { path, svg: diagram.svg };
  });
  return { markdown, diagrams, refused };
}
