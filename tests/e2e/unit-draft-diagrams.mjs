// Unit tests for diagrams in AI drafts (src/lib/draft-diagrams.ts): what an AI answer's
// `<diagram>` blocks give, a diagram cleaned and kept within its limits (or refused, and why), names
// already in use, raw <svg> in the Markdown turned into a file, and embeds' alt text
// (src/lib/course-markdown.ts). No server needed; esbuild compiles the modules.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const load = async (file) => {
  const out = await build({ entryPoints: [path.join(root, file)], bundle: true, format: 'esm', write: false, platform: 'node' });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
};
const { parseDiagrams, cleanDiagram, cleanDraftDiagrams, renameImage, MAX_DIAGRAMS } = await load('src/lib/draft-diagrams.ts');
const { extractMarkdownImageReferences, resolveLessonMarkdownAssetUrls } = await load('src/lib/course-markdown.ts');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const DRAWING = '<svg viewBox="0 0 200 80"><rect x="10" y="10" width="80" height="40" rx="8" fill="#EEF2F7"/><text x="50" y="35" fill="#1F2937">Client</text></svg>';

// The AI's answer.
const answer = `<summary>Added a diagram.</summary>\n<lesson>\n# A\n\n![[diagrams/flow.svg|How it flows]]\n</lesson>\n<diagram path="diagrams/flow.svg">\n${DRAWING}\n</diagram>\n<diagram path="diagrams/two.svg">${DRAWING}</diagram>`;
const parsed = parseDiagrams(answer);
check('two diagrams read', parsed.length === 2 && parsed[0].path === 'diagrams/flow.svg' && parsed[0].svg.startsWith('<svg'));
check('no diagrams: none', parseDiagrams('<lesson>x</lesson>').length === 0);

// One diagram, cleaned.
const clean = cleanDiagram(DRAWING);
check('a drawing is kept', 'svg' in clean && clean.svg.includes('<rect') && clean.svg.includes('Client'));
check('it gets its namespace', 'svg' in clean && clean.svg.includes('xmlns="http://www.w3.org/2000/svg"'));
check('cleaning twice changes nothing', 'svg' in clean && 'svg' in cleanDiagram(clean.svg) && cleanDiagram(clean.svg).svg === clean.svg);
const hostile = cleanDiagram(
  '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><rect width="5" height="5"/></a><use href="https://evil.example/x.svg#a"/><rect width="1" height="1" onclick="alert(4)"/></svg>'
);
check('scripts, handlers, HTML and outside links go', 'svg' in hostile && !/alert|script|foreignObject|evil\.example|javascript/i.test(hostile.svg), JSON.stringify(hostile));
check('the drawing stays', 'svg' in hostile && hostile.svg.includes('<rect'));
check('not an SVG: refused', cleanDiagram('<p>hello</p>').reason === 'notSvg');
check('nothing left: refused', cleanDiagram('<svg viewBox="0 0 1 1"><script>x()</script></svg>').reason === 'notSvg');
check('too large: refused', cleanDiagram(`<svg viewBox="0 0 1 1">${'<g/>'.repeat(30_000)}</svg>`).reason === 'tooLarge');
check('too many elements: refused', cleanDiagram(`<svg viewBox="0 0 1 1">${'<g></g>'.repeat(1_600)}</svg>`).reason === 'tooComplex');
check('no size: refused', cleanDiagram('<svg><rect width="1" height="1"/></svg>').reason === 'noSize');
check('width and height are a size', 'svg' in cleanDiagram('<svg width="20" height="10"><rect width="1" height="1"/></svg>'));
check('a viewBox gives it width and height', 'svg' in clean && /^<svg width="200" height="80"/.test(clean.svg) && (clean.svg.match(/<svg[^>]*>/)[0].match(/width=/g) || []).length === 1, 'svg' in clean ? clean.svg.slice(0, 120) : '');
const halfSized = cleanDiagram('<svg viewBox="0 0 40 20" width="100%"><rect width="1" height="1"/></svg>');
check('only a width: the viewBox decides', 'svg' in halfSized && /^<svg width="40" height="20"/.test(halfSized.svg) && !halfSized.svg.includes('100%'));
check('no viewBox size: refused', cleanDiagram('<svg viewBox="0 0 0 0"><rect width="1" height="1"/></svg>').reason === 'noSize');

// A draft's diagrams.
const base = '# Lesson\n\nText.\n\n![[diagrams/old.svg]]\n';
const draft = (markdown, diagrams, taken) => cleanDraftDiagrams({ markdown, base, diagrams, taken });
let result = draft(`${base}\n![[diagrams/flow.svg|How it flows]]\n`, [{ path: 'diagrams/flow.svg', svg: DRAWING }]);
check('an embedded diagram is kept', result.diagrams.length === 1 && result.refused.length === 0 && result.markdown.includes('![[diagrams/flow.svg|How it flows]]'));
check('kept as cleaned', result.diagrams[0].svg.includes('xmlns='));

