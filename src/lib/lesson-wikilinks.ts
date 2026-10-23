import { visit } from 'unist-util-visit';

import { createSlugCandidate } from './slugs';

/**
 * Obsidian `[[wikilinks]]` in lesson markdown.
 *
 * Rendering never knows which lessons exist, so a wikilink becomes a link to a placeholder URL
 * (`remarkLessonWikilinks`). The placeholder survives the cached HTML and is resolved per request
 * (`resolveLessonWikilinks`) against the version's current lessons: a match becomes an in-page link
 * that opens that lesson, anything else (vault-only notes such as concepts) becomes plain text.
 * Renaming or adding a lesson therefore never leaves stale links in the cache.
 */

/** Synthetic origin; replaced by `resolveLessonWikilinks` at read time. */
export const LESSON_LINK_PLACEHOLDER_BASE = 'https://lesson-links.invalid/';

const WIKILINK_PATTERN = /!?\[\[([^[\]\n]+)\]\]/g;
const PLACEHOLDER_ANCHOR_PATTERN =
  /<a href="https:\/\/lesson-links\.invalid\/([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

export type WikilinkTarget = { alias: string | null; heading: string | null; target: string };

export function parseWikilink(inner: string): WikilinkTarget {
  const [linkPart, ...aliasParts] = inner.split('|');
  const alias = aliasParts.join('|').trim() || null;
  const [targetPart, ...headingParts] = (linkPart ?? '').split('#');
  const heading = headingParts.join('#').trim() || null;

  return { alias, heading, target: (targetPart ?? '').trim() };
}

/** What Obsidian shows for a link without an alias: `Note`, `Note > Heading`, or `Heading`. */
export function wikilinkLabel({ alias, heading, target }: WikilinkTarget) {
  if (alias) {
    return alias;
  }
  if (target && heading) {
    return `${target} > ${heading}`;
  }
  return target || heading || '';
}

/** Remark plugin: `[[Target#Heading|Alias]]` → link to a placeholder URL for `Target`. */
export function remarkLessonWikilinks() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
      if (!parent || typeof index !== 'number' || parent.type === 'link') {
        return;
      }

      const value = String(node.value ?? '');
      const pattern = new RegExp(WIKILINK_PATTERN);
      const children: any[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(value)) !== null) {
        const link = parseWikilink(match[1] ?? '');
        const label = wikilinkLabel(link);

        if (match.index > lastIndex) {
          children.push({ type: 'text', value: value.slice(lastIndex, match.index) });
        }

        // `[[#Heading]]` points inside the same note: keep just the text.
        children.push(
          link.target
            ? {
                type: 'link',
                url: `${LESSON_LINK_PLACEHOLDER_BASE}${encodeURIComponent(link.target)}`,
                data: { hProperties: { className: ['lesson-wikilink'] } },
                children: [{ type: 'text', value: label }],
              }
            : { type: 'text', value: label }
        );
        lastIndex = match.index + match[0].length;
      }

      if (!children.length) {
        return;
      }

      if (lastIndex < value.length) {
        children.push({ type: 'text', value: value.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}

export type LinkableLesson = { id: string; slug: string; title: string };

function normalizeTitle(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Finds the lesson a wikilink target names: by title (the note name), then by slug. A path
 * (`Lesson 2/Intro`) matches on its last segment, like Obsidian's shortest-path links.
 */
export function findLinkedLesson<T extends LinkableLesson>(target: string, lessons: T[]) {
  const name = target.split('/').pop() ?? target;
  const byTitle = normalizeTitle(name.replace(/\.md$/i, ''));
  const bySlug = createSlugCandidate(name.replace(/\.md$/i, ''), '');

  return (
    lessons.find((lesson) => normalizeTitle(lesson.title) === byTitle) ??
    (bySlug ? lessons.find((lesson) => lesson.slug === bySlug) : undefined) ??
    null
  );
}

/** DOM id of a lesson in the learner accordion; resolved wikilinks point at it. */
export function lessonAnchorId(lessonId: string) {
  return `lesson-${lessonId}`;
}

/** Replaces wikilink placeholders in rendered lesson HTML with lesson links or plain text. */
export function resolveLessonWikilinks(html: string, lessons: LinkableLesson[]) {
  if (!html.includes(LESSON_LINK_PLACEHOLDER_BASE)) {
    return html;
  }

  return html.replace(PLACEHOLDER_ANCHOR_PATTERN, (_match, encodedTarget: string, inner: string) => {
    let target = encodedTarget;
    try {
      target = decodeURIComponent(encodedTarget);
    } catch {
      // Keep the raw value; it simply won't match a lesson.
    }

    const lesson = findLinkedLesson(target, lessons);

    return lesson
      ? `<a href="#${lessonAnchorId(lesson.id)}" class="lesson-wikilink" data-lesson-link="${lesson.id}">${inner}</a>`
      : inner;
  });
}

/** Fenced code blocks (closed, or open to the end) and inline code: wikilinks there are code, not links. */
const MARKDOWN_CODE_PATTERN = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))|`[^`\n]+`/gm;

/** Applies `transform` to the prose of a Markdown document, leaving code untouched. */
function mapMarkdownProse(markdown: string, transform: (prose: string) => string) {
  const pattern = new RegExp(MARKDOWN_CODE_PATTERN);
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    result += transform(markdown.slice(lastIndex, match.index)) + match[0];
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }
  }

  return result + transform(markdown.slice(lastIndex));
}

/**
 * The Markdown counterpart of `resolveLessonWikilinks`, for readers that render Markdown
 * themselves: `[[Lesson|Label]]` becomes `[Label](href(lesson))`, and links to anything that isn't
 * a lesson (vault-only notes such as concepts) become their plain label.
 */
export function resolveMarkdownWikilinks<T extends LinkableLesson>(
  markdown: string,
  lessons: T[],
  href: (lesson: T) => string
) {
  if (!markdown.includes('[[')) {
    return markdown;
  }

  return mapMarkdownProse(markdown, (prose) =>
    prose.replace(new RegExp(WIKILINK_PATTERN), (_match, inner: string) => {
      const link = parseWikilink(inner);
      const label = wikilinkLabel(link);
      const lesson = link.target ? findLinkedLesson(link.target, lessons) : null;

      return lesson ? `[${label.replace(/([[\]])/g, '\\$1')}](${href(lesson)})` : label;
    })
  );
}
