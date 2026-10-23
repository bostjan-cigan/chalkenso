/**
 * Finding a quoted passage in rendered content: the learner pages' annotations and the lesson's
 * Improve view (the feedback's passages marked in the lesson) turn a stored quote into a live DOM
 * Range, across inline elements. Browser only.
 */

/** Collapse runs of whitespace to a single space (matches how selection text reads). */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

type IndexEntry = { node: Text; offset: number };

/**
 * Builds a whitespace-normalized string of a root's text plus a map from each normalized character
 * back to its raw (text node, offset), so a stored quote can be turned into a live DOM Range even
 * across inline elements. Used to re-locate an annotation's passage for highlighting.
 */
export function buildTextIndex(root: HTMLElement): { text: string; map: IndexEntry[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  const map: IndexEntry[] = [];
  let prevWasSpace = true;

  let current = walker.nextNode() as Text | null;
  while (current) {
    const raw = current.data;
    for (let i = 0; i < raw.length; i += 1) {
      const isSpace = /\s/.test(raw[i]);
      if (isSpace) {
        if (!prevWasSpace) {
          text += ' ';
          map.push({ node: current, offset: i });
          prevWasSpace = true;
        }
      } else {
        text += raw[i];
        map.push({ node: current, offset: i });
        prevWasSpace = false;
      }
    }
    current = walker.nextNode() as Text | null;
  }

  return { text, map };
}

/** Locates a quote in the content and returns a DOM Range spanning it, or null if not found. */
export function findQuoteRange(root: HTMLElement, quote: string, index?: { text: string; map: IndexEntry[] }): Range | null {
  const needle = normalizeWhitespace(quote);
  if (!needle) {
    return null;
  }
  const { text, map } = index ?? buildTextIndex(root);
  const start = text.indexOf(needle);
  if (start === -1) {
    return null;
  }
  const end = start + needle.length;
  const startEntry = map[start];
  const lastEntry = map[end - 1];
  if (!startEntry || !lastEntry) {
    return null;
  }
  const range = document.createRange();
  range.setStart(startEntry.node, startEntry.offset);
  range.setEnd(lastEntry.node, Math.min(lastEntry.offset + 1, lastEntry.node.data.length));
  return range;
}
