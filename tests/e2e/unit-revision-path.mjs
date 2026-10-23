// Unit tests for the revision path (src/lib/revision-path.ts): which step an improvement is at, from
// its status, plan, drafts and saved changes, and the one thing to do next. No server needed.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({ entryPoints: [path.join(root, 'src/lib/revision-path.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { deriveRevisionPath } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const target = (fields = {}) => ({ lessonId: 'L1', draft: null, changedRevision: null, publishedRevision: 3, ...fields });
const input = (fields = {}) => ({ status: 'TODO', hasPlan: false, planDraft: null, aiEnabled: true, targets: [target()], ...fields });
const states = (result) => result.steps.map((step) => step.state).join(',');

let path1 = deriveRevisionPath(input());
check('new: feedback done, plan to write', states(path1) === 'done,current,upcoming,upcoming' && path1.next.kind === 'writePlan', states(path1));
check('a plan being drafted', deriveRevisionPath(input({ planDraft: 'working' })).next.kind === 'planDrafting');
check('a plan draft waiting', deriveRevisionPath(input({ planDraft: 'ready' })).next.kind === 'reviewPlanDraft');

path1 = deriveRevisionPath(input({ status: 'IN_PROGRESS', hasPlan: true }));
check('a plan: revise the lesson next', states(path1) === 'done,done,current,upcoming' && path1.next.kind === 'revise' && path1.next.lessonId === 'L1', states(path1));
check('no AI: edit the lesson instead', deriveRevisionPath(input({ status: 'IN_PROGRESS', hasPlan: true, aiEnabled: false })).next.kind === 'edit');
check(
  'changes being written',
  deriveRevisionPath(input({ status: 'IN_PROGRESS', hasPlan: true, targets: [target({ draft: { state: 'working', count: null } })] })).next.kind === 'writing'
);
const waiting = deriveRevisionPath(input({ status: 'IN_PROGRESS', hasPlan: true, targets: [target({ draft: { state: 'ready', count: 4 } })] })).next;
check('changes waiting: review them, with how many', waiting.kind === 'reviewChanges' && waiting.count === 4);

path1 = deriveRevisionPath(input({ status: 'DONE', hasPlan: true, targets: [target({ changedRevision: 5, publishedRevision: 4 })] }));
check('saved as a draft: publish next', states(path1) === 'done,done,done,current' && path1.next.kind === 'publish' && !path1.finished, states(path1));
path1 = deriveRevisionPath(input({ status: 'DONE', hasPlan: true, targets: [target({ changedRevision: 5, publishedRevision: 5 })] }));
check('published: everything done', states(path1) === 'done,done,done,done' && path1.next === null && path1.finished, states(path1));

// A quick fix or a change made without a plan: the plan step is skipped.
path1 = deriveRevisionPath(input({ status: 'DONE', hasPlan: false, targets: [target({ changedRevision: 5, publishedRevision: 5 })] }));
check('done without a plan: plan skipped', states(path1) === 'done,skipped,done,done', states(path1));
// Done by hand on the board, no saved change: nothing to say about publishing.
path1 = deriveRevisionPath(input({ status: 'DONE', hasPlan: true }));
check('done by hand: published skipped, finished', states(path1) === 'done,done,done,skipped' && path1.finished, states(path1));

// Two lessons (a group's copy and the course's own).
const two = (a, b) => input({ status: 'IN_PROGRESS', hasPlan: true, targets: [target({ lessonId: 'G', ...a }), target({ lessonId: 'C', ...b })] });
path1 = deriveRevisionPath(two({ changedRevision: 4, publishedRevision: 4 }, {}));
check('one of two saved: the other is next', states(path1) === 'done,done,current,upcoming' && path1.next.kind === 'revise' && path1.next.lessonId === 'C', JSON.stringify(path1.next));
path1 = deriveRevisionPath(two({ changedRevision: 4, publishedRevision: 4 }, { draft: { state: 'ready', count: 2 } }));
check('the other has changes waiting', path1.next.kind === 'reviewChanges' && path1.next.lessonId === 'C');
path1 = deriveRevisionPath({ ...two({ changedRevision: 4, publishedRevision: 4 }, { changedRevision: 9, publishedRevision: 8 }), status: 'DONE' });
check('both saved, one unpublished: publish that one', path1.next.kind === 'publish' && path1.next.lessonId === 'C');

const ignored = deriveRevisionPath(input({ status: 'IGNORED', hasPlan: true }));
check('ignored: start again', ignored.next.kind === 'startAgain' && !ignored.finished);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
