import { raw } from 'hast-util-raw';
import { sanitize, type Schema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';

/**
 * SVG that can't do anything but draw. An SVG is a document: it can carry scripts, event handlers,
 * links to `javascript:`, HTML inside `<foreignObject>`, animations that rewrite a link, and styles
 * that load from elsewhere. Lesson images (uploaded, synced from Obsidian, drawn by AI) and inline
 * `<svg>` in a lesson keep only the drawing: shapes, text, gradients, markers, filters, and links
 * inside the drawing itself (`#id`).
 */

/** Elements a drawing needs. Animation (`animate`, `set` can rewrite an `href`), `foreignObject` and `script` are not among them. */
export const SVG_ELEMENTS = [
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feDisplacementMap',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'feTile',
  'feTurbulence',
];

/** Presentation and geometry attributes (as hast names them), on every drawing element. */
const SVG_ATTRIBUTES = [
  'id',
  'className',
  'role',
  'ariaLabel',
  'ariaHidden',
  'ariaLabelledBy',
  'ariaDescribedBy',
  'focusable',
  'lang',
  'xmlSpace',
  'transform',
  'fill',
  'fillOpacity',
  'fillRule',
  'stroke',
  'strokeWidth',
  'strokeOpacity',
  'strokeLineCap',
  'strokeLineJoin',
  'strokeDashArray',
  'strokeDashOffset',
  'strokeMiterLimit',
  'opacity',
  'color',
  'display',
  'visibility',
  'overflow',
  'clipPath',
  'clipRule',
  'mask',
  'filter',
  'markerStart',
  'markerMid',
  'markerEnd',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'wordSpacing',
  'textAnchor',
  'textDecoration',
  'dominantBaseline',
  'alignmentBaseline',
  'baselineShift',
  'writingMode',
  'vectorEffect',
  'shapeRendering',
  'textRendering',
  'imageRendering',
  'paintOrder',
  'x',
  'y',
  'width',
  'height',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'd',
  'points',
  'pathLength',
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
  'startOffset',
  'method',
  'spacing',
  'side',
  'viewBox',
  'preserveAspectRatio',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'orient',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stopColor',
  'stopOpacity',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'maskUnits',
  'maskContentUnits',
  'clipPathUnits',
  'filterUnits',
  'primitiveUnits',
  'in',
  'in2',
  'result',
  'stdDeviation',
  'mode',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'values',
  'type',
  'tableValues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'floodColor',
  'floodOpacity',
  'radius',
  'baseFrequency',
  'numOctaves',
  'seed',
  'stitchTiles',
  'scale',
  'xChannelSelector',
  'yChannelSelector',
  'version',
  'xmlns',
  'xmlnsXLink',
];

/** Links inside a drawing point inside it: `<use href="#arrow">`, `<textPath href="#curve">`. */
const LOCAL_LINK = /^#[\w.:-]+$/;
/** An embedded raster image, the only kind a drawing may show. */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[\w+/=\s]+$/i;

/** Attribute lists for each drawing element; `style` (with its CSS checked after) only where asked. */
export function svgAttributes(options: { style: boolean; images: boolean }): Schema['attributes'] {
  const common = options.style ? [...SVG_ATTRIBUTES, 'style'] : SVG_ATTRIBUTES;
  const local: [string, RegExp] = ['href', LOCAL_LINK];
  const localXLink: [string, RegExp] = ['xLinkHref', LOCAL_LINK];
  const attributes: NonNullable<Schema['attributes']> = {};
  for (const tag of SVG_ELEMENTS) attributes[tag] = common;
  for (const tag of ['use', 'textPath', 'linearGradient', 'radialGradient', 'pattern', 'filter']) attributes[tag] = [...common, local, localXLink];
  if (options.images) attributes.image = [...common, 'preserveAspectRatio', ['href', DATA_IMAGE], ['xLinkHref', DATA_IMAGE]];
  return attributes;
}

/** CSS that can only style: no `@import`, no `url()` to anywhere but inside the file, no old script hooks. */
export function safeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?!data:(?:image|font)\/|#)[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript\s*:/gi, '')
    .replace(/-moz-binding\s*:[^;}]*;?/gi, '')
    .replace(/behavior\s*:[^;}]*;?/gi, '');
}

/** A standalone SVG file's schema: drawing elements only, with its own `<style>` and embedded raster images. */
const FILE_SCHEMA: Schema = {
  tagNames: [...SVG_ELEMENTS, 'style', 'image'],
  attributes: svgAttributes({ style: true, images: true }),
  // Only data URLs (embedded images) and links inside the file; nothing that loads or navigates.
  protocols: { href: ['data'], xLinkHref: ['data'] },
  // Gone with everything inside: what runs, and HTML or animation that could.
  strip: ['script', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set', 'iframe', 'object', 'embed'],
  clobber: [],
  allowComments: false,
  allowDoctypes: false,
};

/**
 * The SVG file as it's safe to store and show: the drawing kept, the rest dropped. Null when it
 * isn't an SVG at all (no `<svg>` root) or nothing is left to draw.
 */
export function sanitizeSvg(text: string): string | null {
  const source = text.replace(/^﻿/, '');
  if (!/<svg[\s>]/i.test(source)) return null;
  const parsed = raw({ type: 'root', children: [{ type: 'raw', value: source }] } as never) as unknown as { type: 'root'; children: unknown[] };
  const clean = sanitize(parsed as never, FILE_SCHEMA) as unknown as { type: 'root'; children: Array<{ type: string; tagName?: string; properties?: Record<string, unknown> }> };
  const root = clean.children.find((node) => node.type === 'element' && node.tagName === 'svg');
  if (!root) return null;
  let linksXLink = false;
  visit(root as never, 'element', (node: { tagName: string; properties?: Record<string, unknown>; children?: Array<{ type: string; value?: string }> }) => {
    const properties = node.properties ?? {};
    if (typeof properties.style === 'string') properties.style = safeCss(properties.style);
    if (node.tagName === 'style') for (const child of node.children ?? []) if (child.type === 'text') child.value = safeCss(child.value ?? '');
    if (properties.xLinkHref !== undefined) linksXLink = true;
  });
  // A file of its own needs its namespace (and xlink's, when it's used) to be drawn at all.
  root.properties = { ...root.properties, xmlns: 'http://www.w3.org/2000/svg', ...(linksXLink ? { xmlnsXLink: 'http://www.w3.org/1999/xlink' } : {}) };
  if (!('children' in root) || !(root as { children: unknown[] }).children.length) return null;
  return toHtml(root as never, { space: 'svg', closeEmptyElements: true, tightSelfClosing: true });
}

/** Whether an upload is an SVG (by its type, or its name when the type is vague). */
export const isSvgUpload = (mimeType: string | null | undefined, filename?: string | null) =>
  /^image\/svg\+xml\b/i.test(mimeType ?? '') || (/\.svg$/i.test(filename ?? '') && !/^image\/(?!svg)/i.test(mimeType ?? ''));
