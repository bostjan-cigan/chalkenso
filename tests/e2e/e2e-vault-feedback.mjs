// The Obsidian vault's feedback loop through the sync API, on the demo organisation: the list has
// every piece of a lesson's feedback (open and done) and its tasks; feedback answered from the vault
// gets its reply and is done; a plan for open feedback starts the lesson's improvement, the vault's
// and in progress; a changed plan goes up; an improvement started in the app is taken over by the
// vault's plan, and one finished in the app comes back as done; feedback of another version is not
// reachable.
// Needs the demo seed.
// node tests/e2e/e2e-vault-feedback.mjs
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { BASE, env, sql } from './helpers.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const quote = (value) => (value === null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const run = Date.now().toString(36);

const orgId = sql(`select id from public.organizations where slug = 'northwind-academy'`);
if (!orgId) {
  console.log('FAIL  demo organisation found (run yarn db:seed-demo)');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const cleanup = [];
const tokenName = `Vault feedback ${run}`;
const courseId = randomUUID();
const versionId = randomUUID();
const otherVersion = randomUUID();

/** A piece of feedback on the lesson, straight in the database (as a learner's or a note). */
const addComment = (lessonId, fields) => {
  const id = randomUUID();
  const row = { status: 'OPEN', proposer_name: 'A learner · Evening group', body: 'Which editor should I use?', is_instructor_note: false, admin_response: null, resolved_at: null, version: versionId, ...fields };
  sql(`insert into courses.curriculum_comments (id, curriculum_version_id, lesson_id, proposer_name, selected_text, body, status, is_instructor_note, admin_response, resolved_at, updated_at)
    values (${quote(id)}, ${quote(row.version)}, ${quote(lessonId)}, ${quote(row.proposer_name)}, 'Install the tools', ${quote(row.body)}, ${quote(row.status)}, ${row.is_instructor_note}, ${quote(row.admin_response)}, ${row.resolved_at ? 'now()' : 'null'}, now())`);
  return id;
};

try {
  const owner = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  owner.setDefaultTimeout(30000);
  await owner.goto(`${BASE}/admin/login`);
  await owner.fill('#admin-identifier', env.DEMO_EMAIL);
  await owner.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([owner.waitForURL((url) => !url.pathname.startsWith('/admin/login')), owner.click('button[type=submit]')]);
  await owner.goto(`${BASE}/admin/api-tokens`);
  await owner.fill('#api-token-name', tokenName);
  await owner.getByRole('button', { name: 'Create token' }).click();
  await owner.waitForFunction(() => /usr_[A-Za-z0-9_-]{10,}/.test(document.body.innerText));
  const token = (await owner.locator('body').innerText()).match(/usr_[A-Za-z0-9_-]{10,}/)[0];
  cleanup.push(() => sql(`delete from public.api_tokens where name = ${quote(tokenName)}`));

  sql(`insert into courses.courses (id, organization_id, title, slug, summary, updated_at) values (${quote(courseId)}, ${quote(orgId)}, ${quote(`Vault feedback ${run}`)}, ${quote(`vault-feedback-${run}`)}, 'A course for the vault feedback test', now())`);
  cleanup.push(() => sql(`delete from courses.courses where id = ${quote(courseId)}`));
  cleanup.push(() => sql(`delete from public.tasks where id in (select task_id from public.task_entity_links where entity_type = 'curriculum_version' and entity_id in (${quote(versionId)}, ${quote(otherVersion)}))`));
  sql(`insert into courses.curriculum_versions (id, course_id, label, version, updated_at) values (${quote(versionId)}, ${quote(courseId)}, 'v1', 1, now()), (${quote(otherVersion)}, ${quote(courseId)}, 'v2', 2, now())`);

  const sync = async (method, route, body, version = versionId) => {
    const response = await owner.request.fetch(`${BASE}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'X-Curriculum-Version-Id': version, 'Content-Type': 'application/json' },
      data: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status(), json: await response.json().catch(() => null) };
  };
  const created = await sync('POST', '/api/sync/lessons', { title: `Setup ${run}`, markdownContent: 'Install the tools first.', status: 'published' });
  const lessonId = created.json?.lesson?.id;
  check('a lesson to give feedback on', created.status === 201 && Boolean(lessonId), String(created.status));
  const elsewhere = await sync('POST', '/api/sync/lessons', { title: `Elsewhere ${run}`, markdownContent: 'Other version.', status: 'published' }, otherVersion);
  const otherLesson = elsewhere.json?.lesson?.id;

  const toPlan = addComment(lessonId, {});
  const toAnswer = addComment(lessonId, { proposer_name: 'Ana Novak', is_instructor_note: true, body: 'Ran long: show the editor first.' });
  const answered = addComment(lessonId, { status: 'RESOLVED', admin_response: 'Any editor works.', resolved_at: true });
  const otherComment = addComment(otherLesson, { version: otherVersion });

  // Down: everything, done included.
  let list = await sync('GET', '/api/sync/tasks');
  const ids = (list.json?.feedback ?? []).map((entry) => entry.id).sort();
  check('the list has the open and the done feedback', list.status === 200 && JSON.stringify(ids) === JSON.stringify([toPlan, toAnswer, answered].sort()), JSON.stringify(ids));
  const note = list.json.feedback.find((entry) => entry.id === toAnswer);
  check('each with its lesson, kind and state', note?.lesson?.id === lessonId && note.isInstructorNote === true && note.status === 'OPEN' && Array.isArray(note.taskIds) && note.taskIds.length === 0);
  check('and no tasks yet', Array.isArray(list.json.tasks) && list.json.tasks.length === 0);

  // Up: an answer with a reply.
  const answer = await sync('PATCH', `/api/sync/feedback/${toAnswer}`, { status: 'RESOLVED', reply: 'Shown first now.' });
  check('feedback answered from the vault is done', answer.status === 200 && answer.json?.feedback?.done === true);
  check('with its reply saved', sql(`select status || '|' || coalesce(admin_response, '') from courses.curriculum_comments where id = ${quote(toAnswer)}`) === 'RESOLVED|Shown first now.');
  const again = await sync('PATCH', `/api/sync/feedback/${toAnswer}`, { status: 'RESOLVED', reply: 'Twice.' });
  check('answering it again leaves it as it was', again.json?.feedback?.skipped === true && sql(`select admin_response from courses.curriculum_comments where id = ${quote(toAnswer)}`) === 'Shown first now.');

  // Up: a plan for open feedback starts the improvement.
  const plan = 'Add a line about editors before the install.\nScope: core';
  const started = await sync('POST', '/api/sync/improvements', { lessonId, plan, feedbackIds: [toPlan] });
  const taskId = started.json?.task?.id;
  check('a plan for open feedback starts the improvement', started.status === 200 && Boolean(taskId), JSON.stringify(started.json));
  check("it's the vault's, in progress, with the plan", sql(`select status || '|' || coalesce(workplace::text, '') || '|' || coalesce(plan, '') from public.tasks where id = ${quote(taskId)}`) === `IN_PROGRESS|VAULT|${plan}`);
  check('the feedback is in it', sql(`select count(*) from public.task_entity_links where task_id = ${quote(taskId)} and entity_type = 'curriculum_comment' and entity_id = ${quote(toPlan)}`) === '1');
  list = await sync('GET', '/api/sync/tasks');
  const listed = list.json.tasks.find((entry) => entry.id === taskId);
  check('the list has the improvement, the vault its place', listed?.workplace === 'VAULT' && listed.status === 'IN_PROGRESS' && listed.sourceComments.some((entry) => entry.id === toPlan));
  check('and the feedback says which task uses it', JSON.stringify(list.json.feedback.find((entry) => entry.id === toPlan)?.taskIds) === JSON.stringify([taskId]));
  await owner.goto(`${BASE}/admin/courses/${courseId}/lessons/${lessonId}/improvements`);
  await owner.waitForLoadState('networkidle').catch(() => {});
  const improveText = await owner.locator('main').first().innerText();
  check('the app shows it as worked on in Obsidian', /In Obsidian|V Obsidianu|Worked on in Obsidian/.test(improveText), improveText.slice(0, 300));

  // Up: a changed plan, with new open feedback that joins.
  const late = addComment(lessonId, { body: 'And which terminal?' });
  const changed = await sync('PATCH', `/api/sync/tasks/${taskId}`, { plan: `${plan}\n- Name a terminal too.`, useFeedback: [late] });
  check('a changed plan goes up', changed.status === 200 && sql(`select plan from public.tasks where id = ${quote(taskId)}`).endsWith('Name a terminal too.'));
  check('with the open feedback it uses', sql(`select count(*) from public.task_entity_links where task_id = ${quote(taskId)} and entity_type = 'curriculum_comment' and entity_id = ${quote(late)}`) === '1');

  // Started in the app: the vault's plan takes it over.
  sql(`update public.tasks set workplace = 'APP' where id = ${quote(taskId)}`);
  list = await sync('GET', '/api/sync/tasks');
  check('one started in the app is listed, the app its place', list.json.tasks.find((entry) => entry.id === taskId)?.workplace === 'APP');
  const takenOver = await sync('PATCH', `/api/sync/tasks/${taskId}`, { plan: 'From the vault' });
  check("the vault's plan takes it over", takenOver.status === 200 && sql(`select coalesce(workplace::text, '') || '|' || plan from public.tasks where id = ${quote(taskId)}`) === 'VAULT|From the vault');
  sql(`update public.tasks set workplace = 'APP' where id = ${quote(taskId)}`);
  const another = addComment(lessonId, { body: 'Slides?' });
  const joined = await sync('POST', '/api/sync/improvements', { lessonId, plan: 'Something', feedbackIds: [another] });
  check('so does a plan that joins it', joined.status === 200 && joined.json?.task?.id === taskId && sql(`select workplace from public.tasks where id = ${quote(taskId)}`) === 'VAULT');

  // Finished in the app: it comes back as done.
  sql(`update public.tasks set status = 'DONE', completed_at = now() where id = ${quote(taskId)}`);
  list = await sync('GET', '/api/sync/tasks');
  check('finished in the app, the list has it as done', list.json.tasks.find((entry) => entry.id === taskId)?.status === 'DONE');

  // Another version's feedback isn't reachable with this version.
  const crossed = await sync('PATCH', `/api/sync/feedback/${otherComment}`, { status: 'RESOLVED', reply: 'No' });
  check("another version's feedback is not found", crossed.status === 404 && sql(`select status from courses.curriculum_comments where id = ${quote(otherComment)}`) === 'OPEN');
  const crossedPlan = await sync('POST', '/api/sync/improvements', { lessonId, plan: 'x', feedbackIds: [otherComment] });
  check('nor can a plan use it', crossedPlan.status === 400 || crossedPlan.status === 409, String(crossedPlan.status));
} catch (error) {
  console.error(error);
  failed += 1;
} finally {
  for (const step of cleanup.reverse()) {
    try {
      step();
    } catch (error) {
      console.warn('cleanup:', error.message);
    }
  }
  await browser.close();
}

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
