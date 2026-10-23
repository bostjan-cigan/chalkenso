// Unit tests for what can't run in lessons: raw HTML in course Markdown through the lesson renderer
// (src/lib/sanitize/lesson-html.ts, in `renderCourseMarkdownToHtml`) and SVG files as they're stored
// (src/lib/sanitize/svg.ts). Markdown itself, callouts, code and footnotes still render. No server
// needed; esbuild compiles the modules on the fly.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({
  stdin: {
    contents: [
      "export { renderCourseMarkdownToHtml } from './src/lib/markdown';",
      "export { transformObsidianCallouts } from './src/lib/content/callouts';",
      "export { sanitizeSvg, isSvgUpload, safeCss } from './src/lib/sanitize/svg';",
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  alias: { '@': path.join(root, 'src') },
});
const { renderCourseMarkdownToHtml, transformObsidianCallouts, sanitizeSvg, isSvgUpload, safeCss } = await import(
  `data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`
);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const render = (markdown) => renderCourseMarkdownToHtml(markdown, { hastTransforms: [transformObsidianCallouts] });

// --- Raw HTML in a lesson ---------------------------------------------------------------------
const xss = render('Hello <img src="x.png" onerror="alert(1)"> <script>alert(2)</script> <a href="javascript:alert(3)">go</a>');
check('event handlers go', !/onerror/i.test(xss), xss);
check('scripts go, with what is inside', !/<script/i.test(xss) && !xss.includes('alert(2)'), xss);
check('javascript: links lose their href', !/javascript:/i.test(xss) && xss.includes('go'), xss);
check('the image itself stays', /<img src="x\.png"/.test(xss), xss);
const styled = render('<span style="position:fixed;inset:0">Over the page</span> <div onclick="x()" class="trap">Text</div>');
check('style attributes go, the text stays', !/style=/.test(styled) && styled.includes('Over the page') && !/onclick/.test(styled), styled);
check('forms and inputs that aren’t task lists go', !/<form/i.test(render('<form action="https://evil"><input name="pw"></form>')));
const frames = render('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe>\n\n<iframe src="https://evil.example/phish"></iframe>');
check('a YouTube player stays, sandboxed', /<iframe[^>]*src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"[^>]*sandbox=/.test(frames), frames);
check('any other frame goes', !frames.includes('evil.example'), frames);
check('a data: frame goes', !/<iframe/.test(render('<iframe src="data:text/html,<script>alert(1)</script>"></iframe>')));
const data = render('<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot"> <img src="data:text/html;base64,PHNjcmlwdD4=" alt="bad">');
check('an embedded PNG stays, other data: sources go', /src="data:image\/png/.test(data) && !/data:text\/html/.test(data), data);
const svg = render('<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><path d="M0 0L10 10" stroke="red"/><foreignObject><div>html</div></foreignObject><a href="javascript:alert(3)"><text>x</text></a><animate attributeName="href" to="javascript:alert(4)"/></svg>');
check('an inline SVG drawing stays', /<svg viewBox="0 0 10 10">/.test(svg) && /<path d="M0 0L10 10" stroke="red">/.test(svg), svg);
check('and what runs inside it goes', !/onload|<script|foreignObject|javascript:|<animate|alert/i.test(svg), svg);
check('inline SVG keeps no <style> (it would restyle the page)', !/<style/.test(render('<svg><style>body{display:none}</style><rect width="1" height="1"/></svg>')));
check('details, summary and kbd stay', /<details><summary>More<\/summary>/.test(render('<details><summary>More</summary>\n\nHidden\n\n</details>')) && /<kbd>Ctrl<\/kbd>/.test(render('Press <kbd>Ctrl</kbd>')));

// --- Markdown itself still renders --------------------------------------------------------------
const callout = render('> [!tip] Check your work\n> Run it again.');
check('callouts keep their box, colour and icon', /class="callout"/.test(callout) && /--callout-color/.test(callout) && /<svg/.test(callout), callout);
const code = render('```js\nconst a = 1;\n```');
check('code keeps its highlighting and header', /hljs-keyword/.test(code) && /lesson-code-language">js</.test(code) && /style="width:768px/.test(code), code);
const tasks = render('- [x] Done\n- [ ] Not yet');
check('task lists keep their checkboxes', (tasks.match(/<input[^>]*type="checkbox"/g) ?? []).length === 2, tasks);
const notes = render('A claim.[^1]\n\n[^1]: The source.');
const ref = notes.match(/href="#([^"]+)"/)?.[1];
check('footnote links still reach their notes', Boolean(ref) && notes.includes(`id="${ref}"`), notes);
check('ids written in raw HTML are prefixed, a drawing’s own are not', /id="user-content-intro"/.test(render('<div id="intro">Hi</div>')) && /<linearGradient id="g"/.test(render('<svg><defs><linearGradient id="g"></linearGradient></defs><rect fill="url(#g)" width="1" height="1"/></svg>')));
check('tables render', /<table>/.test(render('| a | b |\n| - | - |\n| 1 | 2 |')));
check('links and images in Markdown render', /<a href="https:\/\/react\.dev">React<\/a>/.test(render('[React](https://react.dev)')) && /<img src="diagram\.svg" alt="Flow">/.test(render('![Flow](diagram.svg)')));

// --- SVG files --------------------------------------------------------------------------------
const file = sanitizeSvg(
  '<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" onload="alert(1)">' +
    '<style>@import url(https://evil.example/x.css); .a{fill:url(https://evil.example/p);stroke:url(#g)}</style>' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><marker id="m" refX="1" refY="1"><path d="M0 0L2 1Z"/></marker></defs>' +
    '<script>alert(2)</script><rect class="a" width="100" height="50" style="fill:url(javascript:alert(3))"/>' +
    '<use href="#m"/><use xlink:href="https://evil.example/s.svg#x"/><image href="https://evil.example/t.png"/><image href="data:image/png;base64,iVBORw0KGgo="/>' +
    '<foreignObject><iframe src="https://evil.example"></iframe></foreignObject><text x="5" y="20" text-anchor="start">Add</text></svg>'
);
check('an SVG file keeps its drawing', Boolean(file) && /<rect class="a" width="100" height="50"/.test(file) && /<text x="5" y="20" text-anchor="start">Add<\/text>/.test(file) && /stop-color="#fff"/.test(file), file);
check('with its namespace, so it draws as a file', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(file ?? ''), file);
check('scripts, handlers, frames and outside links go', !/<script|onload|foreignObject|iframe|evil\.example|javascript:/i.test(file ?? ''), file);
check('its own style stays, minus imports and outside urls', /<style>/.test(file ?? '') && /url\(#g\)/.test(file ?? '') && !/@import/.test(file ?? ''), file);
check('links inside the file and embedded images stay', /<use href="#m"/.test(file ?? '') && /href="data:image\/png/.test(file ?? ''), file);
check('empty elements close, as XML wants', /<path d="M0 0L2 1Z"\/>/.test(file ?? ''), file);
check('not an SVG: null', sanitizeSvg('<html><body>hi</body></html>') === null && sanitizeSvg('plain text') === null);
check('nothing left to draw: null', sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') === null);
check('SVG uploads are told apart', isSvgUpload('image/svg+xml') && isSvgUpload('', 'flow.svg') && !isSvgUpload('image/png', 'flow.png') && !isSvgUpload('image/png', 'x.svg'));
check('CSS loads nothing from elsewhere', safeCss('a{background:url("https://x")}') === 'a{background:none}' && safeCss('a{background:url(data:image/png;base64,AA)}').includes('data:image'));

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
