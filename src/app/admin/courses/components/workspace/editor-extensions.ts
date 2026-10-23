import { Extension, Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type MarkdownIt from 'markdown-it';

/**
 * Editor extensions that keep a lesson's Markdown (the format Obsidian sync and the learner pages
 * use) intact while people edit it visually: Obsidian links (`[[Lesson]]`), image embeds
 * (`![[photo.png]]`) and callouts (`> [!tip] Title`), plus highlights for notes in the margin.
 */

/** Resolves a lesson image path (`photo.png`, `images/a.png`) to a URL the browser can show. */
export type AssetResolver = (sourcePath: string) => string | null;

/** Fired on `window` when lesson images finish uploading, so image views re-resolve their URLs. */
export const ASSETS_UPDATED_EVENT = 'lesson-assets-updated';

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type MarkdownItWithFlag = MarkdownIt & { __obsidianInline?: boolean };

/** `[[target|alias]]` and `![[file|size]]` as markdown-it inline tokens (added once per parser). */
function addObsidianInline(md: MarkdownIt) {
  const flagged = md as MarkdownItWithFlag;
  if (flagged.__obsidianInline) return;
  flagged.__obsidianInline = true;

  md.inline.ruler.before('link', 'obsidian_wiki', (state, silent) => {
    const { src, pos } = state;
    const isEmbed = src.charCodeAt(pos) === 0x21 && src.startsWith('[[', pos + 1);
    if (!isEmbed && !src.startsWith('[[', pos)) return false;
    const start = pos + (isEmbed ? 3 : 2);
    const end = src.indexOf(']]', start);
    if (end < 0) return false;
    const inner = src.slice(start, end);
    if (!inner.trim() || inner.includes('\n') || inner.includes('[')) return false;
    if (!silent) {
      const bar = inner.indexOf('|');
      const token = state.push(isEmbed ? 'obsidian_embed' : 'obsidian_link', '', 0);
      token.meta = {
        target: (bar < 0 ? inner : inner.slice(0, bar)).trim(),
        extra: bar < 0 ? '' : inner.slice(bar + 1).trim(),
      };
    }
    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.obsidian_link = (tokens, index) => {
    const { target, extra } = tokens[index].meta as { target: string; extra: string };
    return `<span data-wikilink="${escapeAttribute(target)}" data-alias="${escapeAttribute(extra)}">${escapeAttribute(extra || target)}</span>`;
  };
  md.renderer.rules.obsidian_embed = (tokens, index) => {
    const { target, extra } = tokens[index].meta as { target: string; extra: string };
    return `<span data-embed="${escapeAttribute(target)}" data-size="${escapeAttribute(extra)}"></span>`;
  };
}

/** Words the extensions show (the editor gives them in the page's language; English by default). */
const linkTo = (target: string) => `Link to “${target}”`;
const imageMissing = (label: string) => `Image: ${label} (upload it below)`;

/** `[[Other lesson]]`: a link to another lesson (or note) by title. */
export const WikiLink = Node.create<{ title: (target: string) => string }>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { title: linkTo };
  },

  addAttributes() {
    return {
      target: { default: '', parseHTML: (el) => el.getAttribute('data-wikilink') ?? '', renderHTML: () => ({}) },
      alias: { default: '', parseHTML: (el) => el.getAttribute('data-alias') ?? '', renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': node.attrs.target,
        class: 'ws-wikilink',
        title: this.options.title(String(node.attrs.target)),
      }),
      node.attrs.alias || node.attrs.target,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: PMNode) {
          state.write(`[[${node.attrs.target}${node.attrs.alias ? `|${node.attrs.alias}` : ''}]]`);
        },
        parse: {
          setup(md: MarkdownIt) {
            addObsidianInline(md);
          },
        },
      },
    };
  },
});

function renderImageView(dom: HTMLElement, url: string | null, label: string, missing: (label: string) => string, size?: string) {
  dom.replaceChildren();
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = label;
    if (size && /^\d+$/.test(size)) img.style.maxWidth = `${size}px`;
    dom.append(img);
  } else {
    const chip = document.createElement('span');
    chip.className = 'ws-image-missing';
    chip.textContent = missing(label);
    dom.append(chip);
  }
}

