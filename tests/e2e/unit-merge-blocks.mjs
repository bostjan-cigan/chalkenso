// Unit tests for applying a draft on top of the person's edits (mergeBlocks in the lesson
// workspace's revision helpers). No server needed; esbuild compiles the module on the fly.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({
  entryPoints: [path.join(root, 'src/app/admin/courses/components/workspace/revision.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
});
const { mergeBlocks, splitBlocks } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const base = [
  '# Course intro',
  'Duration: 1.5 hours',
  '## Run Flask and Postgres with one command',
  'Create compose.yaml in the project folder.',
  '```bash\ndocker compose up --build\n```',
  '## Your first page',
  'Open http://localhost:5000.',
].join('\n\n');
const linuxNote = '> [!note] On Linux\n> Add yourself to the docker group, log out and in, then run it again.';
const draft = base.replace('Create compose.yaml in the project folder.', `Create compose.yaml in the project folder.\n\n${linuxNote}`);

// Nothing edited since the draft was written: the draft as it is.
const clean = mergeBlocks(base, base, draft);
check('no edits of your own: the draft comes through', splitBlocks(clean.text).join('|') === splitBlocks(draft).join('|'));
check('no edits of your own: one change applied, none skipped', clean.applied === 1 && clean.skipped.length === 0, JSON.stringify(clean));

// An unsaved edit elsewhere is kept, and Claude's note is added.
const ours = base.replace('Duration: 1.5 hours', 'Duration: 1.5 hours (plus 15 minutes for setup)');
const both = mergeBlocks(base, ours, draft);
check('your edit elsewhere is kept', both.text.includes('(plus 15 minutes for setup)'));
check("Claude's addition is applied", both.text.includes('[!note] On Linux'));
check('nothing skipped when the changes are apart', both.skipped.length === 0 && both.applied === 1, JSON.stringify(both.skipped));
check('order is kept', both.text.indexOf('Duration') < both.text.indexOf('On Linux') && both.text.indexOf('On Linux') < both.text.indexOf('## Your first page'));

// Both changed the same paragraph: yours stays, the overlap is listed.
const claudeDuration = draft.replace('Duration: 1.5 hours', 'Duration: about 2 hours');
const overlap = mergeBlocks(base, ours, claudeDuration);
check('the same paragraph changed by both: yours kept', overlap.text.includes('(plus 15 minutes for setup)') && !overlap.text.includes('about 2 hours'));
check('the same paragraph changed by both: listed as skipped', overlap.skipped.length === 1 && overlap.skipped[0].draft.includes('about 2 hours'), JSON.stringify(overlap.skipped));
check("the same paragraph changed by both: Claude's other change still applied", overlap.text.includes('[!note] On Linux') && overlap.applied === 1);

// The same change made by both is not a conflict.
const sameEdit = mergeBlocks(base, ours, draft.replace('Duration: 1.5 hours', 'Duration: 1.5 hours (plus 15 minutes for setup)'));
check('the same change on both sides is not a conflict', sameEdit.skipped.length === 0 && sameEdit.text.split('plus 15 minutes').length === 2);

// The lesson was saved with another change after Claude drafted (the stored base is older).
const savedSince = base.replace('Open http://localhost:5000.', 'Open http://localhost:5000 in your browser.');
const later = mergeBlocks(base, savedSince, draft);
check('a change saved after the draft is kept', later.text.includes('in your browser'));
check('and the draft still lands on top of it', later.text.includes('[!note] On Linux') && later.skipped.length === 0);

// Code fences and headings stay whole.
const withCode = mergeBlocks(base, ours, draft.replace('docker compose up --build', 'docker compose up --build -d'));
check('a changed code block is applied whole', withCode.text.includes('```bash\ndocker compose up --build -d\n```'));
check('headings kept', ['# Course intro', '## Run Flask and Postgres with one command', '## Your first page'].every((heading) => withCode.text.includes(heading)));

