import type { ReactNode } from 'react';
import type { Style } from '@react-pdf/types';
import { exportName, fetchLessonImage, lessonNumber, type ExportDocument } from './export-data';
import type { LessonSource } from '../lesson-source';

/**
 * The lessons as a PDF file, made in the browser with @react-pdf/renderer (loaded only when someone
 * exports): the lesson's rendered HTML is walked and drawn again with the PDF's own boxes and text,
 * so whatever a lesson can hold has to be drawn here too. A straight download, each page with the
 * course, who prepared it and its number. The fonts are in ./fonts (the built-in PDF fonts can't
 * show č or đ).
 */

const INK = '#1d1d1f';
const MUTED = '#86868b';
const LINE = '#d9d9de';
const LINK = '#0b5cad';
const CODE_BG = '#f5f5f7';
const SANS = 'Inter';
const MONO = 'JetBrains Mono';

/** highlight.js token classes → colours (light). */
const TOKEN_COLORS: Array<[RegExp, string]> = [
  [/hljs-(comment|quote)/, '#6e7781'],
  [/hljs-(keyword|selector-tag|built_in|literal|type)/, '#cf222e'],
  [/hljs-(string|regexp|attr|addition)/, '#0a3069'],
  [/hljs-(number|symbol|bullet|meta)/, '#0550ae'],
  [/hljs-(title|section|name|function)/, '#8250df'],
  [/hljs-(variable|template-variable|attribute)/, '#953800'],
];

const CALLOUT_COLOR = '8, 109, 221';

/** `r, g, b` as the PDF's colour, or mixed into white (`tint` 0.1 = the page's 10% wash). */
function rgb(color: string, tint = 1) {
  const parts = color.split(',').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return rgb(CALLOUT_COLOR, tint);
  return `rgb(${parts.map((part) => Math.round(255 - (255 - part) * tint)).join(', ')})`;
}

/** An image as PNG data the PDF can hold (it reads PNG and JPEG only), or null when it can't be read. */
async function imageData(blob: Blob | null): Promise<{ data: string; width: number; height: number } | null> {
  let local = '';
  try {
    if (!blob) return null;
    local = URL.createObjectURL(blob);
    const img = new Image();
    img.src = local;
    await img.decode();
    // A drawing (SVG) is sharp at any size: drawn large. A photo is only ever made smaller.
    const fit = 1600 / (img.naturalWidth || 1);
    const scale = blob.type.includes('svg') ? fit : Math.min(1, fit);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.9), width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    if (local) URL.revokeObjectURL(local);
  }
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'DETAILS', 'SUMMARY', 'IMG']);

function hasBlockChild(node: Element) {
  return Array.from(node.children).some((child) => BLOCK_TAGS.has(child.tagName) || child.querySelector('img') !== null);
}

/** Text as HTML shows it: runs of white space are one space. */
/**
 * Code's font, always upright and regular: the mono has one file, and inside emphasised or bold
 * text (or a heading) the PDF library would look for an italic or bold mono and fail the export.
 */
const CODE_FONT = { fontFamily: MONO, fontStyle: 'normal', fontWeight: 400 } as const;

const collapse = (text: string) => text.replace(/\s+/g, ' ');