type ImageOptions = { resolve: AssetResolver; missing: (label: string) => string };

/** `![[photo.png]]`: an Obsidian image embed, shown as the image once it's uploaded. */
export const ObsidianEmbed = Node.create<ImageOptions>({
  name: 'obsidianEmbed',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { resolve: () => null, missing: imageMissing };
  },

  addAttributes() {
    return {
      target: { default: '', parseHTML: (el) => el.getAttribute('data-embed') ?? '', renderHTML: () => ({}) },
      size: { default: '', parseHTML: (el) => el.getAttribute('data-size') ?? '', renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-embed]' }];
  },

  renderHTML({ node }) {
    return ['span', { 'data-embed': node.attrs.target, 'data-size': node.attrs.size }];
  },

  addNodeView() {
    const { resolve, missing } = this.options;
    return ({ node: initialNode }) => {
      let node = initialNode;
      const dom = document.createElement('span');
      dom.className = 'ws-embed';
      const draw = () => {
        const target = String(node.attrs.target);
        const url = IMAGE_FILE.test(target) ? resolve(target) : null;
        renderImageView(dom, url, target, missing, String(node.attrs.size));
      };
      draw();
      window.addEventListener(ASSETS_UPDATED_EVENT, draw);
      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          draw();
          return true;
        },
        destroy() {
          window.removeEventListener(ASSETS_UPDATED_EVENT, draw);
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: PMNode) {
          state.write(`![[${node.attrs.target}${node.attrs.size ? `|${node.attrs.size}` : ''}]]`);
        },
        parse: {
          setup(md: MarkdownIt) {
            addObsidianInline(md);
          },
        },
      },
    };
  },
});

/** Standard `![alt](path)` images; relative paths show the uploaded file, the Markdown keeps the path. */
export const LessonImage = Image.extend<ImageOptions>({
  addOptions() {
    return { ...this.parent?.(), inline: true, resolve: () => null, missing: imageMissing };
  },

  addNodeView() {
    const { resolve, missing } = this.options;
    return ({ node: initialNode }) => {
      let node = initialNode;
      const dom = document.createElement('span');
      dom.className = 'ws-embed';
      const draw = () => {
        const src = String(node.attrs.src ?? '');
        const url = /^(https?:|data:|\/)/.test(src) ? src : resolve(src);
        renderImageView(dom, url, String(node.attrs.alt || src), missing);
      };
      draw();
      window.addEventListener(ASSETS_UPDATED_EVENT, draw);
      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          draw();
          return true;
        },
        destroy() {
          window.removeEventListener(ASSETS_UPDATED_EVENT, draw);
        },
      };
    };
  },
});

/** A callout's label in the editor when it has no title of its own (English; the editor passes its language's). */
const CALLOUT_LABELS = {
  note: 'Note',
  tip: 'Tip',
  hint: 'Tip',
  important: 'Important',
  info: 'Info',
  warning: 'Warning',
  caution: 'Warning',
  danger: 'Danger',
  example: 'Example',
  question: 'Question',
  success: 'Done',
  check: 'Check',
  quote: 'Quote',
  abstract: 'Summary',
  summary: 'Summary',
} as const;

export type CalloutType = keyof typeof CALLOUT_LABELS;

/** Colour family for a callout type: tip and success are green, warnings yellow, danger red. */
function calloutTone(type: string) {
  if (['tip', 'hint', 'success', 'check', 'done'].includes(type)) return 'tip';
  if (['warning', 'caution', 'attention', 'important'].includes(type)) return 'warning';
  if (['danger', 'error', 'bug', 'failure', 'fail'].includes(type)) return 'danger';
  return 'note';
}

export function calloutLabel(type: string, title: string, label: (type: CalloutType) => string = (known) => CALLOUT_LABELS[known]) {
  const known = Object.prototype.hasOwnProperty.call(CALLOUT_LABELS, type) ? label(type as CalloutType) : '';
  return title || known || type.charAt(0).toUpperCase() + type.slice(1);
}

