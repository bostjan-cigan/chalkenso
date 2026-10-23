// Unit tests for background AI drafts (src/lib/ai-draft-progress.ts): the plan shown while Claude
// writes it (inside its tag, without a closing tag that is still arriving), when a running draft
// counts as stopped (made here, or a hand-off to someone's Claude), a hand-off's stage from Claude's
// tool calls, and the elapsed clock. No server needed; esbuild compiles the module.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({ entryPoints: [path.join(root, 'src/lib/ai-draft-progress.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { partialTag, isStale, elapsed, STALE_MS, stillWorking, handoffStage, nextHandoffStage, GIVE_UP_MS, WAIT_FOR_MS, CONNECTOR_READ } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

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

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
