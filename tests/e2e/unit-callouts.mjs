// Unit tests for Obsidian callout titles (src/lib/content/callouts.ts through the lesson renderer,
// `renderCourseMarkdownToHtml` in src/lib/markdown.ts, as lessons use it): inline formatting and the
// spaces between its parts survive. No server needed; esbuild compiles the modules on the fly.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({
  stdin: {
    contents: "export { renderCourseMarkdownToHtml } from './src/lib/markdown';\nexport { transformObsidianCallouts } from './src/lib/content/callouts';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  alias: { '@': path.join(root, 'src') },
});
const { renderCourseMarkdownToHtml, transformObsidianCallouts } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
const renderMarkdownToHtml = (markdown) => renderCourseMarkdownToHtml(markdown, { hastTransforms: [transformObsidianCallouts] });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const titleOf = (markdown) => {
  const inner = renderMarkdownToHtml(markdown).match(/class="callout-title-inner">([\s\S]*?)<\/span>/)?.[1] ?? null;
  return inner === null ? null : inner.replace(/<[^>]+>/g, '');
};

check('spaces between inline parts are kept', titleOf('> [!info] Run `npm test` **first**\n> Body') === 'Run npm test first', String(titleOf('> [!info] Run `npm test` **first**\n> Body')));
check('inline formatting is kept', /Run <code[^>]*>npm test<\/code> <strong>first<\/strong>/.test(renderMarkdownToHtml('> [!info] Run `npm test` **first**\n> Body')));
check('a plain title', titleOf('> [!tip] Use the shortcut\n> Body') === 'Use the shortcut');
check('a title ending in formatting', titleOf('> [!note] Read *this*\n> Body') === 'Read this');
check('a type alone gets its default title', titleOf('> [!warning]\n> Body') === 'Warning', String(titleOf('> [!warning]\n> Body')));
check('the body stays out of the title', !/Body/.test(titleOf('> [!info] Title\n> Body') ?? ''));

process.exit(failed ? 1 : 0);
