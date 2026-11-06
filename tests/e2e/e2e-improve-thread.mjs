// End-to-end check of an improvement's thread in the lesson's Improve mode, on the demo organisation
// (`yarn db:seed-demo` first; AI_MOCK=1 on the server): with a change skipped, asking for changes
// ("shorter") gets a new attempt that goes on from the one waiting, as kept, and remembers what was
// asked; the earlier attempt stays in the thread and can be used again; a turn that's stopped leaves
// the attempt that was waiting; and on a phone the message field can be pressed. Published, the
// improvement is in the lesson's history (Done) with what was asked on the way, and so is an edit
// published without one. What it adds is removed at the end, and what it changed put back.
// node tests/e2e/e2e-improve-thread.mjs
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

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

// The Evening group's copy of lesson 2: its improvements now, to put back afterwards.
const [courseId, lessonId] = sql(
  "select le.course_id || '|' || le.id from courses.lessons le join courses.curriculum_versions v on v.id = le.curriculum_version_id join courses.course_groups g on g.id = v.owner_group_id join courses.courses c on c.id = le.course_id join public.organizations o on o.id = c.organization_id where o.slug = 'northwind-academy' and g.name like 'Evening%' and le.position = 2 limit 1"
).split('|');
const started = sql('select now()');
const lessonText = () => sql(`select markdown_content from courses.lessons where id = ${quote(lessonId)}`);
const textBefore = lessonText();
const LESSON_FIELDS = 'markdown_content, published_markdown_content, revision, published_revision, published_at, access_rendered_html, access_html_source_hash, published_rendered_html, published_html_source_hash, published_title, published_short_description, published_asset_bindings, status, updated_at';
const lessonBefore = sql(`select row_to_json(t)::text from (select ${LESSON_FIELDS} from courses.lessons where id = ${quote(lessonId)}) t`);
const commentsBefore = sql(
  `select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, status, resolved_at, admin_response, admin_responded_at from courses.curriculum_comments where lesson_id = ${quote(lessonId)}) t`
);
const tasksBefore = sql(
  `select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, status, plan, plan_updated_at, workplace, completed_at, ai_notes from public.tasks where id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)})) t`
);
const linksBefore = sql(
  `select coalesce(json_agg(row_to_json(t)), '[]')::text from (select * from public.task_entity_links where task_id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)})) t`
);
const improveUrl = `${BASE}/admin/courses/${courseId}/lessons/${lessonId}/improvements`;
const firstParagraph = textBefore.split(/\n{2,}/).find((block) => block.length > 60 && !block.startsWith('#') && !block.startsWith('**') && !block.startsWith('>'))?.slice(0, 40) ?? '';
const created = [];
const waitFor = async (test, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    if (test()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const open = (taskId) => sql(`select coalesce(string_agg(id, ','), '') from public.ai_proposals where kind = 'LESSON_REVISION' and target_id = ${quote(lessonId)} and task_id = ${quote(taskId)} and status = 'OPEN'`);

try {
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', env.DEMO_EMAIL);
  await page.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin(\?|$)/), page.click('button[type=submit]')]);
  check('demo owner signed in', page.url().endsWith('/admin'));

  // Feedback on the lesson, and Improve this lesson: it comes in, and AI writes the plan and a first attempt.
  const response = await page.request.post(`${BASE}/api/team/comment`, { data: { lessonId, selectedText: firstParagraph, body: 'E2E thread: an example would help here.' } });
  const comment = (await response.json()).comment?.id;
  created.push(comment);
  await page.goto(improveUrl);
  await page.click('[data-testid=improve-lesson]');
  await waitFor(() => Boolean(sql(`select coalesce(string_agg(task_id, ','), '') from public.task_entity_links where entity_type = 'curriculum_comment' and entity_id = ${quote(comment)}`)), 30);
  const improvement = sql(`select task_id from public.task_entity_links where entity_type = 'curriculum_comment' and entity_id = ${quote(comment)} limit 1`);
  check('the feedback is in the lesson’s improvement', Boolean(improvement));
  await page.waitForSelector('[data-testid=apply-improvement]', { timeout: 60000 });
  const first = open(improvement);
  check('a first attempt waits for review', Boolean(first) && !first.includes(','), first);
  check('the why stays in view while reviewing: notes for AI', (await page.locator('[data-testid=notes-for-ai]').count()) > 0);
  check('and the message field is there', (await page.locator('[data-testid=thread-ask]').count()) === 1);

  // One change skipped, then "shorter": AI goes on from the attempt as kept.
  const rows = page.locator('[data-testid=change-row]');
  const rowCount = await rows.count();
  await rows.first().locator('[data-testid=change-keep]').click();
  check('a change is skipped', (await rows.first().getAttribute('data-skipped')) !== null, `${rowCount} rows`);
  await page.click('[data-testid=thread-send]');
  check('sending nothing says what to do', (await page.locator('[data-testid=thread-error]').innerText()).length > 0);
  await page.fill('[data-testid=thread-ask]', 'E2E shorter, please');
  await page.click('[data-testid=thread-send]');
  check('what was asked shows in the thread while AI writes', await page.locator('[data-testid=thread-request]', { hasText: 'E2E shorter' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.waitForFunction((id) => document.querySelector('[data-testid=apply-improvement]') && !document.querySelector('[data-testid=changes-working]'), first, { timeout: 60000 });
  check('the new attempt goes on from the first', await waitFor(() => Boolean(open(improvement)) && open(improvement) !== first, 40));
  const second = open(improvement);
  const row = sql(`select coalesce(continues_id, '') || '|' || coalesce(request, '') from public.ai_proposals where id = ${quote(second)}`).split('|');
  check('it records the attempt it went on from, and what was asked', row[0] === first && row[1] === 'E2E shorter, please', row.join(' | '));
  const secondText = sql(`select payload->>'markdown' from public.ai_proposals where id = ${quote(second)}`);
  check('AI did what was asked', secondText.includes('As asked: E2E shorter'));
  const skippedText = sql(`select coalesce(payload->'why'->'skipped'->0->'after'->>0, '') from public.ai_proposals where id = ${quote(second)}`);
  check('the skipped change is named for AI', Boolean(skippedText), skippedText.slice(0, 80));
  check('and isn’t in the new attempt', !secondText.includes(skippedText.trim().slice(0, 60)));
  check('the first attempt stays, no longer waiting', sql(`select status from public.ai_proposals where id = ${quote(first)}`) === 'DISCARDED');
  await page.waitForSelector('[data-testid=thread-attempt]', { timeout: 15000 });
  check('the thread shows the earlier attempt', (await page.locator('[data-testid=thread-attempt]').count()) === 1);
  check('and what was asked', (await page.locator('[data-testid=thread-request]', { hasText: 'E2E shorter' }).count()) === 1);
  await page.screenshot({ path: 'tests/e2e/.shots/improve-thread.png', fullPage: false });

  // The earlier attempt, used again: it waits for review, the newer one stays in the thread.
  await page.click('[data-testid=thread-use]');
  check('Use this one makes the earlier attempt the one waiting', await waitFor(() => open(improvement) === first, 30), open(improvement));
  check('the newer one stays, to come back to', sql(`select status from public.ai_proposals where id = ${quote(second)}`) === 'DISCARDED');
  await page.waitForSelector('[data-testid=thread-attempt]', { timeout: 15000 });
  check('the thread now offers the newer one', (await page.locator('[data-testid=thread-attempt]').count()) === 1);

  // A turn that's stopped: the attempt that was waiting is still the one.
  await page.fill('[data-testid=thread-ask]', 'E2E stopped turn');
  await page.click('[data-testid=thread-send]');
  const stop = page.locator('[data-testid=changes-working]').getByRole('button', { name: 'Stop' });
  await stop.waitFor({ timeout: 15000 });
  await stop.click();
  check('stopped, the attempt waiting comes back', await page.locator('[data-testid=apply-improvement]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('still waiting in the database', open(improvement) === first);

  // On a phone: the message field and Publish can be pressed.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${improveUrl}?i=${improvement}`);
  await page.waitForSelector('[data-testid=thread-ask]');
  const reachable = (testId) =>
    page.locator(`[data-testid=${testId}]`).evaluate((element) => {
      element.scrollIntoView({ block: 'center' });
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    });
  check('on a phone the message field can be pressed', await reachable('thread-ask'));
  check('and Publish too', await reachable('apply-improvement'));
  check('and the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: 'tests/e2e/.shots/improve-thread-phone.png', fullPage: false });
  check('the lesson itself is unchanged', lessonText() === textBefore);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Published (to this group only), the improvement is in the lesson's history with its thread.
  await page.goto(`${improveUrl}?i=${improvement}`);
  await page.waitForSelector('[data-testid=apply-improvement]');
  if ((await page.locator('[data-testid=also-course]').getAttribute('aria-checked').catch(() => null)) === 'true') await page.click('[data-testid=also-course]');
  await page.click('[data-testid=apply-improvement]');
  await page.locator('[data-testid=improvements-notice]').waitFor({ timeout: 30000 });
  check('published, the improvement is done', await waitFor(() => sql(`select status from public.tasks where id = ${quote(improvement)}`) === 'DONE', 30));
  await page.goto(`${improveUrl}`);
  await page.getByRole('button', { name: /^Done/ }).click();
  await page.locator('[data-testid=done-list]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid=done-list] button').first().click();
  check('its history shows how the changes came about', await page.locator('[data-testid=thread-request]', { hasText: 'E2E shorter' }).waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('every attempt, read-only', (await page.locator('[data-testid=thread-attempt]').count()) >= 2 && (await page.locator('[data-testid=thread-use]').count()) === 0);
  check('and what it changed', (await page.locator('[data-testid=step-what-changed]').count()) === 1);
  await page.screenshot({ path: 'tests/e2e/.shots/improve-history.png', fullPage: false });

  // An edit published without an improvement (Edit mode, an upload): in the history too.
  const top = sql(`select max(revision) from courses.lesson_publications where lesson_id = ${quote(lessonId)}`);
  const topText = sql(`select markdown_content from courses.lesson_publications where lesson_id = ${quote(lessonId)} and revision = ${top}`);
  sql(
    `insert into courses.lesson_publications (id, lesson_id, revision, title, markdown_content, published_at, publisher_name) values ('e2e-edit-${Date.now()}', ${quote(lessonId)}, ${Number(top) + 1000}, 'E2E', ${quote(`${topText}

E2E edited by hand.`)}, now(), 'E2E Editor')`
  );
  await page.goto(`${improveUrl}`);
  await page.getByRole('button', { name: /^Done/ }).click();
  const edit = page.locator('[data-testid=history-edit]').first();
  check('an edit published without an improvement is in the history', await edit.waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('named with who published it', (await edit.innerText()).includes('E2E Editor'));
  await edit.click();
  check('it shows what it changed', await page.locator('[data-testid=step-what-changed]').innerText().then((text) => text.includes('E2E edited by hand'), () => false));
  await page.screenshot({ path: 'tests/e2e/.shots/improve-history-edit.png', fullPage: false });
} catch (error) {
  check('unexpected error', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  try {
    sql(`delete from courses.lesson_publications where lesson_id = ${quote(lessonId)} and (published_at >= ${quote(started)} or id like 'e2e-edit-%')`);
    sql(`delete from courses.lesson_changes where lesson_id = ${quote(lessonId)} and created_at >= ${quote(started)}`);
    sql(
      `update courses.lessons l set (${LESSON_FIELDS}) = (select ${LESSON_FIELDS} from json_populate_record(null::courses.lessons, ${quote(lessonBefore)}::json)) where l.id = ${quote(lessonId)}`
    );
    sql(
      `update courses.curriculum_comments c set status = j.status, resolved_at = j.resolved_at, admin_response = j.admin_response, admin_responded_at = j.admin_responded_at from json_populate_recordset(null::courses.curriculum_comments, ${quote(commentsBefore)}::json) j where c.id = j.id`
    );
    sql(`delete from public.ai_proposals where target_id = ${quote(lessonId)} and created_at >= ${quote(started)}`);
    sql(`delete from public.ai_proposals where task_id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)}) and created_at >= ${quote(started)}`);
    sql(`delete from public.tasks where created_at >= ${quote(started)} and id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)})`);
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
