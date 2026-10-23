import { visit } from 'unist-util-visit';
import { IMAGE_SIZE_TITLE_PREFIX } from '../course-markdown';

/**
 * Image layout for content entries (HAST level), mirroring how Obsidian shows a note:
 * - `transformImageSizes`: `![[x.png|320]]` keeps its width (carried as an image title by
 *   `resolveLessonMarkdownAssetUrls` with `keepImageSize`);
 * - `transformImageRows`: two or more images on one line become one centred row (`p.image-row`),
 *   like the README trick of several `<img>` in a `<p align="center">`.
 */

export function transformImageSizes(tree: any) {
  visit(tree, 'element', (node: any) => {
    const title = node.tagName === 'img' ? node.properties?.title : null;
    if (typeof title !== 'string' || !title.startsWith(IMAGE_SIZE_TITLE_PREFIX)) {
      return;
    }

    const width = title.slice(IMAGE_SIZE_TITLE_PREFIX.length).split('x')[0];
    delete node.properties.title;
    // Inline style beats the stylesheet's `width: auto`; `max-width: 100%` still caps it.
    node.properties.style = `width: ${width}px`;
  });
}

function isBlank(node: any) {
  return node.type === 'text' && !node.value.trim();
}

export function transformImageRows(tree: any) {
  visit(tree, 'element', (node: any) => {
    if (node.tagName !== 'p') {
      return;
    }

    const content = node.children.filter((child: any) => !isBlank(child) && child.tagName !== 'br');
    const onlyImages = content.length >= 2 && content.every((child: any) => child.tagName === 'img');
    if (!onlyImages) {
      return;
    }

    node.properties = { ...node.properties, className: ['image-row'] };
    node.children = content;
  });
}
