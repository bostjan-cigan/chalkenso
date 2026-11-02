// Unit tests for background AI drafts (src/lib/ai-draft-progress.ts): the plan shown while Claude
// writes it (inside its tag, without a closing tag that is still arriving), when a running draft
// counts as stopped (made here, or a hand-off to someone's Claude), a hand-off's stage from Claude's
// tool calls, the elapsed clock, and how far a revision is, section by section (src/lib/revision-progress.ts).
// No server needed; esbuild compiles the modules.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({ entryPoints: [path.join(root, 'src/lib/ai-draft-progress.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { partialTag, isStale, elapsed, STALE_MS, stillWorking, handoffStage, nextHandoffStage, GIVE_UP_MS, WAIT_FOR_MS, CONNECTOR_READ } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
const liveOut = await build({ entryPoints: [path.join(root, 'src/lib/revision-progress.ts')], bundle: true, format: 'esm', write: false, platform: 'node', tsconfig: path.join(root, 'tsconfig.json') });
const { revisionLive } = await import(`data:text/javascript,${encodeURIComponent(liveOut.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

// The plan as it is written.
check('nothing before the tag', partialTag('Let me look at the feedback.', 'plan') === '');
check('the tag only just opened', partialTag('<plan>', 'plan') === '');
check('text so far', partialTag('<plan>Add a step', 'plan') === 'Add a step');
check('words before the tag are left out', partialTag('Sure.\n<plan>Add a step', 'plan') === 'Add a step');
check('a closing tag on its way is not shown', partialTag('<plan>Add a step.</pl', 'plan') === 'Add a step.');
check('a lone < waits too', partialTag('<plan>Add a step <', 'plan') === 'Add a step ');
check('closed: only what is inside', partialTag('<plan>Add a step.</plan>\n<scope>group only', 'plan') === 'Add a step.');
check('a < that is not the closing tag stays', partialTag('<plan>if a < b', 'plan') === 'if a < b');
check('leading blank lines trimmed', partialTag('<plan>\n\nAdd', 'plan') === 'Add');

// Stopped drafts.
const now = Date.parse('2026-10-19T12:00:00Z');
check('fresh: still running', !isStale(new Date(now - 5_000), now));
check('silent too long: stopped', isStale(new Date(now - STALE_MS - 1), now));
check('a date string works too', isStale(new Date(now - STALE_MS - 1).toISOString(), now));

// Still being written: here (heard of lately), or a hand-off Claude may still take up.
const at = (ms) => new Date(now - ms);
const row = (status, via, created, updated = created) => ({ status, via, createdAt: at(created), updatedAt: at(updated) });
check('here, heard of lately', stillWorking(row('WORKING', 'app', 60_000, 5_000), now));
check('here, silent too long', !stillWorking(row('WORKING', 'app', 60_000, STALE_MS + 1), now));
check('here, finished', !stillWorking(row('OPEN', 'app', 5_000), now));
// Claude at it by itself (started by a read, no hand-off): working while it's heard from, then gone.
check('Claude reading by itself, heard from lately', stillWorking(row('WORKING', CONNECTOR_READ, 5 * 60_000, 30_000), now));
check('Claude reading by itself, quiet past the limit: no longer working', !stillWorking(row('WORKING', CONNECTOR_READ, 20 * 60_000, GIVE_UP_MS + 1), now));
check('an app row is never pending', !stillWorking(row('PENDING', 'app', 5_000), now));
check('a hand-off waiting for Claude', stillWorking(row('PENDING', 'connector', 30 * 60_000), now));
check('a hand-off waiting over an hour', !stillWorking(row('PENDING', 'connector', WAIT_FOR_MS + 1), now));
check('Claude quiet for minutes while it writes', stillWorking(row('WORKING', 'connector', 9 * 60_000, 8 * 60_000), now));
check('Claude silent too long since its last tool call', !stillWorking(row('WORKING', 'connector', 20 * 60_000, GIVE_UP_MS + 1), now));

// A hand-off's stage, from Claude's tool calls.
check('not picked up: waiting', handoffStage('PENDING', undefined) === 'waiting');
check('picked up, nothing said: reading', handoffStage('WORKING', undefined) === 'reading');
check('picked up: what it said', handoffStage('WORKING', 'writing') === 'writing');
check('picked up is never waiting', handoffStage('WORKING', 'waiting') === 'reading');
check('first read starts it', nextHandoffStage('PENDING', undefined) === 'reading');
check('the next read: writing', nextHandoffStage('WORKING', 'reading') === 'writing');
check('more reads: still writing', nextHandoffStage('WORKING', 'writing') === 'writing');
check('an old row with no stage: writing on the next read', nextHandoffStage('WORKING', undefined) === 'writing');

// The clock.
check('seconds', elapsed(new Date(now - 7_000).toISOString(), now) === '0:07');
check('minutes', elapsed(new Date(now - 102_000).toISOString(), now) === '1:42');
check('never negative', elapsed(new Date(now + 5_000).toISOString(), now) === '0:00');

// How far a revision is.
const lesson = 'Opening words.\n\n## First\n\nOne.\n\n## Second\n\nTwo.\n\n## Third\n\nThree.\n';
const states = (live) => live.sections.map((section) => section.state).join(' ');
const start = revisionLive('Let me think', lesson);
check('nothing written: all to come, no summary', states(start) === 'todo todo todo todo' && start.summary === '' && start.changes === 0);
check('the summary shows as soon as it is written', revisionLive('<summary>Explains why', lesson).summary === 'Explains why');
const mid = revisionLive('<summary>Done.</summary>\n<lesson>Opening words.\n\n## First\n\nOne, changed a lot now.\n\n## Second\n\nTw', lesson);
check('sections written are done, the last one is being written', states(mid) === 'done done writing todo', states(mid));
check('a finished section counts its changes', mid.sections[1].changes === 1 && mid.sections[0].changes === 0, JSON.stringify(mid.sections));
check('the one being written says none yet, however it reads so far', mid.sections[2].changes === 0 && mid.changes === 1);
const grown = revisionLive(`<summary>S</summary><lesson>${lesson}\n\nA long new paragraph.\n\nAnother.`, lesson);
check('a lesson that grows stays on its last section', states(grown) === 'done done done writing', states(grown));
const closed = revisionLive(`<summary>S</summary><lesson>${lesson}\n\nNew at the end.</lesson>`, lesson);
check('closed: all done, the last one counted', states(closed) === 'done done done done' && closed.sections[3].changes === 1 && closed.changes === 1, JSON.stringify(closed));
const part = revisionLive('<summary>S</summary><lesson>## Second\n\nTwo, reworded', '## Second\n\nTwo.\n');
check('only a part of the lesson: only its sections', part.sections.length === 1 && part.sections[0].heading === 'Second' && states(part) === 'writing');
const added = revisionLive('<summary>S</summary><lesson>Opening words.\n\n## First\n\nOne.\n\n## Brand new\n\nText.\n\n## Second\n\nTw', lesson);
check('a new heading counts on the section before it', added.sections[1].changes === 1 && states(added) === 'done done writing todo', JSON.stringify(added));
const skipped = revisionLive('<summary>S</summary><lesson>Opening words.\n\n## Third\n\nThr', lesson);
check('a section left out is passed', states(skipped) === 'done done done writing', states(skipped));

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
