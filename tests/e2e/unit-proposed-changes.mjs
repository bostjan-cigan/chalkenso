// Unit tests for proposed changes (the lesson workspace's revision helpers): a draft split into
// separate changes against the text it was written from, word diffs inside edited paragraphs, some
// changes kept and others skipped, each change placed against the person's edits since, and Undo
// after Apply that keeps what was typed since. No server needed; esbuild compiles the module.
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
const { proposeChanges, applyChanges, placeChanges, applyOnto, revertApplied, transplantChanges, splitBlocks, changeSteps, stepKind, patchWords, changesNotIn } = await import(
  `data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`
);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const blocks = (text) => splitBlocks(text).map((block) => block.replace(/\s+/g, ' ').trim()).join('\n');
const all = () => true;

const base = [
  '## Validating input',
  'APIFlask validates the input against it and returns a 400 with a clear message.',
  'The schema lives next to the route.',
  '## Run it',
  'Send the request again: you should see the error.',
  'That is all for this part.',
].join('\n\n');

// One word changed: one edit, with its words.
const oneWord = base.replace('returns a 400', 'returns a 422');
const [edit] = proposeChanges(base, oneWord);
check('a one-word edit is one change', proposeChanges(base, oneWord).length === 1 && edit.kind === 'edit');
check('with the words that changed', edit.words.some((w) => w.kind === 'removed' && w.text.includes('400')) && edit.words.some((w) => w.kind === 'added' && w.text.includes('422')));
check('and where it is', edit.section === 'Validating input', edit.section);

// A new section: one add, placed before the block it comes before.
const added = base.replace('## Run it', '> [!tip] Why 422\n> 400 means unreadable; 422 means wrong data.\n\n## Run it');
const adds = proposeChanges(base, added);
check('a new paragraph is one add', adds.length === 1 && adds[0].kind === 'add' && adds[0].at === 3, JSON.stringify(adds));
check('two new paragraphs together are one add', proposeChanges(base, base.replace('## Run it', 'One.\n\nTwo.\n\n## Run it')).filter((c) => c.kind === 'add')[0].after.length === 2);
check('a paragraph at the very end is an add at the end', proposeChanges(base, `${base}\n\nThe end.`)[0].at === 6);

// A removed paragraph: one remove.
const removed = base.replace('The schema lives next to the route.\n\n', '');
const removes = proposeChanges(base, removed);
check('a removed paragraph is one remove', removes.length === 1 && removes[0].kind === 'remove' && removes[0].before[0].startsWith('The schema'));

// Formatting only: nothing.
check('whitespace alone is no change', proposeChanges(base, base.replace('clear message.', 'clear   message.')).length === 0);
check('list markers alone are no change', proposeChanges('Steps:\n\n* one\n* two', 'Steps:\n\n- one\n- two').length === 0);

// Several changes: keep some, skip others.
const draft = base
  .replace('returns a 400', 'returns a 422')
  .replace('## Run it', 'Tip: 422 means the data is wrong.\n\n## Run it')
  .replace('Send the request again: you should see the error.', 'Send the request with an empty body: you should see 422.');
const changes = proposeChanges(base, draft);
check('three changes in order', changes.map((c) => c.kind).join(',') === 'edit,add,edit', changes.map((c) => c.kind).join(','));
check('ids are unique', new Set(changes.map((c) => c.id)).size === changes.length);
check('ids are stable', proposeChanges(base, draft).map((c) => c.id).join() === changes.map((c) => c.id).join());
check('keeping all gives the draft', blocks(applyChanges(base, changes, all)) === blocks(draft));
check('keeping none gives the base', blocks(applyChanges(base, changes, () => false)) === blocks(base));
const two = applyChanges(base, changes, (c) => c !== changes[2]);
check('keeping two of three', two.includes('422 with') && two.includes('Tip: 422') && two.includes('Send the request again'));
check('code edits are changes too', proposeChanges('Run:\n\n```sh\nflask run\n```', 'Run:\n\n```sh\nflask run --debug\n```')[0]?.kind === 'edit');

