// End-to-end check of picking many pieces of feedback at once on a group's Feedback list, on the demo
// organisation (`yarn db:seed-demo` first; AI_MOCK=1 on the server): the New list grouped by lesson;
// Select, a lesson's box and one more piece, then Fix with AI: each lesson's plan and changes are
// drafted (and its first opens); Leave out answers several at once with one reply, which is
// required. Nothing is published; what it adds is removed at the end.
// node tests/e2e/e2e-feedback-select.mjs
import { chromium } from 'playwright-core';
import { BASE, env, sql } from './helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

const [groupId, versionId] = sql(
  "select g.id || '|' || v.id from courses.course_groups g join courses.curriculum_versions v on v.owner_group_id = g.id join courses.courses c on c.id = v.course_id join public.organizations o on o.id = c.organization_id where o.slug = 'northwind-academy' and g.name like 'Evening%' limit 1"
).split('|');
const [lessonA, lessonB] = [4, 5].map((position) => sql(`select id from courses.lessons where curriculum_version_id = ${quote(versionId)} and position = ${position}`));
const started = sql('select now()');
const lessons = [lessonA, lessonB];
const taskIdsSql = `select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id in (${lessons.map(quote).join(', ')})`;
const tasksBefore = sql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, status, plan, plan_updated_at, workplace, completed_at, ai_notes from public.tasks where id in (${taskIdsSql})) t`);
const linksBefore = sql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (select * from public.task_entity_links where task_id in (${taskIdsSql})) t`);
const created = [];
const status = (id) => sql(`select status from courses.curriculum_comments where id = ${quote(id)}`);
const usedBy = (id) => sql(`select coalesce(string_agg(task_id, ','), '') from public.task_entity_links where entity_type = 'curriculum_comment' and role = 'source' and entity_id = ${quote(id)}`);
const waitFor = async (test, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    if (test()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

try {
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', env.DEMO_EMAIL);
  await page.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin(\?|$)/), page.click('button[type=submit]')]);
  // A passage of the lesson as learners read it: what a note is on.
  const passageOf = (lessonId) =>
    sql(`select coalesce(published_markdown_content, markdown_content) from courses.lessons where id = ${quote(lessonId)}`)
      .split(/(?:\r?\n){2,}/)
      .map((block) => block.trim())
      .find((block) => block.length > 60 && !/^[#>*`|!-]/.test(block))
      ?.slice(0, 40) ?? '';
  const note = async (lessonId, body) => {
    const response = await page.request.post(`${BASE}/api/team/comment`, { data: { lessonId, selectedText: passageOf(lessonId), body } });
    const id = (await response.json()).comment?.id;
    created.push(id);
    return id;
  };
  const a1 = await note(lessonA, 'E2E select: a diagram of the flow here.');
  const b1 = await note(lessonB, 'E2E select: the second example is unclear.');
  const b2 = await note(lessonB, 'E2E select: add a short recap.');
  const out1 = await note(lessonA, 'E2E select: can we switch to Django?');
  const out2 = await note(lessonB, 'E2E select: can we use MongoDB?');

  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=feedback`);
  await page.waitForSelector('[data-testid=feedback-lesson]');
  check('the New list is grouped by lesson', (await page.locator('[data-testid=feedback-lesson]').count()) >= 2);

  // Leave out two at once: a reply is required, then both are done with it.
  await page.click('[data-testid=feedback-select]');
  const item = (text) => page.locator('[id^=comment-]', { hasText: text }).first().locator('[data-testid=feedback-select-item]');
  await item('E2E select: can we switch to Django?').check();
  await item('E2E select: can we use MongoDB?').check();
  await page.click('[data-testid=feedback-leave-out]');
  await page.click('[data-testid=feedback-leave-out-send]');
  check('leaving out without a reply asks for one', status(out1) === 'OPEN' && status(out2) === 'OPEN');
  await page.fill('[data-testid=feedback-leave-out-reply]', 'We stay with this stack so every group builds the same app.');
  await page.click('[data-testid=feedback-leave-out-send]');
  check('both are done with the reply', await waitFor(() => status(out1) === 'RESOLVED' && status(out2) === 'RESOLVED', 30));
  check(
    'each has the reply its author sees',
    sql(`select count(*) from courses.curriculum_comments where id in (${quote(out1)}, ${quote(out2)}) and admin_response = 'We stay with this stack so every group builds the same app.'`) === '2'
  );

  // A lesson's box and one more piece, then Fix with AI: each lesson is planned and drafted.
  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=feedback`);
  await page.click('[data-testid=feedback-select]');
  const lessonBox = page.locator('[data-testid=feedback-lesson]', { has: page.locator('[id^=comment-]', { hasText: 'E2E select: add a short recap.' }) }).locator('[data-testid=feedback-select-lesson]');
  await lessonBox.check();
  await item('E2E select: a diagram of the flow here.').check();
  check('the lesson’s box picks its new feedback', await item('E2E select: the second example is unclear.').isChecked());
  await page.click('[data-testid=feedback-fix]');
  await page.waitForURL(/\/improvements/, { timeout: 60000 });
  check('the picked feedback joins its lessons’ improvements', await waitFor(() => Boolean(usedBy(a1)) && Boolean(usedBy(b1)) && Boolean(usedBy(b2)), 30));
  check(
    'each lesson is drafted',
    await waitFor(() => Number(sql(`select count(distinct target_id) from public.ai_proposals where kind = 'LESSON_REVISION' and target_id in (${lessons.map(quote).join(', ')}) and created_at >= ${quote(started)}`)) === 2, 60)
  );
  check('the first lesson opens, the next one waiting after it', await page.locator('[data-testid=queue]').waitFor({ timeout: 30000 }).then(() => true, () => false));
} catch (error) {
  check('unexpected error', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  try {
    sql(`delete from public.ai_proposals where created_at >= ${quote(started)} and (target_id in (${lessons.map(quote).join(', ')}) or task_id in (${taskIdsSql}))`);
    sql(`delete from public.tasks where created_at >= ${quote(started)} and id in (${taskIdsSql})`);
    sql(`delete from public.task_entity_links where task_id in (select (j->>'id') from json_array_elements(${quote(tasksBefore)}::json) j)`);
    sql(`insert into public.task_entity_links select * from json_populate_recordset(null::public.task_entity_links, ${quote(linksBefore)}::json) on conflict do nothing`);
    sql(
      `update public.tasks t set status = j.status, plan = j.plan, plan_updated_at = j.plan_updated_at, workplace = j.workplace, completed_at = j.completed_at, ai_notes = j.ai_notes from json_populate_recordset(null::public.tasks, ${quote(tasksBefore)}::json) j where t.id = j.id`
    );
    if (created.filter(Boolean).length) sql(`delete from courses.curriculum_comments where id in (${created.filter(Boolean).map(quote).join(', ')})`);
  } catch (error) {
    check('putting the demo data back', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