result = draft(base, [{ path: 'diagrams/flow.svg', svg: DRAWING }]);
check('not embedded: refused', result.diagrams.length === 0 && result.refused[0]?.reason === 'notEmbedded');

result = draft(`${base}\n![[images/flow.svg]]\n`, [{ path: 'images/flow.svg', svg: DRAWING }]);
check('a path outside diagrams/: refused', result.refused[0]?.reason === 'path');
check('its new embed is taken out', !result.markdown.includes('images/flow.svg'));

result = draft(`${base}\nIntro ![[diagrams/bad.svg]] here.\n`, [{ path: 'diagrams/bad.svg', svg: '<svg viewBox="0 0 1 1"><script>x()</script></svg>' }]);
check('a refused diagram leaves no broken embed', result.refused[0]?.reason === 'notSvg' && !result.markdown.includes('bad.svg') && result.markdown.includes('Intro  here.'));

result = draft('# Lesson\n\nText.\n\n![[diagrams/old.svg]]\n\n![[diagrams/old.svg|New]]\n', [{ path: 'diagrams/old.svg', svg: DRAWING }]);
check('a name the lesson uses: renamed', result.diagrams[0]?.path === 'diagrams/old-2.svg' && result.markdown.includes('![[diagrams/old-2.svg|New]]'), JSON.stringify(result));

result = draft(`${base}\n![[diagrams/flow.svg]]\n`, [{ path: 'diagrams/flow.svg', svg: DRAWING }], ['diagrams/flow.svg', 'diagrams/flow-2.svg']);
check('a name another draft uses: the next free one', result.diagrams[0]?.path === 'diagrams/flow-3.svg' && result.markdown.includes('![[diagrams/flow-3.svg]]'));

const many = Array.from({ length: MAX_DIAGRAMS + 1 }, (_, n) => ({ path: `diagrams/d${n}.svg`, svg: DRAWING }));
result = draft(`${base}\n${many.map((item) => `![[${item.path}]]`).join('\n\n')}\n`, many);
check('at most four', result.diagrams.length === MAX_DIAGRAMS && result.refused.some((item) => item.reason === 'tooMany'));

result = draft(`${base}\n![](diagrams/md.svg "title")\n`, [{ path: 'diagrams/md.svg', svg: DRAWING }]);
check('a Markdown image embed counts', result.diagrams.length === 1);

result = draft(`${base}\n<svg viewBox="0 0 10 10"><title>Two boxes</title><rect width="5" height="5"/></svg>\n\nAfter.\n`, []);
check('raw <svg> in the lesson becomes a file', result.diagrams.length === 1 && result.diagrams[0].path === 'diagrams/diagram-1.svg' && !result.markdown.includes('<svg'), JSON.stringify(result));
check('its title is the alt text', result.markdown.includes('![[diagrams/diagram-1.svg|Two boxes]]'));
result = draft(`${base}\n\`\`\`html\n<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>\n\`\`\`\n`, []);
check('an <svg> in a code block stays code', result.diagrams.length === 0 && result.markdown.includes('```html\n<svg'));
const inlineBase = `${base}\n<svg viewBox="0 0 4 4"><rect width="1" height="1"/></svg>\n`;
result = cleanDraftDiagrams({ markdown: inlineBase, base: inlineBase, diagrams: [] });
check('an <svg> the lesson already had stays', result.diagrams.length === 0 && result.markdown === inlineBase);

check('rename: both kinds of embed', renameImage('![[a/b.svg|x]] ![y](a/b.svg) ![[a/b.svg]]', 'a/b.svg', 'a/c.svg') === '![[a/c.svg|x]] ![y](a/c.svg) ![[a/c.svg]]');
check('rename: a longer name stays', renameImage('![[a/b.svg-old.svg]]', 'a/b.svg', 'a/c.svg') === '![[a/b.svg-old.svg]]');

// Alt text of an embed.
const refs = extractMarkdownImageReferences('![[diagrams/a.svg|How a request travels]] ![[x.png|320]] ![[y.png]]');
check('alt text after the bar', refs[0].altText === 'How a request travels');
check('a size is not alt text', refs[1].altText === null && refs[2].altText === null);
const resolved = resolveLessonMarkdownAssetUrls('![[diagrams/a.svg|How it flows]]', new Map([['diagrams/a.svg', '/x/a.svg']]));
check('alt text reaches the image', resolved === '![How it flows](/x/a.svg)', resolved);
check('size kept with keepImageSize', resolveLessonMarkdownAssetUrls('![[x.png|320]]', new Map(), { keepImageSize: true }) === '![](x.png "obsidian-size:320")');

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll draft diagram checks passed.');