type SerializerState = {
  write: (text: string) => void;
  ensureNewLine: () => void;
  wrapBlock: (delim: string, firstDelim: string | null, node: PMNode, f: () => void) => void;
  renderContent: (node: PMNode) => void;
};

/** `> [!tip] Check your work`: an Obsidian callout box. */
export const Callout = Node.create<{ label: (type: CalloutType) => string }>({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { label: (type) => CALLOUT_LABELS[type] };
  },

  addAttributes() {
    return {
      type: { default: 'tip', parseHTML: (el) => el.getAttribute('data-callout') ?? 'note', renderHTML: () => ({}) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') ?? '', renderHTML: () => ({}) },
      fold: { default: '', parseHTML: (el) => el.getAttribute('data-fold') ?? '', renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node }) {
    const type = String(node.attrs.type);
    return [
      'div',
      {
        'data-callout': type,
        'data-label': calloutLabel(type, String(node.attrs.title), this.options.label),
        class: `ws-callout ws-callout-${calloutTone(type)}`,
      },
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          const header = `[!${node.attrs.type}]${node.attrs.fold ?? ''}${node.attrs.title ? ` ${node.attrs.title}` : ''}`;
          state.wrapBlock('> ', null, node, () => {
            state.write(header);
            state.ensureNewLine();
            state.renderContent(node);
          });
        },
        parse: {
          // markdown-it gives a blockquote whose first line is "[!type] Title"; turn it into a callout.
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('blockquote').forEach((quote) => {
              const first = quote.firstElementChild;
              if (!first || first.tagName !== 'P') return;
              const match = first.innerHTML.match(/^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n([\s\S]*))?$/);
              if (!match) return;
              const callout = document.createElement('div');
              callout.setAttribute('data-callout', match[1].toLowerCase());
              callout.setAttribute('data-fold', match[2]);
              const title = document.createElement('span');
              title.innerHTML = match[3];
              callout.setAttribute('data-title', (title.textContent ?? '').trim());
              const rest = (match[4] ?? '').trim();
              if (rest) {
                first.innerHTML = rest;
              } else {
                first.remove();
              }
              while (quote.firstChild) callout.append(quote.firstChild);
              if (!callout.children.length) callout.append(document.createElement('p'));
              quote.replaceWith(callout);
            });
          },
        },
      },
    };
  },
});

// -------------------------------------------------------------------------------------------------
// Note highlights: passages with instructor notes or learner feedback, marked like a highlighter
// -------------------------------------------------------------------------------------------------

export type HighlightNote = { id: string; text: string; kind: 'instructor' | 'learner' };

type HighlightState = { notes: HighlightNote[]; activeId: string | null; decorations: DecorationSet };

export const noteHighlightKey = new PluginKey<HighlightState>('noteHighlights');

