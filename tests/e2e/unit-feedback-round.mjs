// Unit tests for "Sort with AI" (src/lib/version-round-rules.ts): AI's answer made safe (every note
// in exactly one place, a note changes only its own lesson, duplicates, what AI missed), the page's
// edits checked, replies kept apart from AI's suggestions, and the mock that answers the same way
// every time.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({ entryPoints: [path.join(root, 'src/lib/version-round-rules.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { cleanRound, cleanEdit, leftToAnswer, mockRoundAnswer } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const lessons = [
  { id: 'l1', ref: 'L1', position: 1, title: 'Setup', sections: ['Install'], plan: null, reachesCourse: true },
  { id: 'l2', ref: 'L2', position: 2, title: 'Routes', sections: ['GET', 'POST'], plan: '- Old plan', reachesCourse: false },
];
const note = (id, ref, lessonId, body) => ({ id, ref, lessonId, lessonRef: lessonId === 'l1' ? 'L1' : 'L2', body, passage: '', section: null, instructor: false, author: 'Learner 1' });
const notes = [
  note('n1', 'N1', 'l1', 'Install fails on Windows?'),
  note('n2', 'N2', 'l1', 'Thanks, great lesson!'),
  note('n3', 'N3', 'l2', 'What does POST return?'),
  note('n4', 'N4', 'l2', 'What does POST return?'),
  note('n5', 'N5', 'l2', 'Can we use Django?'),
];

const round = cleanRound(
  {
    lessons: [
      { lesson: 'L2', plan: '- In “POST”, show the 201', notes: ['N3', 'N1', 'N99'], scope: 'group and core' },
      { lesson: 'L1', plan: '- In “Install”, add Windows', notes: ['N1'], scope: 'group and core' },
    ],
    leaveOut: [
      { note: 'N2', suggestion: 'Glad it helped!' },
      { note: 'N4', suggestion: 'Same question', duplicateOf: 'N3' },
      { note: 'N3', suggestion: 'twice' },
    ],
  },
  notes,
  lessons
);
check('lessons in course order', round.lessons.map((card) => card.lessonId).join() === 'l1,l2', JSON.stringify(round.lessons));
check('a note changes only its own lesson', !round.lessons.find((card) => card.lessonId === 'l2').noteIds.includes('n1') && round.lessons[0].noteIds.includes('n1'));
check('unknown references are dropped', !JSON.stringify(round).includes('N99'));
check('a duplicate of a note changed on the same lesson joins that change', round.lessons.find((card) => card.lessonId === 'l2').noteIds.includes('n4'));
check('every note in exactly one place', ['n1', 'n2', 'n3', 'n4', 'n5'].every((id) => [...round.lessons.flatMap((card) => card.noteIds), ...round.leaveOut.map((item) => item.noteId)].filter((one) => one === id).length === 1));
check('a note AI missed is left out, with no suggestion', round.leaveOut.some((item) => item.noteId === 'n5' && item.suggestion === ''));
check('AI only suggests: no reply is written for the person', round.leaveOut.every((item) => item.reply === '') && round.leaveOut.find((item) => item.noteId === 'n2').suggestion === 'Glad it helped!');
check('scope only where the main course has the lesson', round.lessons.find((card) => card.lessonId === 'l1').scope === 'group and core' && round.lessons.find((card) => card.lessonId === 'l2').scope === null);
check('all left out still to answer', leftToAnswer(round) === round.leaveOut.length);

const noteLessons = Object.fromEntries(notes.map((one) => [one.id, one.lessonId]));
const edited = cleanEdit(
  {
    lessons: [{ lessonId: 'l1', plan: 'x'.repeat(5000), scope: 'group only', noteIds: ['n1', 'n3', 'nX'] }],
    leaveOut: [
      { noteId: 'n2', reply: 'Thank you!' },
      { noteId: 'n1', reply: 'twice' },
    ],
  },
  round,
  lessons.map((one) => ({ id: one.id, reachesCourse: one.reachesCourse })),
  noteLessons
);
check('an edit keeps only the round’s notes, each on its own lesson', JSON.stringify(edited.lessons[0].noteIds) === JSON.stringify(['n1']), JSON.stringify(edited.lessons));
check('plans are capped', edited.lessons[0].plan.length === 4000);
check('a note the edit lost is left out, never dropped, keeping its suggestion', edited.leaveOut.some((item) => item.noteId === 'n3') && edited.leaveOut.some((item) => item.noteId === 'n4'));
check('the person’s reply is kept apart from the suggestion', edited.leaveOut.find((item) => item.noteId === 'n2').reply === 'Thank you!' && edited.leaveOut.find((item) => item.noteId === 'n2').suggestion === 'Glad it helped!');
check('only notes without a reply stay to answer', leftToAnswer(edited) === edited.leaveOut.filter((item) => !item.reply).length && leftToAnswer(edited) < edited.leaveOut.length);

const mock = mockRoundAnswer(notes, lessons);
const again = mockRoundAnswer(notes, lessons);
check('the mock answers the same every time', JSON.stringify(mock) === JSON.stringify(again));
const mocked = cleanRound(mock, notes, lessons);
check('the mock leaves thanks out, with a suggestion', mocked.leaveOut.some((item) => item.noteId === 'n2' && item.suggestion));
check('the mock calls a repeat a duplicate', mock.leaveOut.some((item) => item.note === 'N4' && item.duplicateOf === 'N3'));
check('the mock changes the rest on their own lessons', mocked.lessons.find((card) => card.lessonId === 'l1').noteIds.includes('n1') && mocked.lessons.find((card) => card.lessonId === 'l2').noteIds.includes('n3'));

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
