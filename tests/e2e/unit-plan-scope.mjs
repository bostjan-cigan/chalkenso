// Unit tests for the plan's scope line (src/lib/plan-scope.ts): "Scope: group only" or "Scope: group
// and core", as the vault, the AI and MCP write it, read and written back. No server needed.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({ entryPoints: [path.join(root, 'src/lib/plan-scope.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { parsePlanScope, planBody, withPlanScope } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const plan = 'In "Volumes", add two sentences after the compose file.\n\nScope: group and core';
check('group and core', parsePlanScope(plan) === 'group and core');
check('group only', parsePlanScope('Fix it.\n\nScope: group only') === 'group only');
check('the vault’s short form: core', parsePlanScope('Fix it.\nScope: core') === 'group and core');
check('main course in words', parsePlanScope('Fix it.\nscope: Group and main course.') === 'group and core');
check('no scope line', parsePlanScope('Fix it.') === null && parsePlanScope(null) === null);
check('an empty scope line names none', parsePlanScope('Fix it.\nScope:') === null);
check('the last line wins', parsePlanScope('Scope: group only\nFix it.\nScope: group and core') === 'group and core');
check('"scope" inside a sentence is not the line', parsePlanScope('The scope: only this group needs it.') === null);

check('the body leaves the line out', planBody(plan) === 'In "Volumes", add two sentences after the compose file.', JSON.stringify(planBody(plan)));
check('body of a plan with only a scope', planBody('Scope: group only') === '');
check('writing a scope replaces the old one', withPlanScope(plan, 'group only') === 'In "Volumes", add two sentences after the compose file.\n\nScope: group only');
check('writing onto a plan without one', withPlanScope('Fix it.', 'group and core') === 'Fix it.\n\nScope: group and core');
check('no scope: the line goes', withPlanScope(plan, null) === planBody(plan));
check('an empty plan keeps just the scope', withPlanScope('', 'group only') === 'Scope: group only');
check('round trip', parsePlanScope(withPlanScope(planBody(plan), parsePlanScope(plan))) === 'group and core');

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