// Claude removes a paragraph you didn't touch: removed; one you edited: kept and listed.
const removed = mergeBlocks(base, ours, draft.replace('\n\nOpen http://localhost:5000.', ''));
check("a paragraph Claude removed (and you didn't touch) is removed", !removed.text.includes('Open http://localhost:5000') && removed.skipped.length === 0);
const removedYours = mergeBlocks(base, ours, draft.replace('Duration: 1.5 hours\n\n', ''));
check('a paragraph Claude removed but you edited is kept and listed', removedYours.text.includes('plus 15 minutes') && removedYours.skipped.length === 1);

// The visual editor re-serialises Markdown: reformatting alone isn't an edit.
const listBase = 'Steps:\n\n* Open a terminal\n* Run the stack\n\nCheck the page.';
const listAsEditor = 'Steps:\n\n- Open a terminal\n- Run the stack\n\nCheck the page.';
const listOurs = listAsEditor.replace('Check the page.', 'Check the page in your browser.');
const listDraft = listBase.replace('* Run the stack', '* Run the stack with docker compose up');
const reformatted = mergeBlocks(listBase, listOurs, listDraft, listAsEditor);
check("a list the editor reformatted still takes Claude's change", reformatted.text.includes('docker compose up') && reformatted.skipped.length === 0, JSON.stringify(reformatted));
check('and keeps your edit', reformatted.text.includes('in your browser'));
const withoutHint = mergeBlocks(listBase, listOurs, listDraft);
check('list markers compare alike even without the editor base', withoutHint.skipped.length === 0 && withoutHint.text.includes('docker compose up'));
// Reformatting the comparison doesn't absorb (bold written another way) needs the editor base.
const emBase = 'Steps:\n\nRun __the__ stack\n\nCheck the page.';
const emAsEditor = 'Steps:\n\nRun **the** stack\n\nCheck the page.';
const emOurs = emAsEditor.replace('Check the page.', 'Check the page in your browser.');
const emDraft = emBase.replace('Run __the__ stack', 'Run __the__ stack with docker compose up');
check('with the editor base, reformatted bold still takes the change', mergeBlocks(emBase, emOurs, emDraft, emAsEditor).skipped.length === 0);
check('without it, the reformatted paragraph counts as yours (kept, listed)', mergeBlocks(emBase, emOurs, emDraft).skipped.length === 1);
check('an editor base with other blocks is ignored', mergeBlocks(emBase, emOurs, emDraft, 'One block only').skipped.length === 1);

// Edits in neighbouring paragraphs don't collide.
const neighbours = mergeBlocks('A one.\n\nB two.\n\nC three.', 'A one.\n\nB two, yours.\n\nC three.', 'A one.\n\nB two.\n\nC three, Claude.');
check('neighbouring edits both land', neighbours.text === 'A one.\n\nB two, yours.\n\nC three, Claude.' && neighbours.skipped.length === 0, JSON.stringify(neighbours));

// One side only adds paragraphs next to one the other side edited.
const appended = mergeBlocks('A one.\n\nB two.', 'A one.\n\nB two, yours.', 'A one.\n\nB two.\n\nC new from Claude.');
check("Claude adds a paragraph after one you edited: both", appended.text === 'A one.\n\nB two, yours.\n\nC new from Claude.' && appended.skipped.length === 0, JSON.stringify(appended));
const yoursAdded = mergeBlocks('A one.\n\nB two.', 'A one.\n\nB two.\n\nC new from you.', 'A one.\n\nB two, Claude.');
check("you add a paragraph after one Claude edited: both", yoursAdded.text === 'A one.\n\nB two, Claude.\n\nC new from you.' && yoursAdded.skipped.length === 0, JSON.stringify(yoursAdded));

// Trailing newline follows your text.
check('trailing newline follows your text', mergeBlocks(base, `${ours}\n`, draft).text.endsWith('\n') && !mergeBlocks(base, ours, draft).text.endsWith('\n'));

process.exit(failed ? 1 : 0);
