// End-to-end check of the feedback loop on the demo organisation (run `yarn db:seed-demo` first).
// node tests/e2e/e2e-demo.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { BASE, env, sql } from './helpers.mjs';

mkdirSync('tests/e2e/.shots', { recursive: true });
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

try {
  const [learnerToken] = sql(
    "select l.token from courses.access_links l join courses.course_group_members m on m.id = l.member_id where m.full_name = 'Sara Vidmar' limit 1"
  ).split('\n');
  const [groupVersionId, lessonId] = sql(
    "select v.id || '|' || le.id from courses.curriculum_versions v join courses.lessons le on le.curriculum_version_id = v.id join courses.courses c on c.id = v.course_id join public.organizations o on o.id = c.organization_id where o.slug = 'northwind-academy' and v.owner_group_id is not null and le.position = 2"
  ).split('|');

  // Learner leaves feedback through their personal link
  const learner = await browser.newContext();
  const learnerPage = await learner.newPage();
  const access = await learnerPage.goto(`${BASE}/l/course/${learnerToken}`);
  check('learner link opens the course', access.status() === 200 && (await learnerPage.content()).includes('Web Development II'));
  check('learner page credits the organisation', (await learnerPage.content()).includes('Northwind Academy'));
  const feedback = await learner.request.post(`${BASE}/api/access/comment`, {
    data: {
      token: learnerToken,
      lessonId,
      selectedText: 'Return 201 Created for a new recipe',
      context: null,
      body: 'Could we get a cheat sheet of status codes at the end?',
    },
  });
  check('learner feedback saved', feedback.status() === 201, String(feedback.status()));
  await learner.close();

  // Owner signs in
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', env.DEMO_EMAIL);
  await page.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin(\?|$)/), page.click('button[type=submit]')]);
  check('demo owner signed in', page.url().endsWith('/admin'));

  // Instructor note on the same lesson (as from the team preview)
  const note = await page.request.post(`${BASE}/api/team/comment`, {
    data: { lessonId, selectedText: 'Pages vs APIs', body: 'Ran 10 minutes long: the API client install took a while.' },
  });
  check('instructor note saved', note.status() === 201, String(note.status()));
  const margin = await (await page.request.get(`${BASE}/api/team/comment?lessonId=${lessonId}`)).json();
  check('team margin shows learner feedback and notes', margin.comments.length >= 2, `${margin.comments.length} items`);

  // Inbox shows both, then turn the learner's comment into a task
  await page.goto(`${BASE}/admin/courses/comments/${groupVersionId}`);
  await page.waitForSelector('text=cheat sheet of status codes');
  const inbox = await page.content();
  check('inbox shows learner feedback', inbox.includes('cheat sheet of status codes'));
  check('inbox badges instructor notes', inbox.includes('>Note<'));
  const card = page.locator('[data-testid=open-comments] [id^=comment-]', { hasText: 'cheat sheet of status codes' }).first();
  // Use puts it in its lesson's improvement (one per lesson); the list stays, to go through the rest
  await card.locator('[data-testid=feedback-use]').click();
  const usedLink = card.locator('a', { hasText: 'In the lesson’s improvement' });
  await usedLink.waitFor({ timeout: 15000 });
  check('Use keeps the list and links the lesson’s improvement', !page.url().includes('/improvements'));
  const improveUrl = new URL(await usedLink.getAttribute('href'), BASE).href;
  const draftTaskId = new URL(improveUrl).searchParams.get('i');
  const taskUrl = `${BASE}/admin/tasks/${draftTaskId}`;
  await page.goto(improveUrl);
  await page.waitForSelector('[data-testid=feedback-cards]');
  check(
    'the lesson’s improvement uses it (ticked beside the lesson)',
    Boolean(draftTaskId) && (await page.locator('[data-testid=feedback-card][data-used]', { hasText: 'cheat sheet of status codes' }).count()) === 1
  );
  check('with its plan still to write, and nothing drafted yet', (await page.locator('[data-testid=plan-with-ai]').count()) === 1 && (await page.locator('[data-testid=draft-changes]').count()) === 0);

  // With an improvement being worked on, the feedback stays open (its learner hears when the change is made)
  await page.goto(`${BASE}/admin/courses/comments/${groupVersionId}`);
  const openCard = page.locator('[data-testid=open-comments] [id^=comment-]', { hasText: 'cheat sheet of status codes' }).first();
  await openCard.waitFor();
  check('feedback with an improvement stays open', (await openCard.innerText()).includes('Being changed'));
  // The menu opens once the page is interactive: click until it does.
  const deleteItem = page.getByRole('menuitem', { name: 'Delete…' });
  for (let attempt = 0; attempt < 5 && !(await deleteItem.isVisible()); attempt += 1) {
    await openCard.getByRole('button', { name: 'Feedback actions' }).click();
    await deleteItem.waitFor({ timeout: 3000 }).catch(() => {});
  }
  check('Delete is in the feedback’s menu', (await deleteItem.count()) === 1);
  await page.keyboard.press('Escape');
  await page.goto(taskUrl);
  const openInLesson = await page.locator('[data-testid=open-in-lesson]').waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('the improvement’s page shows details, and opens it in the lesson', openInLesson && (await page.locator('[data-testid=task-plan]').count()) === 0);
  await page.screenshot({ path: 'tests/e2e/.shots/task-before.png' });

  // AI drafts the plan in the background, in the lesson's Improve mode: what it is doing and the
  // plan as it is written. Left while it's written, it waits in the plan box; Cancel puts it away.
  const draftQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const latestDraft = () =>
    sql(`select status from public.ai_proposals where target_id = ${draftQuote(draftTaskId)} and via = 'app' order by created_at desc limit 1`);
  const waitForDraft = async (status, tries = 60) => {
    for (let i = 0; i < tries; i += 1) {
      if (latestDraft() === status) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
  await page.goto(improveUrl);
  await page.click('[data-testid=plan-with-ai]');
  check('it says what AI is doing', await page.locator('[data-testid=plan-draft-stage]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.goto(`${BASE}/admin`);
  check('it finishes while nobody watches', await waitForDraft('OPEN'));
  await page.goto(improveUrl);
  await page.waitForFunction(() => ((document.querySelector('[data-testid=plan-box] .ProseMirror')?.textContent || document.querySelector('[data-testid=plan-box] textarea')?.value || '')).trim().length > 0, null, { timeout: 15000 });
  check('back in the lesson, the draft waits in the plan box', true);
  await page.locator('[data-testid=step-plan]').getByRole('button', { name: 'Cancel' }).click();
  check('Cancel puts it away', await waitForDraft('DISCARDED', 20));

  // Stop: no draft arrives later
  await page.click('[data-testid=plan-with-ai]');
  const working = page.locator('[data-testid=plan-draft-working]');
  await working.waitFor({ timeout: 15000 });
  await working.getByRole('button', { name: 'Stop' }).click();
  await page.waitForTimeout(6000);
  check('Stop ends it for good', latestDraft() === 'DISCARDED' && (await page.locator('[data-testid=plan-box]').count()) === 0);

  // Done while watched, it goes into the box; saving keeps it and starts the improvement
  await page.click('[data-testid=plan-with-ai]');
  check('and shows the plan as it is written', await page.locator('[data-testid=plan-draft-live]').waitFor({ timeout: 20000 }).then(() => true, () => false));
  await page.waitForFunction(() => ((document.querySelector('[data-testid=plan-box] .ProseMirror')?.textContent || document.querySelector('[data-testid=plan-box] textarea')?.value || '')).trim().length > 0, null, { timeout: 30000 });
  check('AI drafted the plan, without its Scope line in the box', !(await page.locator('[data-testid=plan-box] .ProseMirror').innerText()).includes('Scope:'));
  await page.click('[data-testid=save-plan]');
  await page.waitForSelector('[data-testid=context-rows]');
  check('plan saved on the task, with its Scope line for the vault', sql(`select plan from public.tasks where id = ${draftQuote(draftTaskId)}`).includes('Scope:'));
  check('saving the plan starts the improvement', sql(`select status from public.tasks where id = ${draftQuote(draftTaskId)}`) === 'IN_PROGRESS');
  check('the draft counts as used', await waitForDraft('USED', 20));

  // Deleted from its own page, the improvement goes and its feedback waits to be decided again
  const taskId = new URL(taskUrl).pathname.split('/').pop();
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const commentId = sql(
    `select l.entity_id from public.task_entity_links l join courses.curriculum_comments c on c.id = l.entity_id where l.task_id = ${quote(taskId)} and l.entity_type = 'curriculum_comment' and c.body like '%cheat sheet of status codes%' limit 1`
  );
  await page.goto(taskUrl);
  await page.getByRole('button', { name: 'Delete this improvement…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete improvement' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith(taskId), { timeout: 15000 });
  check(
    'deleting an improvement keeps its feedback, to decide again',
    Boolean(commentId) &&
      sql(`select count(*) from public.tasks where id = ${quote(taskId)}`) === '0' &&
      sql(`select count(*) from courses.curriculum_comments where id = ${quote(commentId)}`) === '1' &&
      sql(`select count(*) from public.task_entity_links where entity_id = ${quote(commentId)}`) === '0'
  );

  // A sync token only reaches this organisation's curricula
  await page.goto(`${BASE}/admin/api-tokens`);
  await page.fill('#api-token-name', 'E2E check');
  await page.getByRole('button', { name: 'Create token' }).click();
  await page.waitForFunction(() => /usr_[A-Za-z0-9_-]{10,}/.test(document.body.innerText));
  const apiToken = (await page.locator('body').innerText()).match(/usr_[A-Za-z0-9_-]{10,}/)[0];
  const me = await (await page.request.get(`${BASE}/api/sync/me`, { headers: { Authorization: `Bearer ${apiToken}` } })).json();
  const titles = new Set((me.curricula ?? me.versions ?? me.workspaces ?? []).map((version) => version.course?.title));
  check('sync token works', titles.size > 0, JSON.stringify([...titles]));
  const ownTitles = sql(`select string_agg(c.title, '|') from courses.courses c join public.organizations o on o.id = c.organization_id where o.slug = 'northwind-academy'`).split('|');
  check('sync token sees only its organisation', [...titles].every((title) => ownTitles.includes(title)), JSON.stringify([...titles]));

  // The plugin creates the course's parts (arcs) before syncing their lessons
  const coreVersionId = sql(
    "select v.id from courses.curriculum_versions v join courses.courses c on c.id = v.course_id join public.organizations o on o.id = c.organization_id where o.slug = 'northwind-academy' and c.title = 'Web Development II' and v.owner_group_id is null order by v.version desc limit 1"
  );
  const arcTitle = `E2E part ${Date.now().toString(36)}`;
  const postArc = (body) =>
    page.request.post(`${BASE}/api/sync/arcs`, {
      headers: { Authorization: `Bearer ${apiToken}`, 'X-Curriculum-Version-Id': coreVersionId },
      data: body,
    });
  const lastPosition = Number(sql(`select coalesce(max(position), 0) from courses.lesson_arcs where curriculum_version_id = '${coreVersionId}'`));
  const createdArc = await postArc({ title: arcTitle, description: 'Made by the e2e test.' });
  const createdArcBody = await createdArc.json();
  check(
    'sync creates an arc at the end of the version',
    createdArc.status() === 201 && createdArcBody.arc?.title === arcTitle && createdArcBody.arc.position === lastPosition + 1,
    `${createdArc.status()} ${JSON.stringify(createdArcBody.arc)}`
  );
  const sameArc = await postArc({ title: arcTitle.toUpperCase() });
  const sameArcBody = await sameArc.json();
  check(
    'the same title (any case) answers 409 arc_exists with that arc',
    sameArc.status() === 409 && sameArcBody.reason === 'arc_exists' && sameArcBody.arc?.id === createdArcBody.arc?.id
  );
  check('an arc needs a title', (await postArc({ title: '  ' })).status() === 400);
  const manifest = await (
    await page.request.get(`${BASE}/api/sync/curriculum`, { headers: { Authorization: `Bearer ${apiToken}`, 'X-Curriculum-Version-Id': coreVersionId } })
  ).json();
  check('the manifest lists the new arc', manifest.arcs.some((arc) => arc.id === createdArcBody.arc?.id && arc.description === 'Made by the e2e test.'));
  if (createdArcBody.arc?.id) sql(`delete from courses.lesson_arcs where id = '${createdArcBody.arc.id}'`);
} catch (error) {
  check('unexpected error', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
