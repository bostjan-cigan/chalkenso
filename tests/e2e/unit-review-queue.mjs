// Unit tests for working through a course's lessons one after another (src/lib/review-queue.ts):
// where the lesson open now is ("Lesson 3 of 8"), and which to go to next.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({ entryPoints: [path.join(root, 'src/lib/review-queue.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { queueOf } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const lesson = (id, position, state) => ({ lessonId: id, position, title: `Lesson ${position}`, taskId: `t${id}`, state });

const pass = [lesson('c', 3, 'review'), lesson('a', 1, 'done'), lesson('b', 2, 'review'), lesson('d', 5, 'writing')];
const atB = queueOf(pass, 'b');
check('in lesson order, this one’s place', atB.at === 2 && atB.total === 4, JSON.stringify(atB));
check('next is the next one waiting for review', atB.next?.lessonId === 'c');
check('what’s left: waiting or being written, not this one', atB.left === 2);
const atC = queueOf(pass, 'c');
check('one waiting for review comes before one still being written, round the end', atC.next?.lessonId === 'b' && atC.left === 2, JSON.stringify(atC.next));
const atD = queueOf(pass, 'd');
check('round the end, back to one waiting for review', atD.next?.lessonId === 'b', JSON.stringify(atD.next));
const writingOnly = queueOf([lesson('a', 1, 'done'), lesson('b', 2, 'review'), lesson('c', 3, 'writing')], 'b');
check('none left to review: the next one still being written', writingOnly.next?.lessonId === 'c' && writingOnly.left === 1, JSON.stringify(writingOnly.next));
const outside = queueOf(pass, 'z');
check('a lesson not in the pass: no place, the first waiting next', outside.at === null && outside.next?.lessonId === 'b');
const allDone = queueOf([lesson('a', 1, 'done'), lesson('b', 2, 'done')], 'a');
check('everything done: nothing next', allDone.next === null && allDone.left === 0 && allDone.at === 1);
check('nothing in the pass', queueOf([], 'a').total === 0);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
