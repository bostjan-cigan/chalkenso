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

// Readable, not confetti.
const reworded = renderedInlineDiff('The function then calls itself again with a smaller input until it reaches zero.', 'A function keeps calling itself, and each call waits for the next, until the base case is reached.', assets, classes);
check('a sentence mostly reworded is replaced whole', dels(reworded).length === 1 && inss(reworded).length === 1 && dels(reworded)[0].startsWith('The function') && inss(reworded)[0].startsWith('A function'), reworded);
const bridged = renderedDiff('Open the settings page and then click on the big save button to finish.', 'Open the account page and then press on the big save button to finish.', assets, classes);
check('changes with a word or two between them read as one phrase', dels(bridged.before).length === 2 || dels(bridged.before).join(' ').includes('settings'), bridged.before);
const twoApart = renderedDiff('Open the red door and close the blue door at once please.', 'Open the green door and close the yellow door at once please.', assets, classes);
check('a word or two kept between two changes goes with them', dels(twoApart.before).length >= 1, twoApart.before);
const close = renderedDiff('Pick red then blue now.', 'Pick green then yellow now.', assets, classes);
check('one kept word between two changes is bridged', dels(close.before).join('|') === 'red then blue' && inss(close.after).join('|') === 'green then yellow', close.before);
const small = renderedDiff('A recursive function calls itself on a smaller piece of the problem until it stops.', 'A recursive function calls itself on a smaller part of the problem until it stops.', assets, classes);
check('a small edit stays one word', dels(small.before).join('|') === 'piece' && inss(small.after).join('|') === 'part', small.before);
const onlyAdded = renderedDiff('Keep it short.', 'Keep it short and add a whole new clause right here at the end.', assets, classes);
check('pure additions stay exact', !dels(onlyAdded.before).length && inss(onlyAdded.after).join('').startsWith('and add'), onlyAdded.after);

const long = Array.from({ length: 600 }, (_, index) => `word${index}`).join(' ');
const big = renderedDiff(long, `${long} more`, assets, classes);
check('too long to compare: unmarked', !dels(big.before).length && !inss(big.after).length);
check('and unmarked in place too', !inss(renderedInlineDiff(long, `${long} more`, assets, classes)).length);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
