// End-to-end check of "Improve" on the demo organisation (`yarn db:seed-demo` first; AI_MOCK=1 on
// the server): all new feedback of a group's copy is sorted on one page (what changes in each
// lesson, what's only answered, with AI's reply only suggested), the lessons' changes are drafted
// there and wait undecided, Keep and Keep all count them into one Publish (kept across a reload),
// which saves the lessons and sends the reply confirmed with Use while a note left without one
// stays open, and the learner whose note changed the lesson, or got a reply, sees it once on their
// next visit. Everything it changes in the
// group's copy (and the main course behind it) is put back at the end.
// node tests/e2e/e2e-feedback-round.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { BASE, env, sql } from './helpers.mjs';

mkdirSync('tests/e2e/.shots', { recursive: true });
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const waitFor = async (page, test, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    if (test()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

// The Evening group's copy, its lessons and the main course's behind them: what they are now.
const [groupId, versionId, courseId] = sql(
  "select g.id || '|' || v.id || '|' || v.course_id from courses.course_groups g join courses.curriculum_versions v on v.owner_group_id = g.id join courses.courses c on c.id = v.course_id join public.organizations o on o.id = c.organization_id where o.slug = 'northwind-academy' and g.name like 'Evening%' limit 1"
).split('|');
const started = sql('select now()');
const LESSON_FIELDS = 'markdown_content, published_markdown_content, revision, published_revision, published_at, access_rendered_html, access_html_source_hash, published_rendered_html, published_html_source_hash, published_title, published_short_description, published_asset_bindings, status, updated_at';
const lessonIds = sql(`select coalesce(string_agg(id, ','), '') from courses.lessons where curriculum_version_id = ${quote(versionId)}`).split(',').filter(Boolean);
const baseIds = sql(`select coalesce(string_agg(base_lesson_id, ','), '') from courses.lessons where curriculum_version_id = ${quote(versionId)} and base_lesson_id is not null`).split(',').filter(Boolean);
const allLessons = [...lessonIds, ...baseIds];
const inList = (ids) => ids.map(quote).join(', ');
const lessonsBefore = sql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, ${LESSON_FIELDS} from courses.lessons where id in (${inList(allLessons)})) t`);
const referencesBefore = sql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (select * from courses.lesson_asset_references where lesson_id in (${inList(allLessons)})) t`);
const taskIdsSql = `select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id in (${inList(allLessons)})`;
const tasksBefore = sql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, status, plan, plan_updated_at, workplace, completed_at, ai_notes, group_only from public.tasks where id in (${taskIdsSql})) t`);
const linksBefore = sql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (select * from public.task_entity_links where task_id in (${taskIdsSql})) t`);
const commentsBefore = sql(
  `select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, status, resolved_at, admin_response, admin_responded_at from courses.curriculum_comments where lesson_id in (${inList(allLessons)})) t`
);
const [learnerToken, memberId] = sql(
  `select l.token || '|' || m.id from courses.access_links l join courses.course_group_members m on m.id = l.member_id where m.group_id = ${quote(groupId)} and l.revoked_at is null order by m.position limit 1`
).split('|');
const seenBefore = sql(`select outcomes_seen_at from courses.course_group_members where id = ${quote(memberId)}`);
const ownerSeenBefore = sql(`select notes_seen_at from public.users where identifier = ${quote(env.DEMO_EMAIL)} or email = ${quote(env.DEMO_EMAIL)} limit 1`);
// Drafts already waiting in the copy (from other work): set aside while this runs, put back after.
const waitingBefore = sql(
  `select coalesce(string_agg(id, ','), '') from public.ai_proposals where kind = 'LESSON_REVISION' and status = 'OPEN' and target_id in (${inList(lessonIds)})`
).split(',').filter(Boolean);
if (waitingBefore.length) sql(`update public.ai_proposals set status = 'DISCARDED' where id in (${inList(waitingBefore)})`);
const created = [];
const status = (id) => sql(`select status from courses.curriculum_comments where id = ${quote(id)}`);
const reply = (id) => sql(`select coalesce(admin_response, '') from courses.curriculum_comments where id = ${quote(id)}`);
const usedBy = (id) => sql(`select coalesce(string_agg(task_id, ','), '') from public.task_entity_links where entity_type = 'curriculum_comment' and role = 'source' and entity_id = ${quote(id)}`);