// Against the person's edits since.
const ours = base.replace('That is all for this part.', 'That is all for this part. Well done.');
let states = placeChanges(base, ours, changes);
check('untouched places are clean', changes.every((c) => states[c.id] === 'clean'), JSON.stringify(states));
const theirsToo = base.replace('returns a 400', 'returns a 400 (bad request)');
states = placeChanges(base, theirsToo, changes);
check('an edit to the same paragraph is a conflict', states[changes[0].id] === 'conflict' && states[changes[2].id] === 'clean', JSON.stringify(states));
const deleted = base.replace('Send the request again: you should see the error.\n\n', '');
states = placeChanges(base, deleted, changes);
check('a paragraph the person removed is gone', states[changes[2].id] === 'gone', JSON.stringify(states));
const alreadyIn = applyChanges(base, changes, (c) => c === changes[0]);
states = placeChanges(base, alreadyIn, changes);
check('a change already in the text is done', states[changes[0].id] === 'done' && states[changes[1].id] === 'clean', JSON.stringify(states));

// Apply onto the text now.
const applied = applyOnto(base, ours, changes, (c) => c !== changes[1]);
check('apply keeps the person’s edit', applied.text.includes('Well done.'));
check('and puts in the kept changes only', applied.text.includes('422 with') && !applied.text.includes('Tip: 422') && applied.applied === 2);
const conflictKeepYours = applyOnto(base, theirsToo, changes, all);
check('a conflict keeps yours by default', conflictKeepYours.text.includes('(bad request)') && !conflictKeepYours.text.includes('returns a 422'));
const conflictUseProposed = applyOnto(base, theirsToo, changes, all, (c) => c === changes[0]);
check('“Use proposed” puts the proposal in instead', conflictUseProposed.text.includes('returns a 422') && !conflictUseProposed.text.includes('(bad request)'));

// Undo after Apply keeps what was typed since.
const afterApply = applied.text;
const typedSince = afterApply.replace('The schema lives next to the route.', 'The schema lives next to the route, in schemas.py.');
const undone = revertApplied(afterApply, typedSince, ours);
check('undo takes the changes out', !undone.includes('422') && undone.includes('returns a 400'));
check('and keeps what was typed since', undone.includes('in schemas.py') && undone.includes('Well done.'));

// Changes saved in a group's copy, carried onto the main course's lesson.
const copyBefore = [
  '## Volumes',
  'A named volume keeps the data outside the container.',
  'Run `docker compose up` to start both.',
  '## Checking it',
  'Open the page and add a recipe.',
].join('\n\n');
const copyAfter = copyBefore
  .replace('keeps the data outside the container.', 'keeps Postgres data outside the container, so `down` keeps it.')
  .replace('Open the page and add a recipe.', 'Open the page and add a recipe.\n\nStop and start it again: the recipe is still there.');
const same = transplantChanges(copyBefore, copyAfter, copyBefore);
check('onto the same text: every change goes in', same.total === 2 && same.placed === 2 && blocks(same.text) === blocks(copyAfter), JSON.stringify(same));
const courseOwn = copyBefore.replace('Run `docker compose up` to start both.', 'Run `docker compose up -d` to start both in the background.');
const around = transplantChanges(copyBefore, copyAfter, courseOwn);
check('the course’s own wording elsewhere stays', around.placed === 2 && around.text.includes('-d` to start both in the background') && around.text.includes('so `down` keeps it') && around.text.includes('still there'));
const courseDiffers = copyBefore.replace('A named volume keeps the data outside the container.', 'Volumes hold data that outlives a container.');
const partly = transplantChanges(copyBefore, copyAfter, courseDiffers);
check('where the course differs, the change is left out', partly.placed === 1 && partly.unplaced.length === 1 && partly.unplaced[0].kind === 'edit', JSON.stringify(partly.unplaced));
check('and the course’s paragraph stays as it is', partly.text.includes('outlives a container') && !partly.text.includes('so `down` keeps it') && partly.text.includes('still there'));
const already = transplantChanges(copyBefore, copyAfter, copyAfter);
check('changes it already has count as placed', already.placed === 2 && already.unplaced.length === 0 && blocks(already.text) === blocks(copyAfter));
check('nothing changed in the copy: nothing to carry', transplantChanges(copyBefore, copyBefore, courseOwn).total === 0);

// Undo of the copy's save carries its change back out of the course's draft; another save's stays.
const carriedThere = transplantChanges(copyBefore, copyAfter, courseOwn).text;
check('carried back, the course’s text is as it was', blocks(transplantChanges(copyAfter, copyBefore, carriedThere).text) === blocks(courseOwn));
const nextBefore = copyAfter;
const nextAfter = copyAfter.replace('## Checking it', '## Checking it\n\nKeep the terminal open.');
const bothThere = transplantChanges(nextBefore, nextAfter, carriedThere).text;
const firstTakenBack = transplantChanges(copyAfter, copyBefore, bothThere).text;
check(
  'taking back the first save keeps the second’s change',
  firstTakenBack.includes('Keep the terminal open.') && !firstTakenBack.includes('so `down` keeps it') && !firstTakenBack.includes('still there'),
  firstTakenBack
);

