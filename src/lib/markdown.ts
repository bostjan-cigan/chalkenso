import { unified } from 'unified';
import { toHtml } from 'hast-util-to-html';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';

import { remarkLessonWikilinks } from './lesson-wikilinks';
import { sanitizeLessonTree } from './sanitize/lesson-html';

export { COURSE_MARKDOWN_RENDER_VERSION } from './markdown-version';


function getNodeClassNames(node: any) {
  const className = node?.properties?.className;

  if (!className) {
    return [];
  }

  return Array.isArray(className) ? className : [className];
}

function getCodeLanguageLabel(classNames: string[]) {
  const languageClassName = classNames.find((className) =>
    String(className).startsWith('language-')
  );

  if (!languageClassName) {
    return 'code';
  }

  return String(languageClassName).replace(/^language-/, '') || 'code';
}

export function renderMarkdownToHtml(content: string) {
  if (!content.trim()) {
    return '';
  }

  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHtml)
    .processSync(content)
    .toString();
}

export type CourseMarkdownRenderOptions = {
  /**
   * Extra HAST transforms run right after raw HTML is parsed (e.g. Obsidian callouts for content
   * entries). Lessons pass none, so their output is unchanged.
   */
  hastTransforms?: ((tree: any) => void)[];
  /**
   * HAST transforms run after code is highlighted (which replaces what's inside `<code>`), before
   * code blocks and tables get their wrappers: for marks that have to survive in code too.
   */
  afterHighlight?: ((tree: any) => void)[];
  /**
   * Turn Obsidian `[[wikilinks]]` into placeholder links (see `lesson-wikilinks.ts`), to be resolved
   * against the version's lessons at read time. Lessons only.
   */
  wikilinks?: boolean;
};

export function renderCourseMarkdownToHtml(
  content: string,
  options: CourseMarkdownRenderOptions = {}
) {
  if (!content.trim()) {
    return '';
  }

  const hastTransforms = options.hastTransforms ?? [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(options.wikilinks ? remarkLessonWikilinks : () => undefined)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    // Raw HTML in the Markdown keeps only what can't run (`sanitize/lesson-html.ts`); the markup
    // added below (callouts, code headers, wrappers) is the renderer's own.
    .use(() => (hastTree: any) => {
      hastTree.children = sanitizeLessonTree(hastTree).children;
    })
    .use(() => (hastTree: any) => {
      for (const transform of hastTransforms) {
        transform(hastTree);
      }
    })
    .use(rehypeHighlight)
    .use(() => (hastTree: any) => {
      for (const transform of options.afterHighlight ?? []) {
        transform(hastTree);
      }
    })
    .use(() => (hastTree: any) => {
      visit(hastTree, 'element', (node: any, index: number | undefined, parent: any) => {
        if (node.tagName === 'code' && parent?.tagName !== 'pre') {
          node.properties = {
            ...(node.properties ?? {}),
            className: [...getNodeClassNames(node), 'lesson-inline-code'],
          };
        }

        if (node.tagName === 'table' && parent && typeof index === 'number') {
          parent.children[index] = {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['lesson-table-scroll'],
            },
            children: [node],
          };
          return;
        }

        if (!parent || typeof index !== 'number' || node.tagName !== 'pre') {
          return;
        }

        const codeNode = node.children?.find((child: any) => child.tagName === 'code');

        if (!codeNode) {
          return;
        }

        const classNames = getNodeClassNames(codeNode);
        const languageLabel = getCodeLanguageLabel(classNames);

        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['lesson-code-block'],
            /* Inline so width isn’t lost to CSS module ordering / client hydration quirks */
            style:
              'width:768px;max-width:100%;box-sizing:border-box;min-width:0',
          },
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['lesson-code-header'],
              },
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: {
                    className: ['lesson-code-language'],
                  },
                  children: [
                    {
                      type: 'text',
                      value: languageLabel,
                    },
                  ],
                },
              ],
            },
            {
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['lesson-code-scroll'],
              },
              children: [node],
            },
          ],
        };
      });
    });

  const hastTree = processor.runSync(processor.parse(content)) as any;

  return toHtml(hastTree);
}