try {
  // The learner's notes on lessons 1 and 2, and an instructor's that repeats the first on lesson 2.
  const [l1, l2] = [1, 2].map((position) =>
    sql(`select id || '|' || published_markdown_content from courses.lessons where curriculum_version_id = ${quote(versionId)} and position = ${position}`)
  );
  const passageOf = (row) =>
    row
      .slice(row.indexOf('|') + 1)
      .split(/(?:\r?\n){2,}/)
      .map((block) => block.trim())
      .find((block) => block.length > 60 && !/^[#>*`|!-]/.test(block))
      ?.slice(0, 40) ?? '';
  const lesson1 = l1.split('|')[0];
  const lesson2 = l2.split('|')[0];
  const learner = await browser.newContext();
  const learnerPage = await learner.newPage();
  const post = async (lessonId, selectedText, body) => {
    const response = await learner.request.post(`${BASE}/api/access/comment`, { data: { token: learnerToken, lessonId, selectedText, context: null, body } });
    return (await response.json()).comment?.id;
  };
  const changeIt = await post(lesson1, passageOf(l1), 'E2E round: how do I run this on Windows?');
  const praise = await post(lesson2, passageOf(l2), 'E2E round: thanks, this made it click!');
  created.push(changeIt, praise);
  check('the learner’s notes are saved', Boolean(changeIt && praise));

  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', env.DEMO_EMAIL);
  await page.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin(\?|$)/), page.click('button[type=submit]')]);
  const team = await page.request.post(`${BASE}/api/team/comment`, { data: { lessonId: lesson2, selectedText: passageOf(l2), body: 'E2E round: how do I run this on Windows?' } });
  const repeat = (await team.json()).comment?.id;
  created.push(repeat);

  // Improve, from the group's Feedback: one page, lesson by lesson, then what's only answered.
  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=feedback`);
  check('with AI, a note has no Use of its own, and nothing is picked', (await page.locator('[data-testid=feedback-use]').count()) === 0 && (await page.locator('[data-testid=feedback-select-bar]').count()) === 0);
  await page.click('[data-testid=feedback-improve]');
  await page.waitForURL(/\/improve$/);
  check('Improve opens its page and sorts while it’s watched', await page.locator('[data-testid=round-lesson]').first().waitFor({ timeout: 90000 }).then(() => true, () => false));
  // (:visible: while a reloaded page streams in, its parts are in the document twice for a moment)
  const card = page.locator('[data-testid=round-lesson]:visible', { has: page.locator('[data-testid=round-note]', { hasText: 'E2E round: how do I run this on Windows?' }) });
  check('the learner’s question changes its lesson', (await card.count()) === 1);
  const leftPraise = page.locator('[data-testid=round-left]:visible', { hasText: 'E2E round: thanks' });
  const leftRepeat = page.locator('[data-testid=round-left]:visible', { hasText: 'E2E round: how do I run this on Windows?' });
  check('thanks are only answered', (await leftPraise.count()) === 1);
  check('the same question on another lesson is answered as a duplicate', (await leftRepeat.count()) === 1 && (await leftRepeat.innerText()).includes('Same as'));
  const praiseBox = leftPraise.locator('[data-testid=round-reply]');
  check('AI only suggests a reply: the box is empty, the suggestion its placeholder', (await praiseBox.inputValue()) === '' && Boolean(await praiseBox.getAttribute('placeholder')));

  // Sorted, the lessons' changes are drafted without asking, and wait on the same page, undecided.
  check('the lesson’s changes are drafted on the page', await card.locator('[data-testid=round-change]').first().waitFor({ timeout: 120000 }).then(() => true, () => false));
  check('the learner’s question is in its lesson’s improvement', Boolean(usedBy(changeIt)));
  check('nothing is kept to start with: no Publish yet', (await page.locator('[data-testid=round-publish]').count()) === 0 && (await page.locator('[data-testid=round-keep][aria-pressed=true]').count()) === 0);
  await card.locator('[data-testid=round-keep]').first().click();
  check('Keep counts the change in Publish', /Publish/.test(await page.locator('[data-testid=round-publish]').innerText()));
  await card.locator('[data-testid=round-view-whole]').click();
  check('the whole lesson shows the changes in place', await card.locator('[data-testid=round-whole]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  await card.locator('[data-testid=round-view-changes]').click();
  await page.screenshot({ path: 'tests/e2e/.shots/round-sorted.png', fullPage: true });

  // Decisions are kept: a reload brings them back.
  await page.waitForTimeout(1500);
  await page.reload();
  await card.locator('[data-testid=round-change]').first().waitFor({ timeout: 60000 });
  check('a reload keeps what was decided', (await card.locator('[data-testid=round-keep][aria-pressed=true]').count()) >= 1);

  // Use takes the suggestion for the thanks; the duplicate is left without a reply. Keep all, Publish.
  await leftPraise.locator('[data-testid=round-use]').click();
  check('Use puts the suggestion in the box', (await praiseBox.inputValue()).length > 0);
  if (await page.locator('[data-testid=round-keep-all]').count()) await page.click('[data-testid=round-keep-all]');
  await page.click('[data-testid=round-publish]');
  check('Publish says what it did, with Undo', await page.locator('[data-testid=round-undo]').waitFor({ timeout: 90000 }).then(() => true, () => false), await page.locator('[data-testid=round-notice]').innerText().catch(() => ''));
  check('the confirmed reply is sent, and the thanks done', await waitFor(page, () => status(praise) === 'RESOLVED' && reply(praise).length > 0, 30), reply(praise));
  check('a note left without a reply stays open, unanswered', status(repeat) === 'OPEN' && reply(repeat) === '');
  check('published, the learner’s question is done', await waitFor(page, () => status(changeIt) === 'RESOLVED', 30));
  check('with every lesson published, the round is over', await waitFor(page, () => sql(`select count(*) from public.ai_proposals where kind = 'FEEDBACK_ROUND' and status = 'OPEN' and target_id = ${quote(versionId)}`) === '0', 30));

  // The learner's next visit: what happened to their feedback, once.
  await learnerPage.goto(`${BASE}/l/course/${learnerToken}`);
  const line = learnerPage.locator('[data-testid=feedback-outcomes]');
  check('the learner sees what happened to their feedback', await line.waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('one note changed the lesson, one got a reply', (await learnerPage.locator('[data-testid=outcomes-changed]').count()) === 1 && (await learnerPage.locator('[data-testid=outcomes-replied]').count()) === 1, await line.innerText().catch(() => ''));
  await learnerPage.screenshot({ path: 'tests/e2e/.shots/round-learner.png', fullPage: false });
  await learnerPage.click('[data-testid=outcomes-changed]');
  await learnerPage.click('[data-testid=outcomes-note]');
  check('a note opens on its lesson, saying the lesson was changed', await learnerPage.getByText('the lesson was changed').first().waitFor({ timeout: 20000 }).then(() => true, () => false));
  check('seen, it’s marked', await waitFor(page, () => sql(`select (outcomes_seen_at > ${quote(started)})::text from courses.course_group_members where id = ${quote(memberId)}`) === 'true', 20));
  await learnerPage.reload();
  await learnerPage.waitForTimeout(1500);
  check('the next visit doesn’t say it again', (await learnerPage.locator('[data-testid=feedback-outcomes]').count()) === 0);
  await learner.close();
} catch (error) {
  check('unexpected error', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  try {
    sql(`delete from public.ai_proposals where created_at >= ${quote(started)} and (target_id in (${inList(allLessons)}) or target_id = ${quote(versionId)} or task_id in (${taskIdsSql}))`);
    sql(`delete from courses.lesson_changes where lesson_id in (${inList(allLessons)}) and created_at >= ${quote(started)}`);
    sql(`delete from courses.lesson_publications where lesson_id in (${inList(allLessons)}) and published_at >= ${quote(started)}`);
    sql(`delete from courses.lesson_asset_references where lesson_id in (${inList(allLessons)})`);
    sql(`insert into courses.lesson_asset_references select * from json_populate_recordset(null::courses.lesson_asset_references, ${quote(referencesBefore)}::json) on conflict do nothing`);
    sql(
      `update courses.lessons l set (${LESSON_FIELDS}) = (select ${LESSON_FIELDS} from json_populate_record(null::courses.lessons, j)) from json_array_elements(${quote(lessonsBefore)}::json) j where l.id = j->>'id'`
    );
    sql(`delete from public.tasks where created_at >= ${quote(started)} and id in (${taskIdsSql})`);
    sql(`delete from public.task_entity_links where task_id in (select (j->>'id') from json_array_elements(${quote(tasksBefore)}::json) j)`);
    sql(`insert into public.task_entity_links select * from json_populate_recordset(null::public.task_entity_links, ${quote(linksBefore)}::json) on conflict do nothing`);
    sql(
      `update public.tasks t set status = j.status, plan = j.plan, plan_updated_at = j.plan_updated_at, workplace = j.workplace, completed_at = j.completed_at, ai_notes = j.ai_notes, group_only = j.group_only from json_populate_recordset(null::public.tasks, ${quote(tasksBefore)}::json) j where t.id = j.id`
    );
    if (created.filter(Boolean).length) sql(`delete from courses.curriculum_comments where id in (${created.filter(Boolean).map(quote).join(', ')})`);
    sql(
      `update courses.curriculum_comments c set status = j.status, resolved_at = j.resolved_at, admin_response = j.admin_response, admin_responded_at = j.admin_responded_at from json_populate_recordset(null::courses.curriculum_comments, ${quote(commentsBefore)}::json) j where c.id = j.id`
    );
    if (waitingBefore.length) sql(`update public.ai_proposals set status = 'OPEN' where id in (${inList(waitingBefore)})`);
    sql(`update courses.course_group_members set outcomes_seen_at = ${quote(seenBefore)} where id = ${quote(memberId)}`);
    if (ownerSeenBefore) sql(`update public.users set notes_seen_at = ${quote(ownerSeenBefore)} where identifier = ${quote(env.DEMO_EMAIL)} or email = ${quote(env.DEMO_EMAIL)}`);
  } catch (error) {
    check('putting the demo data back', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
