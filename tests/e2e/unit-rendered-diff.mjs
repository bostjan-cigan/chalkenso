// Unit tests for word marks in rendered lessons (src/app/admin/courses/components/workspace/rendered-diff.ts):
// what changed in a paragraph, marked in the HTML learners see (code, links and callouts included),
// side by side and in place. No server needed; esbuild compiles the modules on the fly.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({
  entryPoints: [path.join(root, 'src/app/admin/courses/components/workspace/rendered-diff.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  alias: { '@': path.join(root, 'src') },
});
const { renderedDiff, renderedInlineDiff } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const assets = new Map();
const classes = { removed: 'gone', added: 'new' };
const dels = (html) => Array.from(html.matchAll(/<del class="gone">([\s\S]*?)<\/del>/g), (match) => match[1].replace(/<[^>]+>/g, ''));
const inss = (html) => Array.from(html.matchAll(/<ins class="new">([\s\S]*?)<\/ins>/g), (match) => match[1].replace(/<[^>]+>/g, ''));

const one = renderedDiff('The page opens on the sample recipes.', 'The page opens on no recipes.', assets, classes);
check('side by side: only the changed words are marked', dels(one.before).join('|') === 'the sample' && inss(one.after).join('|') === 'no', `${one.before} / ${one.after}`);
check('side by side: nothing is marked on the other side', !dels(one.after).length && !inss(one.before).length);

const inline = renderedInlineDiff('The page opens on the sample recipes.', 'The page opens on no recipes.', assets, classes);
check('in place: the removed run sits before the next word, then the new one', /on <del class="gone">the sample<\/del> <ins class="new">no<\/ins> recipes/.test(inline), inline);
const atEnd = renderedInlineDiff('Reload the page and check again.', 'Reload the page.', assets, classes);
check('in place: punctuation counts on its own, and the removed run keeps its spacing', /the page <del class="gone">and check again<\/del>\./.test(atEnd) && !inss(atEnd).length, atEnd);
const tail = renderedInlineDiff('Reload the page. Then check again', 'Reload the page.', assets, classes);
check('in place: a run removed at the end goes at the end', /page\. <del class="gone">Then check again<\/del><\/p>/.test(tail), tail);

const rich = renderedDiff('Read **the guide** on [state](https://react.dev).', 'Read **the short guide** on [state](https://react.dev).', assets, classes);
check('bold and links survive', /<strong>the <ins class="new">short<\/ins> guide<\/strong>/.test(rich.after) && /<a href="https:\/\/react.dev">state<\/a>/.test(rich.after), rich.after);

const code = renderedDiff('```js\nconst [recipes, setRecipes] = useState(sample);\n```', '```js\nconst [recipes, setRecipes] = useState([]);\n```', assets, classes);
check('a word inside highlighted code is marked', dels(code.before).join('').includes('sample') && inss(code.after).join('').includes('[]') && !dels(code.before).join('').includes('useState'), `${code.before}`);
check('the code block keeps its language label, unmarked', /lesson-code-language">js</.test(code.after));

const callout = renderedDiff('> [!info] Data flow\n> You type a name.', '> [!info] Data flow\n> You type a name and a tag.', assets, classes);
check('callout icons are not words, and only the new words are marked', inss(callout.after).join('|') === 'and a tag', callout.after);
check('the callout title is unmarked', !/callout-title[\s\S]*?<ins/.test(callout.after.split('callout-content')[0] ?? ''));

const long = Array.from({ length: 600 }, (_, index) => `word${index}`).join(' ');
const big = renderedDiff(long, `${long} more`, assets, classes);
check('too long to compare: unmarked', !dels(big.before).length && !inss(big.after).length);
check('and unmarked in place too', !inss(renderedInlineDiff(long, `${long} more`, assets, classes)).length);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