export async function downloadLessonsPdf(doc: ExportDocument, source: LessonSource, step: (reached: number, next: number) => void = () => {}) {
  const pdf = await import('@react-pdf/renderer');
  const { Document, Page, Text, View, Image: PdfImage, Link, Font, StyleSheet } = pdf;

  Font.register({
    family: SANS,
    fonts: [
      { src: new URL('./fonts/inter-400.ttf', import.meta.url).href, fontWeight: 400 },
      { src: new URL('./fonts/inter-600.ttf', import.meta.url).href, fontWeight: 600 },
      { src: new URL('./fonts/inter-400-italic.ttf', import.meta.url).href, fontWeight: 400, fontStyle: 'italic' },
      { src: new URL('./fonts/inter-600-italic.ttf', import.meta.url).href, fontWeight: 600, fontStyle: 'italic' },
    ],
  });
  Font.register({ family: MONO, src: new URL('./fonts/jetbrains-mono-400.ttf', import.meta.url).href });
  // Words stay whole.
  Font.registerHyphenationCallback((word) => [word]);

  const s = StyleSheet.create({
    page: { paddingTop: 54, paddingBottom: 62, paddingHorizontal: 52, fontFamily: SANS, fontSize: 10.5, color: INK },
    // Not on the page: the library applies a page's line height twice to page-number texts, which
    // pushes them off the paper.
    // The size is repeated because a line height is worked out from the size beside it.
    body: { fontSize: 10.5, lineHeight: 1.55 },
    footer: { position: 'absolute', bottom: 28, fontSize: 8, color: MUTED },
    course: { fontSize: 30, fontWeight: 600, lineHeight: 1.15, marginTop: 80, marginBottom: 36 },
    contentsRow: { flexDirection: 'row', paddingVertical: 4.5, borderBottomWidth: 0.5, borderBottomColor: LINE },
    contentsArc: { fontWeight: 600, marginTop: 16, marginBottom: 4 },
    number: { color: MUTED, width: 28 },
    heading: { marginBottom: 16, paddingBottom: 12, borderBottomWidth: 0.75, borderBottomColor: LINE },
    arc: { fontSize: 8.5, color: MUTED, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
    title: { fontSize: 22, fontWeight: 600, lineHeight: 1.2 },
    p: { marginBottom: 8 },
    h1: { fontSize: 18, fontWeight: 600, lineHeight: 1.25, marginTop: 16, marginBottom: 8 },
    h2: { fontSize: 15, fontWeight: 600, lineHeight: 1.3, marginTop: 14, marginBottom: 6 },
    h3: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, marginTop: 12, marginBottom: 5 },
    h4: { fontSize: 11, fontWeight: 600, marginTop: 10, marginBottom: 4 },
    li: { flexDirection: 'row', marginBottom: 3 },
    marker: { width: 16, color: MUTED },
    quote: { borderLeftWidth: 2, borderLeftColor: LINE, paddingLeft: 10, marginBottom: 8, color: '#48484a' },
    callout: { borderLeftWidth: 2.5, paddingTop: 8, paddingBottom: 2, paddingHorizontal: 10, marginBottom: 10, borderRadius: 3 },
    calloutTitle: { fontWeight: 600, marginBottom: 4 },
    author: { color: MUTED, fontSize: 12, marginTop: -24, marginBottom: 36 },
    lessonCourse: { fontSize: 8.5, color: MUTED, marginBottom: 8 },
    missing: { color: MUTED, fontSize: 9, marginBottom: 8 },
    columns: { flexDirection: 'row', gap: 12, marginBottom: 4 },
    code: { backgroundColor: CODE_BG, borderRadius: 5, padding: 10, marginBottom: 10 },
    codeLanguage: { fontSize: 7.5, color: MUTED, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 },
    codeText: { ...CODE_FONT, fontSize: 8.5, lineHeight: 1.5 },
    inlineCode: { ...CODE_FONT, fontSize: 9.2, backgroundColor: CODE_BG },
    table: { marginBottom: 10, borderTopWidth: 0.5, borderTopColor: LINE, borderLeftWidth: 0.5, borderLeftColor: LINE },
    tr: { flexDirection: 'row' },
    td: { padding: 5, fontSize: 9.5, borderRightWidth: 0.5, borderRightColor: LINE, borderBottomWidth: 0.5, borderBottomColor: LINE },
    th: { fontWeight: 600, backgroundColor: CODE_BG },
    hr: { borderBottomWidth: 0.5, borderBottomColor: LINE, marginVertical: 12 },
    image: { marginVertical: 8, borderRadius: 6 },
    imageRow: { flexDirection: 'row', gap: 8 },
  });

  // Images first: the walk below is not async.
  const parser = new DOMParser();
  const trees = doc.lessons.map((lesson) => parser.parseFromString(lesson.html, 'text/html').body);
  const images = new Map<string, Awaited<ReturnType<typeof imageData>>>();
  // Images take the export from 45% to 65%; laying the PDF out, the rest.
  const imageCount = new Set(trees.flatMap((tree) => Array.from(tree.querySelectorAll('img'), (img) => img.getAttribute('src')).filter(Boolean))).size;
  let imagesDone = 0;
  await Promise.all(
    trees.flatMap((tree, index) =>
      Array.from(tree.querySelectorAll('img')).map(async (img) => {
        const src = img.getAttribute('src');
        if (src && !images.has(src)) {
          images.set(src, null);
          // Fetched afresh: the copy the page already shows can't be read by a script.
          images.set(src, await imageData(await fetchLessonImage(source, doc.lessons[index].id, new URL(src, window.location.href).href)));
          imagesDone += 1;
          step(45 + (20 * imagesDone) / imageCount, 45 + (20 * Math.min(imageCount, imagesDone + 1)) / imageCount);
        }
      })
    )
  );

  let key = 0;
  const k = () => `n${(key += 1)}`;

  /** The words inside a paragraph: bold, links, inline code, line breaks. */
  function inline(node: Node, style: Style = {}): ReactNode[] {
    const out: ReactNode[] = [];
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = collapse(child.textContent ?? '');
        if (text) out.push(Object.keys(style).length ? <Text key={k()} style={style}>{text}</Text> : text);
        return;
      }
      if (!(child instanceof Element)) return;
      const tag = child.tagName;
      if (tag === 'BR') out.push('\n');
      else if (tag === 'IMG') return;
      else if (tag === 'STRONG' || tag === 'B') out.push(...inline(child, { ...style, fontWeight: 600 }));
      else if (tag === 'EM' || tag === 'I') out.push(...inline(child, { ...style, fontStyle: 'italic' }));
      else if (tag === 'DEL' || tag === 'S') out.push(...inline(child, { ...style, textDecoration: 'line-through' }));
      else if (tag === 'CODE') out.push(<Text key={k()} style={{ ...style, ...s.inlineCode }}>{child.textContent}</Text>);
      else if (tag === 'A') {
        const href = child.getAttribute('href') ?? '';
        const words = inline(child, { ...style, color: LINK });
        // Links between lessons go nowhere on paper.
        out.push(/^https?:/.test(href) ? <Link key={k()} src={href} style={{ color: LINK, textDecoration: 'none' }}>{words}</Link> : <Text key={k()}>{words}</Text>);
      } else out.push(...inline(child, style));
    });
    return out;
  }

  function picture(img: Element) {
    const loaded = images.get(img.getAttribute('src') ?? '');
    if (!loaded) {
      // An image that could not be read leaves its description, not a silent gap.
      const alt = img.getAttribute('alt')?.trim();
      return alt ? <Text key={k()} style={s.missing}>[{alt}]</Text> : null;
    }
    // 72 CSS pixels to the PDF's 96: an image keeps the size it has on the page, up to the column.
    const asked = Number.parseFloat((img.getAttribute('style') ?? '').match(/width:\s*([\d.]+)px/)?.[1] ?? img.getAttribute('width') ?? '');
    const width = Math.min(491, (Number.isFinite(asked) && asked > 0 ? asked : loaded.width) * 0.75);
    return <PdfImage key={k()} src={loaded.data} style={{ ...s.image, width, height: (width * loaded.height) / loaded.width }} />;
  }

  function codeTokens(node: Node, color?: string): ReactNode[] {
    const out: ReactNode[] = [];
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        // The PDF drops spaces that open a line: indentation is kept as non-breaking spaces.
        const text = (child.textContent ?? '').replace(/(^|\n)( +)/g, (_, start: string, spaces: string) => start + '\u00a0'.repeat(spaces.length));
        if (text) out.push(color ? <Text key={k()} style={{ color }}>{text}</Text> : text);
      } else if (child instanceof Element) {
        const own = TOKEN_COLORS.find(([pattern]) => pattern.test(child.className))?.[1];
        out.push(...codeTokens(child, own ?? color));
      }
    });
    return out;
  }

  function list(node: Element, ordered: boolean) {
    const start = Number.parseInt(node.getAttribute('start') ?? '1', 10) || 1;
    return (
      <View key={k()} style={{ marginBottom: 6 }}>
        {Array.from(node.children)
          .filter((child) => child.tagName === 'LI')
          .map((item, index) => {
            const task = item.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
            return (
              <View key={k()} style={s.li}>
                <Text style={task ? [s.marker, { ...CODE_FONT, fontSize: 8.5, width: 22 }] : s.marker}>
                  {task ? (task.hasAttribute('checked') ? '[x]' : '[ ]') : ordered ? `${start + index}.` : '•'}
                </Text>
                <View style={{ flex: 1 }}>{hasBlockChild(item) ? blocks(item) : <Text>{inline(item)}</Text>}</View>
              </View>
            );
          })}
      </View>
    );
  }

  function table(node: Element) {
    const rows = Array.from(node.querySelectorAll('tr'));
    // A column is as wide as its longest cell asks, within reason: "Step" stays narrow beside a sentence.
    const widths: number[] = [];
    rows.forEach((row) =>
      Array.from(row.children).forEach((cell, column) => {
        widths[column] = Math.max(widths[column] ?? 0, Math.min(40, Math.max(6, (cell.textContent ?? '').trim().length)));
      })
    );
    return (
      <View key={k()} style={s.table}>
        {rows.map((row) => (
          <View key={k()} style={s.tr} wrap={false}>
            {Array.from(row.children).map((cell, column) => (
              <Text key={k()} style={[s.td, { flexGrow: widths[column], flexShrink: 1, flexBasis: 0 }, cell.tagName === 'TH' ? s.th : {}]}>
                {inline(cell)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  function codeBlock(node: Element) {
    const pre = node.tagName === 'PRE' ? node : node.querySelector('pre');
    if (!pre) return null;
    const language = node.querySelector('.lesson-code-language')?.textContent?.trim();
    return (
      <View key={k()} style={s.code}>
        {language ? <Text style={s.codeLanguage}>{language}</Text> : null}
        <Text style={s.codeText}>{codeTokens(pre)}</Text>
      </View>
    );
  }

  function callout(node: Element) {
    const title = node.querySelector(':scope > .callout-title .callout-title-inner');
    const content = node.querySelector(':scope > .callout-content');
    // The callout's own colour (note, warning, tip…), as the page sets it.
    const color = (node.getAttribute('style') ?? '').match(/--callout-color:\s*([\d,\s]+)/)?.[1] ?? CALLOUT_COLOR;
    return (
      <View key={k()} style={[s.callout, { borderLeftColor: rgb(color), backgroundColor: rgb(color, 0.1) }]}>
        {title ? <Text style={[s.calloutTitle, { color: rgb(color) }]} minPresenceAhead={30}>{inline(title)}</Text> : null}
        {content ? blocks(content) : null}
      </View>
    );
  }

  /** A lesson's blocks, in order. Loose words between blocks become a paragraph. */
  function blocks(parent: Element): ReactNode[] {
    const out: ReactNode[] = [];
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = collapse(child.textContent ?? '').trim();
        if (text) out.push(<Text key={k()} style={s.p}>{text}</Text>);
        return;
      }
      if (!(child instanceof Element)) return;
      const tag = child.tagName;
      const classes = child.classList;
      if (classes.contains('lesson-code-block') || tag === 'PRE') out.push(codeBlock(child));
      else if (classes.contains('callout')) out.push(callout(child));
      else if (classes.contains('columns'))
        out.push(
          <View key={k()} style={s.columns}>
            {Array.from(child.children).map((column) => {
              const share = Number.parseFloat((column.getAttribute('style') ?? '').match(/flex:\s*0 0 ([\d.]+)%/)?.[1] ?? '');
              return <View key={k()} style={Number.isFinite(share) ? { width: `${share}%` } : { flex: 1 }}>{blocks(column)}</View>;
            })}
          </View>
        );
      else if (classes.contains('image-row')) out.push(<View key={k()} style={s.imageRow}>{Array.from(child.querySelectorAll('img')).map(picture)}</View>);
      else if (/^H[1-6]$/.test(tag)) out.push(<Text key={k()} style={[s.h1, s.h2, s.h3, s.h4, s.h4, s.h4][Number(tag[1]) - 1]} minPresenceAhead={40}>{inline(child)}</Text>);
      else if (tag === 'UL' || tag === 'OL') out.push(list(child, tag === 'OL'));
      else if (tag === 'TABLE') out.push(table(child));
      else if (tag === 'BLOCKQUOTE') out.push(<View key={k()} style={s.quote}>{blocks(child)}</View>);
      else if (tag === 'HR') out.push(<View key={k()} style={s.hr} />);
      else if (tag === 'IMG') out.push(picture(child));
      else if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SCRIPT' || tag === 'STYLE') return;
      else if (hasBlockChild(child)) {
        // A paragraph holding an image, or any wrapper: its words, then what is inside.
        if (tag === 'P') {
          const words = inline(child);
          if (words.some((word) => typeof word !== 'string' || word.trim())) out.push(<Text key={k()} style={s.p}>{words}</Text>);
          child.querySelectorAll('img').forEach((img) => out.push(picture(img)));
        } else out.push(...blocks(child));
      } else {
        const words = inline(child);
        if (words.length) out.push(<Text key={k()} style={s.p}>{words}</Text>);
      }
    });
    return out;
  }

  const name = exportName(doc);
  const tree = (
    <Document title={name} author={doc.author ?? undefined}>
      <Page size="A4" style={s.page}>
        {/* First in the page, so every page has it. */}
        <Text style={[s.footer, { left: 52 }]} fixed>
          {[doc.courseTitle, doc.author].filter(Boolean).join(' · ')}
        </Text>
        <Text style={[s.footer, { right: 52 }]} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        {doc.whole ? (
          <View style={s.body}>
            <Text style={s.course}>{doc.courseTitle}</Text>
            {doc.author ? <Text style={s.author}>{doc.author}</Text> : null}
            {doc.lessons.map((lesson) => (
              <View key={lesson.id} wrap={false}>
                {lesson.arcTitle ? <Text style={s.contentsArc}>{lesson.arcTitle}</Text> : null}
                <View style={s.contentsRow}>
                  <Text style={s.number}>{lessonNumber(lesson.position)}</Text>
                  <Text style={{ flex: 1 }}>{lesson.title}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {doc.lessons.map((lesson, index) => (
          <View key={lesson.id} style={s.body} break={doc.whole || index > 0}>
            <View style={s.heading}>
              {lesson.arcTitle ? <Text style={s.arc}>{lesson.arcTitle}</Text> : null}
              {doc.whole ? null : <Text style={s.lessonCourse}>{[doc.courseTitle, doc.author].filter(Boolean).join(' · ')}</Text>}
              <Text style={{ color: MUTED }}>{lessonNumber(lesson.position)}</Text>
              <Text style={s.title}>{lesson.title}</Text>
            </View>
            {blocks(trees[index])}
          </View>
        ))}
      </Page>
    </Document>
  );

  step(65, 97);
  const blob = await pdf.pdf(tree).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
