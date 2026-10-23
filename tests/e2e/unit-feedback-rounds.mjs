// Unit tests for one improvement per lesson (src/lib/feedback-rounds.ts): which open improvement is
// the lesson's, what feedback joined after the plan, and what feedback a save answers (the rest
// starts the next improvement). No server needed.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({ entryPoints: [path.join(root, 'src/lib/feedback-rounds.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { pickLessonImprovement, feedbackSincePlan, coveredFeedback } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const at = (minute) => new Date(Date.UTC(2026, 9, 21, 10, minute));
const candidate = (id, fields = {}) => ({ id, lessons: [{ lessonId: 'L1', role: 'subject' }], saved: false, drafted: false, ...fields });

// The lesson's improvement
check('none: no improvement', pickLessonImprovement('L1', []) === null);
check('the one about this lesson', pickLessonImprovement('L1', [candidate('a')]) === 'a');
check('not one already saved on it', pickLessonImprovement('L1', [candidate('a', { saved: true })]) === null);
check('not one covering several lessons', pickLessonImprovement('L1', [candidate('a', { lessons: [{ lessonId: 'L1', role: 'subject' }, { lessonId: 'L2', role: 'subject' }] })]) === null);
check('not a lesson brief', pickLessonImprovement('L1', [candidate('a', { lessons: [{ lessonId: 'L1', role: 'brief' }] })]) === null);
check('of several, the first without changes drafted', pickLessonImprovement('L1', [candidate('a', { drafted: true }), candidate('b'), candidate('c')]) === 'b');
check('all drafted: the first', pickLessonImprovement('L1', [candidate('a', { drafted: true }), candidate('b', { drafted: true })]) === 'a');
check('saved ones are passed over', pickLessonImprovement('L1', [candidate('a', { saved: true }), candidate('b', { drafted: true })]) === 'b');

// Feedback since the plan
const joined = [
  { id: 'f1', linkedAt: at(1) },
  { id: 'f2', linkedAt: at(5) },
  { id: 'f3', linkedAt: at(9) },
];
check('no plan: nothing to update', feedbackSincePlan(null, at(3), joined).length === 0);
check('an empty plan: nothing to update', feedbackSincePlan('  ', at(3), joined).length === 0);
check('a plan without a date: nothing to update', feedbackSincePlan('Plan', null, joined).length === 0);
check('feedback after the plan', feedbackSincePlan('Plan', at(3), joined).join(',') === 'f2,f3');
check('a plan saved since covers it all', feedbackSincePlan('Plan', at(10), joined).length === 0);

// What a save answers
let result = coveredFeedback(joined, []);
check('changes by hand answer all of it', result.covered.join(',') === 'f1,f2,f3' && !result.later.length);
result = coveredFeedback(joined, [{ noteIds: ['f1', 'f2'], createdAt: at(6) }]);
check('a draft answers the feedback it was written for', result.covered.join(',') === 'f1,f2' && result.later.join(',') === 'f3');
result = coveredFeedback(joined, [{ noteIds: undefined, createdAt: at(6) }]);
check('a draft that doesn’t say: what had joined when it started', result.covered.join(',') === 'f1,f2' && result.later.join(',') === 'f3');
result = coveredFeedback(joined, [{ noteIds: ['f1'], createdAt: at(2) }, { noteIds: ['f3'], createdAt: at(10) }]);
check('two drafts: what either was written for', result.covered.join(',') === 'f1,f3' && result.later.join(',') === 'f2');
result = coveredFeedback(joined, [{ noteIds: [], createdAt: at(10) }]);
check('a draft for none of it leaves it all for later', !result.covered.length && result.later.length === 3);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
