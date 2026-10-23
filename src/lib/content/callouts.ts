import { visit } from 'unist-util-visit';

/**
 * Obsidian callouts (`> [!type] Title`) for content entries (blog posts, projects) and lessons.
 * Two parts:
 * - `extractAbstractCallout` lifts the first `[!abstract]` (or `[!summary]` / `[!tldr]`) callout
 *   out of the markdown so it can serve as the entry's description and lead;
 * - `transformObsidianCallouts` renders every other callout like Obsidian does: coloured box, icon,
 *   title, and `<details>` for foldable ones (`[!note]-` collapsed, `[!note]+` open). Two layout
 *   types are not boxes: `[!columns]` lays its nested `[!column]` callouts side by side
 *   (`[!column|58]` = 58% wide), matching the Site Sync plugin's styles in Obsidian.
 */

const ABSTRACT_TYPES = new Set(['abstract', 'summary', 'tldr']);
const MAX_ABSTRACT_LENGTH = 500;

type IconShape = [tag: string, attributes: Record<string, string>];

/** Lucide icons (ISC licence), as used by Obsidian. */
const ICONS: Record<string, IconShape[]> = {
  pencil: [['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }], ['path', { d: 'm15 5 4 4' }]],
  info: [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
  clipboard: [
    ['rect', { width: '8', height: '4', x: '8', y: '2', rx: '1', ry: '1' }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'M12 11h4' }],
    ['path', { d: 'M12 16h4' }],
    ['path', { d: 'M8 11h.01' }],
    ['path', { d: 'M8 16h.01' }],
  ],
  circleCheck: [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'm9 12 2 2 4-4' }]],
  flame: [
    [
      'path',
      {
        d: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
      },
    ],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  help: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  alert: [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  x: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
  zap: [['path', { d: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z' }]],
  bug: [
    ['path', { d: 'm8 2 1.88 1.88' }],
    ['path', { d: 'M14.12 3.88 16 2' }],
    ['path', { d: 'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1' }],
    ['path', { d: 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6' }],
    ['path', { d: 'M12 20v-9' }],
  ],
  list: [
    ['path', { d: 'M3 12h.01' }],
    ['path', { d: 'M3 18h.01' }],
    ['path', { d: 'M3 6h.01' }],
    ['path', { d: 'M8 12h13' }],
    ['path', { d: 'M8 18h13' }],
    ['path', { d: 'M8 6h13' }],
  ],
  quote: [
    ['path', { d: 'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z' }],
    ['path', { d: 'M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z' }],
  ],
};

/** Obsidian's default colours (RGB) and icons per callout type, including aliases. */
const STYLES: Record<string, { color: string; icon: keyof typeof ICONS }> = {
  note: { color: '8, 109, 221', icon: 'pencil' },
  info: { color: '8, 109, 221', icon: 'info' },
  todo: { color: '8, 109, 221', icon: 'circleCheck' },
  abstract: { color: '0, 191, 188', icon: 'clipboard' },
  tip: { color: '0, 191, 188', icon: 'flame' },
  success: { color: '8, 185, 78', icon: 'check' },
  question: { color: '236, 117, 0', icon: 'help' },
  warning: { color: '236, 117, 0', icon: 'alert' },
  failure: { color: '233, 49, 71', icon: 'x' },
  danger: { color: '233, 49, 71', icon: 'zap' },
  bug: { color: '233, 49, 71', icon: 'bug' },
  example: { color: '120, 82, 238', icon: 'list' },
  quote: { color: '158, 158, 158', icon: 'quote' },
};

const ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

function calloutStyle(type: string) {
  return STYLES[ALIASES[type] ?? type] ?? STYLES.note;
}

function defaultTitle(type: string) {
  return type === 'tldr' ? 'TL;DR' : type.charAt(0).toUpperCase() + type.slice(1).replace(/[-_]+/g, ' ');
}

// ---------------------------------------------------------------------------------------------
// Abstract extraction (markdown level)
// ---------------------------------------------------------------------------------------------

const CALLOUT_HEADER = /^>\s*\[!([\w-]+)(?:\|[^\]]*)?\]([+-]?)\s*(.*)$/;

/** Markdown → plain text for a description: keeps link/embed text, drops formatting. */
function toPlainText(markdown: string) {
  return markdown
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 40)).trimEnd()}…`;
}

/**
 * Finds the first top-level `[!abstract]` / `[!summary]` / `[!tldr]` callout (outside code fences),
 * removes it from the markdown and returns its text. With no body, the callout title is used.
 */
export function extractAbstractCallout(markdown: string): { markdown: string; abstract: string | null } {
  const lines = markdown.split('\n');
  let inFence = false;

  for (let start = 0; start < lines.length; start += 1) {
    const line = lines[start];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const header = inFence ? null : CALLOUT_HEADER.exec(line);
    if (!header || !ABSTRACT_TYPES.has(header[1].toLowerCase())) {
      continue;
    }

    let end = start + 1;
    while (end < lines.length && /^>/.test(lines[end])) {
      end += 1;
    }

    const body = lines
      .slice(start + 1, end)
      .map((bodyLine) => bodyLine.replace(/^>\s?/, ''))
      .join('\n');
    const abstract = truncate(toPlainText(body) || toPlainText(header[3]), MAX_ABSTRACT_LENGTH);

    if (!abstract) {
      return { markdown, abstract: null };
    }

    // Drop the callout and one blank line after it, so the body doesn't start with a gap.
    const removeUntil = end < lines.length && !lines[end].trim() ? end + 1 : end;
    return {
      markdown: [...lines.slice(0, start), ...lines.slice(removeUntil)].join('\n'),
      abstract,
    };
  }

  return { markdown, abstract: null };
}

// ---------------------------------------------------------------------------------------------
// Callout rendering (HAST level)
// ---------------------------------------------------------------------------------------------

/** `[!type|metadata]+ ` — metadata (Obsidian's `data-callout-metadata`) and fold are optional. */
const HEADER_TEXT = /^\[!([\w-]+)(?:\|([^\]]*))?\]([+-]?)[ \t]*/;

/** `[!column|58]` → `flex: 0 0 58%`; anything else shares the row equally. */
function columnStyle(metadata: string | undefined) {
  const percent = Number(metadata?.trim().replace(/%$/, ''));
  return Number.isFinite(percent) && percent > 0 && percent < 100 ? { style: `flex: 0 0 ${percent}%` } : {};
}

function element(tagName: string, properties: Record<string, unknown>, children: any[] = []): any {
  return { type: 'element', tagName, properties, children };
}

function iconNode(type: string) {
  return element(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
      width: '18',
      height: '18',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      ariaHidden: 'true',
    },
    ICONS[calloutStyle(type).icon].map(([tag, attributes]) => element(tag, attributes))
  );
}

function isBlank(node: any) {
  return node.type === 'text' && !node.value.trim();
}

/**
 * Splits the first paragraph of a callout blockquote into its title (rest of the header line, inline
 * formatting kept) and body (everything after the first line break).
 */
function splitHeader(paragraph: any, header: RegExpExecArray) {
  const first = paragraph.children[0];
  first.value = first.value.slice(header[0].length);

  const title: any[] = [];
  const children = [...paragraph.children];
  let index = 0;

  for (; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === 'text' && child.value.includes('\n')) {
      const newline = child.value.indexOf('\n');
      const before = child.value.slice(0, newline);
      if (before) {
        title.push({ type: 'text', value: before });
      }
      child.value = child.value.slice(newline + 1);
      break;
    }
    if (child.type === 'element' && child.tagName === 'br') {
      index += 1;
      break;
    }
    title.push(child);
  }

  paragraph.children = children.slice(index).filter((child: any) => !(child.type === 'text' && child.value === ''));
  // Blank text at either end of the title goes; the spaces between inline parts ("Run `npm test` **first**") stay.
  while (title.length && isBlank(title[0])) title.shift();
  while (title.length && isBlank(title[title.length - 1])) title.pop();
  return title;
}

/** Rewrites `> [!type]` blockquotes into Obsidian-style callouts (nested callouts included). */
export function transformObsidianCallouts(tree: any) {
  visit(tree, 'element', (node: any) => {
    if (node.tagName !== 'blockquote') {
      return;
    }

    const paragraph = node.children.find((child: any) => !isBlank(child));
    const firstText = paragraph?.tagName === 'p' ? paragraph.children[0] : null;
    const header = firstText?.type === 'text' ? HEADER_TEXT.exec(firstText.value) : null;
    if (!paragraph || !header) {
      return;
    }

    const type = header[1].toLowerCase();
    const metadata = header[2];
    const fold = header[3];

    if (type === 'columns' || type === 'column') {
      // Layout only: drop the header line (a title on it is ignored) and keep the body.
      splitHeader(paragraph, header);
      node.tagName = 'div';
      node.properties = { className: [type], ...(type === 'column' ? columnStyle(metadata) : {}) };
      node.children = node.children.filter(
        (child: any) => child !== paragraph || paragraph.children.some((c: any) => !isBlank(c))
      );
      return;
    }

    let title = splitHeader(paragraph, header);
    if (title.length === 0) {
      title = [{ type: 'text', value: defaultTitle(type) }];
    }

    const body = node.children.filter(
      (child: any) => child !== paragraph || paragraph.children.some((c: any) => !isBlank(c))
    );
    const titleNode = element(fold ? 'summary' : 'div', { className: ['callout-title'] }, [
      element('span', { className: ['callout-icon'] }, [iconNode(type)]),
      element('span', { className: ['callout-title-inner'] }, title),
    ]);
    const content = body.some((child: any) => !isBlank(child))
      ? [element('div', { className: ['callout-content'] }, body)]
      : [];

    // Mutate in place so `visit` still descends into the body (nested callouts).
    node.tagName = fold ? 'details' : 'div';
    node.properties = {
      className: ['callout'],
      dataCallout: type,
      style: `--callout-color: ${calloutStyle(type).color}`,
      ...(fold === '+' ? { open: true } : {}),
    };
    node.children = [titleNode, ...content];
  });
}
