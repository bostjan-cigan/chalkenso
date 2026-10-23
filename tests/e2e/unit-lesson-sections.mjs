// Unit tests for a lesson's sections (src/lib/lesson-sections.ts): splitting a lesson at its "## "
// headings, finding the sections an improvement is about from its feedback, plan and proposed
// changes, and putting a rewritten section back. No server needed.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({
  entryPoints: [path.join(root, 'src/lib/lesson-sections.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  alias: { '@': path.join(root, 'src') },
});
const { lessonSections, focusSections, sectionSpan, spliceSpan, feedbackOrder, passageHeading } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
const revisionOut = await build({ entryPoints: [path.join(root, 'src/app/admin/courses/components/workspace/revision.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const { proposeChanges } = await import(`data:text/javascript,${encodeURIComponent(revisionOut.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const lesson = [
  '**Duration:** 1.5 hours',
  '',
  '## What Docker is, in one sentence',
  '',
  'Docker runs each part of your app in its own small, isolated computer.',
  '',
  '## Run Flask and Postgres with one command',
  '',
  'Create `compose.yaml` in the project folder:',
  '',
  '```yaml',
  '## not a heading inside code',
  'services: {}',
  '```',
  '',
  'The named volume keeps the database files outside the container.',
  '',
  '### Check it',
  '',
  'Stop and start it again.',
  '',
  '## Your first page from the database',
  '',
  'The template loops over them. Add one recipe by hand in `psql`, refresh the page.',
  '',
  '## Homework',
  '',
  'Add a second recipe.',
  '',
].join('\n');

const sections = lessonSections(lesson);
check('five sections: the intro and four headings', sections.length === 5, sections.map((s) => s.heading).join(' | '));
check('the intro has no heading', sections[0].heading === null && sections[0].text.includes('Duration'));
check('a heading inside code is not a section', !sections.some((s) => s.heading?.includes('not a heading')));
check('"###" stays inside its section', sections[2].text.includes('### Check it'));
check('the sections cover the lesson', sections.map((s) => s.text).join('') === lesson);
check('no headings: one section', lessonSections('Just a paragraph.\n\nAnother.').length === 1);

check('a feedback passage finds its section', focusSections(lesson, { passages: ['Add one recipe by hand in'] }).join() === '3');
check('the plan’s quoted step finds its section', focusSections(lesson, { plan: 'Before "Add one recipe by hand in psql", add the command to open it.' }).join() === '3');
check('the plan naming a heading finds it', focusSections(lesson, { plan: 'In Run Flask and Postgres with one command, explain the volume.' }).join() === '2');
check('curly quotes too', focusSections(lesson, { plan: 'After “The named volume keeps the database files”, add a check.' }).join() === '2');
check('several hints, several sections, in order', focusSections(lesson, { passages: ['Add a second recipe'], plan: 'In “What Docker is, in one sentence”, add a Linux note.' }).join() === '1,4');
check('nothing named: none (the whole lesson shows)', focusSections(lesson, { plan: 'Make it shorter.', passages: ['xyz'] }).length === 0);
check('short passages are ignored', focusSections(lesson, { passages: ['the'] }).length === 0);
check('one section only: none', focusSections('No headings here at all.', { passages: ['headings here'] }).length === 0);

const revised = lesson.replace('Add one recipe by hand in `psql`', 'Open psql with `docker compose exec db psql`. Add one recipe by hand in `psql`');
const changes = proposeChanges(lesson, revised);
check('a proposed change finds its section', focusSections(lesson, { changeAt: changes.map((c) => c.at) }).join() === '3', JSON.stringify(changes.map((c) => c.at)));
const added = lesson.replace('Add a second recipe.\n', 'Add a second recipe.\n\nThen a third.\n');
check('a paragraph added at a section’s end belongs to it', focusSections(lesson, { changeAt: proposeChanges(lesson, added).map((c) => c.at) }).join() === '4');

const span = sectionSpan(lesson, [3]);
check('a span is the section’s text', lesson.slice(span.start, span.end) === sections[3].text);
const rewritten = '## Your first page from the database\n\nThe template loops over them. Open psql first, then add one recipe by hand.';
const spliced = spliceSpan(lesson, span, rewritten);
check('splicing replaces only that section', spliced.includes('Open psql first') && spliced.includes('## Homework') && spliced.includes('## Run Flask') && !spliced.includes('refresh the page'));
check('and keeps the blank line before the next heading', spliced.includes('by hand.\n\n## Homework'));
check('splicing the same text back changes nothing', spliceSpan(lesson, span, sections[3].text) === lesson);
const wide = sectionSpan(lesson, [1, 3]);
check('a span over several sections runs from the first to the last', lesson.slice(wide.start, wide.end).startsWith('## What Docker') && lesson.slice(wide.start, wide.end).includes('refresh the page') && !lesson.slice(wide.start, wide.end).includes('Homework'));
const last = sectionSpan(lesson, [4]);
check('the last section splices with one line end', spliceSpan(lesson, last, '## Homework\n\nAdd two recipes.').endsWith('Add two recipes.\n'));

const ordered = feedbackOrder(lesson, [
  { id: 'whole', passage: '' },
  { id: 'homework', passage: 'Add a second recipe' },
  { id: 'gone', passage: 'a sentence the lesson no longer has' },
  { id: 'docker', passage: 'its own small,   isolated computer' },
  { id: 'psql', passage: 'Add one recipe by hand in psql' },
]);
check('feedback is ordered by where its passage is', ordered.map((one) => one.id).join() === 'docker,psql,homework,whole,gone', ordered.map((one) => one.id).join());
check('a passage finds the heading it falls under', passageHeading(lesson, 'Add one recipe by hand in psql') === 'Your first page from the database');
check('before the first heading: null', passageHeading(lesson, 'Duration: 1.5 hours') === null);
check('a passage the lesson does not have: undefined', passageHeading(lesson, 'nowhere in this lesson') === undefined);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
