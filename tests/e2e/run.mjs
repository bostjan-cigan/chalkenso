// Runs the end-to-end suites against the server at BASE_URL (default http://localhost:3100):
// the shared ones, and the cloud ones when the server is the cloud edition and they're here.
// Suites that can't run in the server's state (sign-up closed, say) skip themselves.
//   yarn test:e2e                     every suite that fits
//   yarn test:e2e e2e-demo.mjs        just these
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BASE, serverEdition } from './helpers.mjs';

const SHARED = ['e2e.mjs', 'e2e-demo.mjs', 'e2e-group.mjs', 'e2e-access.mjs', 'e2e-instructor-links.mjs', 'e2e-group-instructors.mjs', 'e2e-accounts.mjs', 'e2e-sessions.mjs', 'e2e-export.mjs', 'unit-access-rules.mjs', 'unit-callouts.mjs', 'unit-merge-blocks.mjs', 'unit-ai-drafts.mjs', 'unit-proposed-changes.mjs', 'unit-revision-path.mjs', 'unit-plan-scope.mjs', 'unit-lesson-sections.mjs', 'unit-draft-diagrams.mjs', 'unit-feedback-rounds.mjs', 'e2e-improve.mjs', 'e2e-vault-feedback.mjs', 'e2e-obsidian-connect.mjs'];
const here = path.dirname(new URL(import.meta.url).pathname);
/** The cloud edition's own suites, in the private repository only. */
const CLOUD = existsSync(path.join(here, 'cloud'))
  ? readdirSync(path.join(here, 'cloud'))
      .filter((file) => file.endsWith('.mjs'))
      .sort()
      .map((file) => `cloud/${file}`)
  : [];

const edition = await serverEdition().catch(() => {
  console.error(`No server at ${BASE}. Start one (yarn dev) or set BASE_URL.`);
  process.exit(1);
});
const requested = process.argv.slice(2);
const suites = requested.length
  ? requested
  : [...SHARED, ...(edition === 'cloud' ? CLOUD : [])];

console.log(`${edition} edition at ${BASE}: ${suites.join(', ')}\n`);
const summary = [];
for (const suite of suites) {
  console.log(`── ${suite}`);
  const result = spawnSync(process.execPath, [path.join(here, suite)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
  process.stdout.write(result.stdout);
  const lines = result.stdout.split('\n');
  const passed = lines.filter((line) => line.startsWith('PASS')).length;
  const failed = lines.filter((line) => line.startsWith('FAIL')).length;
  const skipped = lines.some((line) => line.startsWith('SKIPPED'));
  const ok = result.status === 0 && failed === 0;
  summary.push({ suite, passed, failed, skipped, ok });
  console.log('');
}

console.log('Summary');
for (const { suite, passed, failed, skipped, ok } of summary) {
  console.log(`  ${ok ? (skipped ? 'skip' : 'ok  ') : 'FAIL'}  ${suite.padEnd(24)} ${skipped ? 'skipped' : `${passed} passed${failed ? `, ${failed} failed` : ''}`}`);
}
process.exit(summary.every((entry) => entry.ok) ? 0 : 1);