// The copies drift apart a little as each is edited: changes still go where the text is alike.
check(
  'an edit’s words go into a paragraph reworded elsewhere',
  patchWords('A named volume keeps the data outside the container.', 'A named volume keeps Postgres data outside the container.', 'A named volume keeps the data outside the container, neatly.') ===
    'A named volume keeps Postgres data outside the container, neatly.'
);
check('a run whose own words changed there too: no patch', patchWords('Keeps the data outside.', 'Keeps Postgres data outside.', 'Keeps your data outside.') === null);
check('words added at the end keep the paragraph’s ending', patchWords('Run it.', 'Run it again.', 'Now run it.\n') === 'Now run it again.\n', JSON.stringify(patchWords('Run it.', 'Run it again.', 'Now run it.\n')));
const drifted = copyBefore
  .replace('A named volume keeps the data outside the container.', 'A named volume really keeps the data outside the container.')
  .replace('Open the page and add a recipe.', 'Open the page in your browser and add a recipe.');
const nearby = transplantChanges(copyBefore, copyAfter, drifted);
check('where the course reworded a little, every change still goes in', nearby.placed === 2 && nearby.unplaced.length === 0 && nearby.nearby === 1, JSON.stringify(nearby));
check('the edit keeps the course’s own words', nearby.text.includes('A named volume really keeps Postgres data outside the container, so `down` keeps it.'), nearby.text);
const clash = transplantChanges(copyBefore, copyAfter, copyBefore.replace('outside the container.', 'outside the container, even after a rebuild.'));
check('where the course changed the same words, the copy’s paragraph is proposed in its place', clash.placed === 2 && clash.text.includes('so `down` keeps it.') && !clash.text.includes('even after a rebuild'), clash.text);
check('the new paragraph follows the one it followed', /in your browser and add a recipe\.\n\nStop and start it again/.test(nearby.text), nearby.text);
const withoutCheck = copyBefore.replace('## Checking it\n\nOpen the page and add a recipe.', '## Checking it\n\nVisit the site, then create one new entry.');
const inSection = transplantChanges(copyBefore, copyAfter, withoutCheck);
check('with nothing alike to follow, a new paragraph goes at the end of its section', inSection.text.trimEnd().endsWith('Stop and start it again: the recipe is still there.'), inSection.text);
const removeBefore = ['## Volumes', 'Note: older Compose files needed a version line.', 'Run it.'].join('\n\n');
const removeAfter = ['## Volumes', 'Run it.'].join('\n\n');
const removeDrift = ['## Volumes', 'Note: older Compose files needed a version line at the top.', 'Run it now.'].join('\n\n');
const dropped = transplantChanges(removeBefore, removeAfter, removeDrift);
check('a removal goes on a paragraph that’s nearly the same', dropped.placed === 1 && !dropped.text.includes('version line') && dropped.text.includes('Run it now.'), JSON.stringify(dropped));
const unlike = ['## Volumes', 'Compose files once began with a version number; now they don’t.', 'Run it now.'].join('\n\n');
check('but not on one that only shares a few words', transplantChanges(removeBefore, removeAfter, unlike).unplaced.length === 1);

// Steps as a reader takes them: a rewrite (removed, then new in its place) is one step.
const stepBase = ['## Adding recipes', 'It works, but notice the friction creeping in: a useState per field.', 'Next, a form library.', '## Validation', 'Note: older React versions bound handlers in the constructor.', 'Rules live next to their fields.'].join('\n\n');
const stepDraft = stepBase
  .replace('It works, but notice the friction creeping in: a useState per field.', 'Here is what happens on one click of Add: props flow down, events flow up.')
  .replace('Note: older React versions bound handlers in the constructor.\n\n', '')
  .replace('Next, a form library.', 'Next, a form library.\n\nCheck it: add a recipe and reload.');
