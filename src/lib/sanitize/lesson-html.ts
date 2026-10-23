import { defaultSchema, sanitize, type Schema } from 'hast-util-sanitize';
import { visit } from 'unist-util-visit';
import { SVG_ELEMENTS, svgAttributes } from './svg';

/**
 * Raw HTML in a lesson (or any course Markdown), made safe before it's shown: learners read it,
 * and reviewers open drafts that AI or someone's Claude wrote. GitHub's allow-list (what Markdown
 * itself produces: tables, task lists, footnotes, code with its language, `<details>`, `<kbd>`…),
 * plus a few inline elements, inline SVG drawings (no `<style>`: it would restyle the whole page;
 * no embedded images), and video players from YouTube, Vimeo and Loom. Everything that runs goes:
 * scripts, event handlers, `javascript:` links, `style` attributes, forms, other frames.
 *
 * Runs right after raw HTML is parsed, before the renderer adds its own markup (callouts, code
 * headers, table wrappers), which is trusted and keeps its classes and styles.
 */

/** Video players a lesson may embed, and nothing else in a frame. */
const PLAYERS = [
  /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/[\w-]+(?:\?[\w=&%-]*)?$/,
  /^https:\/\/player\.vimeo\.com\/video\/\d+(?:\?[\w=&%-]*)?$/,
  /^https:\/\/www\.loom\.com\/embed\/[\w-]+(?:\?[\w=&%-]*)?$/,
];

export const LESSON_HTML_SCHEMA: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark', 'abbr', 'u', 'small', 'cite', 'figure', 'figcaption', 'iframe', ...SVG_ELEMENTS],
  attributes: {
    ...defaultSchema.attributes,
    ...svgAttributes({ style: false, images: false }),
    iframe: ['src', 'width', 'height', 'title', 'allow', 'allowFullScreen', 'loading'],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Images embedded as data (an image, so inert); frames are checked against the players below.
    src: ['http', 'https', 'data'],
  },
  strip: ['script', 'style', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set', 'object', 'embed'],
  // Footnote ids come prefixed from Markdown already, and a drawing's own ids are what its
  // `url(#…)` and `href="#…"` point to: raw HTML ids are prefixed below instead.
  clobberPrefix: '',
  clobber: [],
};

/** Prefix for ids and names written in raw HTML, so none can stand in for one of the page's own. */
const PREFIX = 'user-content-';
const DRAWING = new Set(SVG_ELEMENTS);

type Element = { type: 'element'; tagName: string; properties?: Record<string, unknown>; children?: unknown[] };

/**
 * The tree with only the allowed HTML left, frames kept only for the players (sandboxed, and loading
 * lazily), and `data:` sources only on images.
 */
export function sanitizeLessonTree<T>(tree: T): T {
  const clean = sanitize(tree as never, LESSON_HTML_SCHEMA) as unknown as { type: string; children?: unknown[] };
  visit(clean as never, 'element', (node: Element, index: number | undefined, parent: { children: unknown[] } | undefined) => {
    const properties = node.properties ?? {};
    if (!DRAWING.has(node.tagName)) {
      for (const key of ['id', 'name']) {
        const value = properties[key];
        if (typeof value === 'string' && value && !value.startsWith(PREFIX)) properties[key] = PREFIX + value;
      }
    }
    const src = typeof properties.src === 'string' ? properties.src : '';
    if (src.startsWith('data:') && !(node.tagName === 'img' && /^data:image\/(?:png|jpe?g|gif|webp);/i.test(src))) delete properties.src;
    if (node.tagName !== 'iframe') return;
    if (!PLAYERS.some((player) => player.test(src)) || !parent || index === undefined) {
      parent?.children.splice(index ?? 0, 1);
      return index;
    }
    node.properties = {
      ...properties,
      sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
      referrerPolicy: 'strict-origin-when-cross-origin',
      loading: 'lazy',
      allowFullScreen: true,
    };
  });
  return clean as T;
}
