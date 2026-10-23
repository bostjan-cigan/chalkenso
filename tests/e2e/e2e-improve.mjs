// End-to-end check of one improvement per lesson, on the demo organisation (`yarn db:seed-demo`
// first; AI_MOCK=1 on the server, images on local disk): feedback ticked in the Improve column
// joins the lesson's improvement (unticked, it goes back out), a reply on its own marks feedback
// done, one plan (following the improvement's notes for AI, changed when asked), one draft and one
// save cover all of it, feedback ticked after the draft starts
// the next improvement, Undo puts it all back, and a plan written before more feedback joined asks
// to be updated. Then a diagram AI drew, saved on the
// group's copy for "this group and the main course", is the same image on the main course's lesson
// once that's saved too. What it adds is removed at the end, and what it changed put back.
// node tests/e2e/e2e-improve.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
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

// The Evening group's copy of lesson 3: what it is now, to put back afterwards.
const [courseId, lessonId, versionId, baseLessonId] = sql(
  "select le.course_id || '|' || le.id || '|' || v.id || '|' || coalesce(le.base_lesson_id, '') from courses.lessons le join courses.curriculum_versions v on v.id = le.curriculum_version_id join courses.course_groups g on g.id = v.owner_group_id join courses.courses c on c.id = le.course_id join public.organizations o on o.id = c.organization_id where o.slug = 'northwind-academy' and g.name like 'Evening%' and le.position = 3 limit 1"
).split('|');
const started = sql('select now()');
const lessonState = (id) => sql(`select row_to_json(t)::text from (select ${LESSON_FIELDS} from courses.lessons where id = ${quote(id)}) t`);
const referencesOf = (id) => sql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (select * from courses.lesson_asset_references where lesson_id = ${quote(id)}) t`);
const LESSON_FIELDS = 'markdown_content, published_markdown_content, revision, published_revision, published_at, access_rendered_html, access_html_source_hash, published_rendered_html, published_html_source_hash, published_title, published_short_description, published_asset_bindings, status, updated_at';
const lessonBefore = lessonState(lessonId);
const courseLessonBefore = baseLessonId ? lessonState(baseLessonId) : null;
const referencesBefore = [lessonId, baseLessonId].filter(Boolean).map((id) => ({ id, rows: referencesOf(id) }));
const tasksBefore = sql(
  `select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, status, plan, plan_updated_at, workplace, completed_at, ai_notes from public.tasks where id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)})) t`
);
const linksBefore = sql(
  `select coalesce(json_agg(row_to_json(t)), '[]')::text from (select * from public.task_entity_links where task_id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)})) t`
);
const commentsBefore = sql(
  `select coalesce(json_agg(row_to_json(t)), '[]')::text from (select id, status, resolved_at, admin_response, admin_responded_at from courses.curriculum_comments where lesson_id = ${quote(lessonId)}) t`
);
const improveUrl = `${BASE}/admin/courses/${courseId}/lessons/${lessonId}/improvements`;
const currentTask = () =>
  sql(
    `select t.id from public.tasks t join public.task_entity_links l on l.task_id = t.id and l.entity_type = 'lesson' and l.entity_id = ${quote(lessonId)} where t.status in ('TODO', 'IN_PROGRESS') and not exists (select 1 from courses.lesson_changes c where c.task_id = t.id and c.lesson_id = ${quote(lessonId)}) order by t.created_at limit 1`
  );
const usedBy = (commentId) => sql(`select coalesce(string_agg(task_id, ','), '') from public.task_entity_links where entity_type = 'curriculum_comment' and role = 'source' and entity_id = ${quote(commentId)}`);
const status = (commentId) => sql(`select status from courses.curriculum_comments where id = ${quote(commentId)}`);
const note = async (selectedText, body) => {
  const response = await page.request.post(`${BASE}/api/team/comment`, { data: { lessonId, selectedText, body } });
  return (await response.json()).comment?.id;
};
const waitFor = async (test, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    if (test()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const created = [];

try {
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', env.DEMO_EMAIL);
  await page.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin(\?|$)/), page.click('button[type=submit]')]);
  check('demo owner signed in', page.url().endsWith('/admin'));

  // Two pieces of feedback to decide, and a third to answer.
  const first = await note('A CSRF token, sent with every form', 'E2E first: does this apply to the API too?');
  const second = await note('Flask-Security-Too stores a', 'E2E second: compare session cookies and tokens.');
  const thanks = await note('Why you never build auth yourself', 'E2E thanks: this made it click.');
  created.push(first, second, thanks);

  // A piece of feedback opens whole in the column: its tick (fix it with AI) adds it to the lesson's improvement.
  const tickedIn = (selector) => page.waitForSelector(`${selector}[aria-pressed=true]`, { timeout: 15000 });
  await page.goto(`${improveUrl}?note=${first}`);
  await page.waitForSelector('[data-testid=feedback-tick]');
  check('feedback to decide offers its tick and a reply', (await page.locator('[data-testid=feedback-reply-box]').count()) === 1);
  check('its passage is marked in the lesson', await page.waitForFunction(() => (CSS.highlights?.get('improve-selected')?.size ?? 0) > 0, null, { timeout: 15000 }).then(() => true, () => false));
  await page.click('[data-testid=feedback-tick]');
  await tickedIn('[data-testid=feedback-tick]');
  await waitFor(() => Boolean(usedBy(first)), 30);
  const improvement = currentTask();
  check('the tick puts it in the lesson’s improvement', usedBy(first) === improvement && Boolean(improvement));
  await page.goto(`${improveUrl}?note=${second}`);
  await page.click('[data-testid=feedback-tick]');
  await waitFor(() => usedBy(second) === improvement, 30);
  check('the next piece joins the same improvement', usedBy(second) === improvement);
  check('used feedback stays open until the change reaches learners', status(first) === 'OPEN' && status(second) === 'OPEN');

  // Unticked: back to decide, and ticked again, from the cards beside the lesson.
  await page.goto(improveUrl);
  await page.waitForSelector('[data-testid=feedback-card]');
  const usedCount = await page.locator('[data-testid=feedback-card][data-used]').count();
  check('the column ticks the feedback the improvement uses', usedCount >= 2, `${usedCount}`);
  const secondCard = page.locator('[data-testid=feedback-card]', { hasText: 'E2E second' }).first();
  await secondCard.locator('[data-testid=card-tick]').click();
  await waitFor(() => usedBy(second) === '', 30);
  check('unticking takes it back out', usedBy(second) === '' && status(second) === 'OPEN');
  await page.goto(improveUrl);
  await page.locator('[data-testid=feedback-card]', { hasText: 'E2E second' }).first().locator('[data-testid=card-tick]').click();
  await waitFor(() => usedBy(second) === improvement, 30);

  // A reply on its own answers feedback: it's done, and no improvement uses it.
  await page.goto(`${improveUrl}?note=${thanks}`);
  await page.fill('[data-testid=feedback-reply-box]', 'Glad it helped!');
  await page.click('[data-testid=feedback-send-reply]');
  check('a reply alone marks it done', await waitFor(() => status(thanks) === 'RESOLVED', 30));
  check('and no improvement uses it', usedBy(thanks) === '');

  // Notes for AI, kept with the improvement.
  await page.goto(`${improveUrl}?i=${improvement}`);
  await page.click('[data-testid=notes-for-ai]');
  await page.fill('[data-testid=notes-for-ai-box]', 'E2E notes: career changers, keep it practical.');
  await page.click('[data-testid=notes-for-ai-save]');
  check('notes for AI are kept with the improvement', await waitFor(() => sql(`select ai_notes from public.tasks where id = ${quote(improvement)}`) === 'E2E notes: career changers, keep it practical.', 30));

  // One plan for all of it, following the notes (Save closed the sheet).
  const boxText = () => page.locator('[data-testid=plan-box] .ProseMirror').innerText();
  await page.click('[data-testid=plan-with-ai]');
  await page.waitForFunction(() => ((document.querySelector('[data-testid=plan-box] .ProseMirror')?.textContent || '')).trim().length > 0, null, { timeout: 30000 });
  const planText = await boxText();
  check('one plan covers both pieces', planText.includes('E2E first') && planText.includes('E2E second'));
  check('the plan follows the notes for AI', planText.includes('Following the notes: E2E notes'));
  // Ask for changes: the plan comes back changed, in the box, to review and save.
  await page.fill('[data-testid=ask-plan]', 'E2E ask: end with a short check.');
  await page.click('[data-testid=ask-plan-send]');
  await page.waitForFunction(() => ((document.querySelector('[data-testid=plan-box] .ProseMirror')?.textContent || '')).includes('As asked: E2E ask'), null, { timeout: 30000 });
  check('asking for changes revises the plan, keeping the rest', (await boxText()).includes('E2E first') && (await boxText()).includes('As asked: E2E ask'));
  await page.click('[data-testid=save-plan]');
  await page.waitForSelector('[data-testid=draft-changes]');

  // One draft: feedback used while it's written waits for the next one.
  await page.click('[data-testid=draft-changes]');
  const late = await note('Because the browser sends cookies automatically', 'E2E late: show a forged request.');
  created.push(late);
  await page.waitForSelector('[data-testid=apply-improvement]', { timeout: 30000 });
  // Used from the group's Feedback list, which stays where it is.
  await page.goto(`${BASE}/admin/courses/comments/${versionId}`);
  const card = page.locator('[id^=comment-]', { hasText: 'E2E late' }).first();
  await card.locator('[data-testid=feedback-use]').click();
  await card.locator('a', { hasText: 'In the lesson’s improvement' }).waitFor({ timeout: 15000 });
  check('Use on the Feedback list keeps the list', !page.url().includes('/improvements') && usedBy(late) === improvement);
  await page.goto(`${improveUrl}?i=${improvement}`);
  check('the review says what came after the draft', await page.locator('[data-testid=later-note]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  const button = await page.locator('[data-testid=apply-improvement]').innerText();
  check('the review’s last step publishes (a published lesson)', /^Publish/.test(button), button);
  await page.screenshot({ path: 'tests/e2e/.shots/improve-review.png', fullPage: true });

  // One save: what the draft covered is done; the late piece starts the next improvement.
  await page.click('[data-testid=apply-improvement]');
  await page.locator('[data-testid=improvements-notice]').waitFor({ timeout: 30000 });
  const notice = await page.locator('[data-testid=improvements-notice]').innerText();
  check('saving says what it did', notice.includes('Published') && notice.includes('next improvement'), notice);
  check('the feedback it covered is done', status(first) === 'RESOLVED' && status(second) === 'RESOLVED');
  const next = usedBy(late);
  check('the late piece starts the next improvement', status(late) === 'OPEN' && Boolean(next) && next !== improvement);
  check('one change recorded for the improvement', sql(`select count(*) from courses.lesson_changes where lesson_id = ${quote(lessonId)} and task_id = ${quote(improvement)}`) === '1');
  const carriedOpen = () =>
    sql(`select count(*) from public.ai_proposals where target_id = ${quote(baseLessonId)} and status = 'OPEN' and created_at >= ${quote(started)}`);
  check('the change waits on the main course’s lesson', carriedOpen() === '1');

  // Undo: the text, the feedback, the draft and the late piece go back.
  await page.locator('[data-testid=improvements-notice]').getByRole('button', { name: 'Undo' }).click();
  await waitFor(() => usedBy(late) === improvement, 40);
  check('Undo gives the late piece back to the improvement', usedBy(late) === improvement && sql(`select count(*) from public.tasks where id = ${quote(next)}`) === '0');
  check('Undo opens the feedback again', status(first) === 'OPEN' && status(second) === 'OPEN');
  // Forms send line breaks as CRLF, as every save from the browser does.
  const textNow = sql(`select replace(markdown_content, chr(13), '') from courses.lessons where id = ${quote(lessonId)}`);
  check('Undo puts the lesson’s text back', textNow === JSON.parse(lessonBefore).markdown_content.replace(/\r/g, '').trim());
  await page.goto(`${improveUrl}?i=${improvement}`);
  check('and the changes wait for review again', await page.locator('[data-testid=apply-improvement]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('Undo takes back what the save carried to the main course’s lesson', carriedOpen() === '0');

  // Discarded, the plan comes first again: it was written before the late piece joined.
  for (let attempt = 0; attempt < 5 && !(await page.getByRole('menuitem', { name: 'Discard changes' }).isVisible()); attempt += 1) {
    await page.locator('[data-testid=improvement-detail]').getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Discard changes' }).waitFor({ timeout: 3000 }).catch(() => {});
  }
  await page.getByRole('menuitem', { name: 'Discard changes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  check('a plan written before more feedback asks to be updated', await page.locator('[data-testid=plan-stale]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.click('[data-testid=update-plan]');
  await page.waitForFunction(() => ((document.querySelector('[data-testid=plan-box] .ProseMirror')?.textContent || '')).includes('E2E late'), null, { timeout: 30000 });
  await page.click('[data-testid=save-plan]');
  await page.waitForSelector('[data-testid=draft-changes]');
  check('the updated plan keeps the plan and adds the late piece', /E2E first[\s\S]*E2E late/.test(sql(`select plan from public.tasks where id = ${quote(improvement)}`)));

  // A diagram AI draws, saved on the group's copy for this group and the main course: the main
  // course's lesson shows the same image in its review, and binds it when it's saved.
  const diagramNote = await note('A CSRF token, sent with every form', 'E2E diagram: a diagram of how the token travels would help.');
  created.push(diagramNote);
  await page.goto(`${improveUrl}?note=${diagramNote}`);
  await page.click('[data-testid=feedback-tick]');
  await waitFor(() => usedBy(diagramNote) === improvement, 30);
  await page.goto(`${improveUrl}?i=${improvement}`);
  await page.click('[data-testid=update-plan]');
  await page.waitForFunction(() => ((document.querySelector('[data-testid=plan-box] .ProseMirror')?.textContent || '')).includes('E2E diagram'), null, { timeout: 30000 });
  await page.click('[data-testid=save-plan]');
  check('the improvement goes to the group and the main course', /Scope: group and core/.test(sql(`select plan from public.tasks where id = ${quote(improvement)}`)));
  await page.click('[data-testid=draft-changes]');
  await page.waitForSelector('[data-testid=apply-improvement]', { timeout: 30000 });
  const drawn = page.locator('[data-testid=lesson-part] img[src*="/admin/api/drafts/"]');
  check('the review shows the diagram AI drew', await drawn.first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.click('[data-testid=apply-improvement]');
  await page.locator('[data-testid=improvements-notice]').waitFor({ timeout: 30000 });
  const copyAsset = sql(`select coalesce(asset_id, '') from courses.lesson_asset_references where lesson_id = ${quote(lessonId)} and source_path like 'diagrams/%' limit 1`);
  check('saved on the copy, the diagram is stored and bound there', Boolean(copyAsset));
  const carriedDraft = sql(
    `select id from public.ai_proposals where target_id = ${quote(baseLessonId)} and status = 'OPEN' and task_id = ${quote(improvement)} order by updated_at desc limit 1`
  );
  check('the main course’s lesson gets the change, diagram and all', Boolean(carriedDraft) && sql(`select payload->>'markdown' from public.ai_proposals where id = ${quote(carriedDraft)}`).includes('diagrams/'));
  const courseImproveUrl = `${BASE}/admin/courses/${courseId}/lessons/${baseLessonId}/improvements?draft=${carriedDraft}`;
  await page.goto(courseImproveUrl);
  await page.waitForSelector('[data-testid=apply-improvement]', { timeout: 30000 });
  const carriedImage = page.locator('[data-testid=lesson-part] img[src*="diagrams"], [data-testid=lesson-part] img[alt*="request travels"]').first();
  await carriedImage.waitFor({ timeout: 15000 }).catch(() => {});
  const shows = await carriedImage.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
  check('the main course’s review shows the copy’s image', shows);
  await page.click('[data-testid=apply-improvement]');
  await page.locator('[data-testid=improvements-notice]').waitFor({ timeout: 30000 });
  const courseAsset = sql(`select coalesce(asset_id, '') from courses.lesson_asset_references where lesson_id = ${quote(baseLessonId)} and source_path like 'diagrams/%' limit 1`);
  check('saved on the main course, its lesson binds the same image', Boolean(courseAsset) && courseAsset === copyAsset, `${courseAsset} vs ${copyAsset}`);
  check(
    'and learners of the main course get it (published bindings)',
    sql(`select coalesce(published_asset_bindings::text, '') from courses.lessons where id = ${quote(baseLessonId)}`).includes(copyAsset)
  );
} catch (error) {
  check('unexpected error', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  // Put back what it changed, and remove what it added.
  try {
    const lesson = JSON.parse(lessonBefore);
    // Images stored by the saves: their rows and files.
    const assets = sql(`select coalesce(string_agg(id || '|' || r2_key, ','), '') from courses.media_assets where created_at >= ${quote(started)}`);
    for (const id of [lessonId, baseLessonId].filter(Boolean)) {
      sql(`delete from courses.lesson_asset_references where lesson_id = ${quote(id)}`);
    }
    for (const { rows } of referencesBefore) {
      sql(`insert into courses.lesson_asset_references select * from json_populate_recordset(null::courses.lesson_asset_references, ${quote(rows)}::json) on conflict do nothing`);
    }
    for (const entry of assets ? assets.split(',') : []) {
      const [assetId, key] = entry.split('|');
      sql(`delete from courses.media_assets where id = ${quote(assetId)}`);
      // On local disk, the object and its sidecar of metadata.
      if (key) for (const file of [key, `${key}.meta.json`]) rmSync(path.join(env.STORAGE_DIR || '.data/media', file), { force: true });
    }
    if (courseLessonBefore) {
      sql(`delete from courses.lesson_changes where lesson_id = ${quote(baseLessonId)} and created_at >= ${quote(started)}`);
      sql(`delete from courses.lesson_publications where lesson_id = ${quote(baseLessonId)} and published_at >= ${quote(started)}`);
      sql(
        `update courses.lessons l set (${LESSON_FIELDS}) = (select ${LESSON_FIELDS} from json_populate_record(null::courses.lessons, ${quote(courseLessonBefore)}::json)) where l.id = ${quote(baseLessonId)}`
      );
    }
    sql(`delete from public.ai_proposals where target_id in (${quote(lessonId)}${baseLessonId ? `, ${quote(baseLessonId)}` : ''}) and created_at >= ${quote(started)}`);
    sql(`delete from public.ai_proposals where task_id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)}) and created_at >= ${quote(started)}`);
    sql(`delete from courses.lesson_changes where lesson_id = ${quote(lessonId)} and created_at >= ${quote(started)}`);
    sql(`delete from courses.lesson_publications where lesson_id = ${quote(lessonId)} and published_at >= ${quote(started)}`);
    sql(`delete from public.tasks where created_at >= ${quote(started)} and id in (select task_id from public.task_entity_links where entity_type = 'lesson' and entity_id = ${quote(lessonId)})`);
    sql(`delete from public.task_entity_links where task_id in (select (j->>'id') from json_array_elements(${quote(tasksBefore)}::json) j)`);
    sql(`insert into public.task_entity_links select * from json_populate_recordset(null::public.task_entity_links, ${quote(linksBefore)}::json) on conflict do nothing`);
    sql(
      `update public.tasks t set status = j.status, plan = j.plan, plan_updated_at = j.plan_updated_at, workplace = j.workplace, completed_at = j.completed_at, ai_notes = j.ai_notes from json_populate_recordset(null::public.tasks, ${quote(tasksBefore)}::json) j where t.id = j.id`
    );
    if (created.filter(Boolean).length) sql(`delete from courses.curriculum_comments where id in (${created.filter(Boolean).map(quote).join(', ')})`);
    sql(
      `update courses.curriculum_comments c set status = j.status, resolved_at = j.resolved_at, admin_response = j.admin_response, admin_responded_at = j.admin_responded_at from json_populate_recordset(null::courses.curriculum_comments, ${quote(commentsBefore)}::json) j where c.id = j.id`
    );
    sql(
      `update courses.lessons l set (${LESSON_FIELDS}) = (select ${LESSON_FIELDS} from json_populate_record(null::courses.lessons, ${quote(JSON.stringify(lesson))}::json)) where l.id = ${quote(lessonId)}`
    );
  } catch (error) {
    check('putting the demo data back', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