const stepChanges = proposeChanges(stepBase, stepDraft);
const steps = changeSteps(stepChanges);
check('a rewrite is one step', steps.length === 3 && stepKind(steps[0]) === 'rewrite' && steps[0][0].kind === 'remove' && steps[0][1].kind === 'add', JSON.stringify(steps.map((step) => step.map((change) => change.kind))));
check('a lone addition and a lone removal are steps of their own', stepKind(steps[1]) === 'add' && stepKind(steps[2]) === 'remove');
check('every change is in one step, in order', steps.flat().map((change) => change.id).join() === stepChanges.map((change) => change.id).join());
const editsOnly = changeSteps(proposeChanges('One two three four.\n\nFive six seven eight.', 'One two three nine.\n\nFive six seven ten.'));
check('neighbouring edits stay apart', editsOnly.length === 2 && editsOnly.every((step) => stepKind(step) === 'edit'));

// Carrying to a lesson where nothing fits: no draft at all, and the lesson's own spacing kept.
const rewroteBefore = ['## State', 'Old paragraph about useState that the copy rewrote a little.', 'Another paragraph.'].join('\n\n');
const rewroteAfter = ['## State', 'Old paragraph about useState that the copy rewrote a little, and now explains hooks.', 'Another paragraph.'].join('\n\n');
for (const [name, course] of [
  ['extra blank lines', ['## State', 'The course explains hooks its own way, differently worded entirely.', '', 'Another paragraph.'].join('\n\n')],
  ['Windows line endings', ['## State', 'The course explains hooks its own way, differently worded entirely.', 'Another paragraph.'].join('\r\n\r\n')],
]) {
  const none = transplantChanges(rewroteBefore, rewroteAfter, course);
  check(`nothing fits (${name}): the lesson comes back as it was`, none.text === course && none.placed === 0 && none.unplaced.length === 1 && !proposeChanges(course, none.text).length, JSON.stringify(none));
}

// A rewrite (a paragraph removed, an unlike one in its place) goes in whole, or not at all.
const swapBefore = ['## State', 'Keep every input value in its own useState call and reset each by hand.', 'Next, a form library.'].join('\n\n');
const swapAfter = ['## State', 'Here is what happens on one click of Add: props flow down, events flow up.', 'Next, a form library.'].join('\n\n');
const alike = ['## State', 'Keep every input value in its own useState call, and reset each one by hand.', 'Next, a form library, at last.'].join('\n\n');
const swapped = transplantChanges(swapBefore, swapAfter, alike);
check('a rewrite goes where the old paragraph is, a little reworded', swapped.unplaced.length === 0 && swapped.text.includes('props flow down') && !swapped.text.includes('reset each one by hand'), swapped.text);
check('in its place, once', (swapped.text.match(/props flow down/g) ?? []).length === 1 && /## State\n\nHere is what happens/.test(swapped.text), swapped.text);
const unlikeCourse = ['## State', 'Hooks are functions that let a component remember things between renders.', 'Next, a form library, at last.'].join('\n\n');
const notSwapped = transplantChanges(swapBefore, swapAfter, unlikeCourse);
check('with nothing like the old paragraph there, neither half goes in', notSwapped.text === unlikeCourse && notSwapped.unplaced.length === 2 && !notSwapped.text.includes('props flow down'), JSON.stringify(notSwapped));

// What a group's copy changed that the main course's lesson doesn't have yet ("Didn't fit").
const copyEdits = proposeChanges(copyBefore, copyAfter);
const editOf = copyEdits.find((change) => change.kind === 'edit');
const addOf = copyEdits.find((change) => change.kind === 'add');
check('the copy made an edit and an addition', Boolean(editOf && addOf), JSON.stringify(copyEdits.map((change) => change.kind)));
check('a lesson without them is missing both', changesNotIn(copyBefore, copyEdits).length === 2);
check('a lesson with both, in the copy’s words, misses neither', changesNotIn(copyAfter, copyEdits).length === 0);
const inItsOwnWords = copyAfter.replace('keeps Postgres data outside the container, so `down` keeps it.', 'keeps your Postgres data outside the container, so `down` keeps it.');
check('an edit made in the lesson’s own words counts as there', !changesNotIn(inItsOwnWords, copyEdits).some((change) => change.kind === 'edit'), inItsOwnWords);
check('a paragraph only reworded elsewhere doesn’t count as the edit', changesNotIn(drifted, copyEdits).some((change) => change.kind === 'edit'));
const removal = proposeChanges(removeBefore, removeAfter);
check('a removal is missing while its paragraph (or one nearly the same) is there', changesNotIn(removeDrift, removal).length === 1 && changesNotIn(['## Volumes', 'Run it now.'].join('\n\n'), removal).length === 0);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