function normalise(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

/** Finds `needle` inside one text block and returns document positions, or null. */
function findInBlock(block: PMNode, blockPos: number, needle: string): { from: number; to: number } | null {
  // Map each character of the block's text to its document position (atoms add no text).
  const chars: number[] = [];
  let text = '';
  block.descendants((child, pos) => {
    if (child.isText && child.text) {
      for (let i = 0; i < child.text.length; i += 1) {
        const ch = child.text[i];
        const isSpace = /\s/.test(ch);
        if (isSpace && (text.endsWith(' ') || text.length === 0)) continue;
        text += isSpace ? ' ' : ch;
        chars.push(blockPos + 1 + pos + i);
      }
    }
    return true;
  });
  const index = text.indexOf(needle);
  if (index < 0) return null;
  return { from: chars[index], to: chars[index + needle.length - 1] + 1 };
}

function buildDecorations(doc: PMNode, notes: HighlightNote[], activeId: string | null) {
  const decorations: Decoration[] = [];
  for (const note of notes) {
    const full = normalise(note.text);
    if (!full) continue;
    // Long selections can span blocks: fall back to their first sentence-sized piece.
    const candidates = [full, full.slice(0, 80)];
    let found: { from: number; to: number } | null = null;
    for (const needle of candidates) {
      doc.descendants((node, pos) => {
        if (found) return false;
        if (node.isTextblock) {
          found = findInBlock(node, pos, needle);
          return false;
        }
        return true;
      });
      if (found) break;
    }
    if (!found) continue;
    const { from, to } = found;
    decorations.push(
      Decoration.inline(from, to, {
        class: `ws-note ws-note-${note.kind}${note.id === activeId ? ' ws-note-active' : ''}`,
        'data-note-id': note.id,
      })
    );
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Highlights noted passages. Update with
 * `tr.setMeta(noteHighlightKey, { notes, activeId })`; clicking a highlight calls `onActivate`.
 */
export const NoteHighlights = Extension.create<{ onActivate: (id: string) => void }>({
  name: 'noteHighlights',

  addOptions() {
    return { onActivate: () => {} };
  },

  addProseMirrorPlugins() {
    const onActivate = this.options.onActivate;
    return [
      new Plugin<HighlightState>({
        key: noteHighlightKey,
        state: {
          init: (_, state) => ({ notes: [], activeId: null, decorations: DecorationSet.create(state.doc, []) }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(noteHighlightKey) as { notes?: HighlightNote[]; activeId?: string | null } | undefined;
            if (meta) {
              const notes = meta.notes ?? value.notes;
              const activeId = meta.activeId === undefined ? value.activeId : meta.activeId;
              return { notes, activeId, decorations: buildDecorations(newState.doc, notes, activeId) };
            }
            if (tr.docChanged) {
              return { ...value, decorations: buildDecorations(newState.doc, value.notes, value.activeId) };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return noteHighlightKey.getState(state)?.decorations;
          },
          handleClick(view, _pos, event) {
            const target = (event.target as HTMLElement | null)?.closest?.('[data-note-id]');
            const id = target?.getAttribute('data-note-id');
            if (id) {
              onActivate(id);
            }
            return false;
          },
        },
      }),
    ];
  },
});

// -------------------------------------------------------------------------------------------------
// Review marks: where a proposed change goes, and the changes applied but not saved yet
// -------------------------------------------------------------------------------------------------

/** Paragraphs to mark, by their plain text: `outline` where the change under review goes, `applied` what went in. */
export type ReviewMarks = { outline: string[]; applied: string[] };

type ReviewMarksState = ReviewMarks & { decorations: DecorationSet };

export const reviewMarksKey = new PluginKey<ReviewMarksState>('reviewMarks');

/** Text compared without spacing or case: the editor's blocks and the Markdown's plain text line up. */
const squash = (text: string) => text.replace(/\s+/g, '').toLowerCase();

function buildReviewMarks(doc: PMNode, marks: ReviewMarks) {
  const decorations: Decoration[] = [];
  const mark = (texts: string[], className: string) => {
    const wanted = texts.map(squash).filter(Boolean);
    if (!wanted.length) return;
    doc.forEach((node, offset) => {
      const text = squash(node.textContent);
      if (!text) return;
      if (wanted.some((needle) => text === needle || (needle.length > 24 && text.includes(needle)) || (text.length > 24 && needle.includes(text)))) {
        decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: className }));
      }
    });
  };
  mark(marks.applied, 'ws-change-applied');
  mark(marks.outline, 'ws-change-outline');
  return DecorationSet.create(doc, decorations);
}

/**
 * Marks whole paragraphs during a review and after Apply. Update with
 * `tr.setMeta(reviewMarksKey, { outline, applied })`; marks follow the text as it is edited.
 */
export const ReviewMarksExtension = Extension.create({
  name: 'reviewMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<ReviewMarksState>({
        key: reviewMarksKey,
        state: {
          init: (_, state) => ({ outline: [], applied: [], decorations: DecorationSet.create(state.doc, []) }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(reviewMarksKey) as Partial<ReviewMarks> | undefined;
            if (meta) {
              const next = { outline: meta.outline ?? value.outline, applied: meta.applied ?? value.applied };
              return { ...next, decorations: buildReviewMarks(newState.doc, next) };
            }
            if (tr.docChanged && (value.outline.length || value.applied.length)) {
              return { ...value, decorations: buildReviewMarks(newState.doc, value) };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return reviewMarksKey.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
