// End-to-end check of one improvement per lesson, on the demo organisation (`yarn db:seed-demo`
// first; AI_MOCK=1 on the server, images on local disk): feedback ticked in the Improve column
// joins the lesson's improvement (unticked, it goes back out), a reply on its own marks feedback
// done, one plan (following the improvement's notes for AI, changed when asked), one draft and one
// save cover all of it, feedback ticked after the draft starts
// the next improvement, Undo puts it all back, and a plan written before more feedback joined asks
// to be updated. One Publish on the group's copy puts the changes into the main course's lesson too
// (and Undo takes them back out there); a diagram AI drew is the same image on the main course's
// lesson, and what waits there for a look is reviewed there. What it adds is removed at the end,
// and what it changed put back.
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

  // Two pieces of feedback to fix, and a third to answer.
  const first = await note('A CSRF token, sent with every form', 'E2E first: does this apply to the API too?');
  const second = await note('Flask-Security-Too stores a', 'E2E second: compare session cookies and tokens.');
  const thanks = await note('Why you never build auth yourself', 'E2E thanks: this made it click.');
  created.push(first, second, thanks);

  // A piece of feedback opens whole in the column: it's in the lesson's next change by default, and
  // Leave out takes it out, with a reply (required).
  await page.goto(`${improveUrl}?note=${first}`);
  await page.waitForSelector('[data-testid=feedback-leave-out]');
  check('feedback opens with Leave out and a reply, no tick', (await page.locator('[data-testid=feedback-reply-box]').count()) === 1 && (await page.locator('[data-testid=feedback-tick]').count()) === 0);
  check('its passage is marked in the lesson', await page.waitForFunction(() => (CSS.highlights?.get('improve-selected')?.size ?? 0) > 0, null, { timeout: 15000 }).then(() => true, () => false));
  // Use on the group's Feedback list puts it in the lesson's improvement (the list stays).
  await page.goto(`${BASE}/admin/courses/comments/${versionId}`);
  await page.locator('[id^=comment-]', { hasText: 'E2E first' }).first().locator('[data-testid=feedback-use]').click();
  await waitFor(() => Boolean(usedBy(first)), 30);
  const improvement = currentTask();
  check('Use puts it in the lesson’s improvement', usedBy(first) === improvement && Boolean(improvement));
  check('used feedback stays open until the change reaches learners', status(first) === 'OPEN' && status(second) === 'OPEN');

  // Leave out: the reply is required, and then it's done, with no improvement using it.
  await page.goto(`${improveUrl}?note=${thanks}`);
  await page.click('[data-testid=feedback-leave-out]');
  check('leaving out without a reply asks for one', status(thanks) === 'OPEN');
  await page.fill('[data-testid=feedback-reply-box]', 'Glad it helped!');
  await page.click('[data-testid=feedback-leave-out]');
  check('left out with a reply, it’s done', await waitFor(() => status(thanks) === 'RESOLVED', 30));
  check('with the reply its learner sees, and no improvement uses it', sql(`select admin_response from courses.curriculum_comments where id = ${quote(thanks)}`) === 'Glad it helped!' && usedBy(thanks) === '');

  // Notes for AI, kept with the improvement.
  await page.goto(`${improveUrl}?i=${improvement}`);
  await page.click('[data-testid=notes-for-ai]');
  await page.fill('[data-testid=notes-for-ai-box]', 'E2E notes: career changers, keep it practical.');
  await page.click('[data-testid=notes-for-ai-save]');
  check('notes for AI are kept with the improvement', await waitFor(() => sql(`select ai_notes from public.tasks where id = ${quote(improvement)}`) === 'E2E notes: career changers, keep it practical.', 30));

  // Improve this lesson: the new feedback comes in, and AI writes the plan, then the changes, in one go.
  await page.goto(`${improveUrl}?i=${improvement}`);
  await page.click('[data-testid=improve-lesson]');
  check('the working state shows on the click, before the server answers', await page.locator('[data-testid=changes-working]').waitFor({ timeout: 500 }).then(() => true, () => false));
  check('the plan shows as it’s written', await page.locator('[data-testid=live-plan]').waitFor({ timeout: 30000 }).then(() => true, () => false));
  check('the lesson’s new feedback came in by default', await waitFor(() => usedBy(second) === improvement, 30));
  check('progress is then the lesson’s own sections', await page.locator('[data-testid=live-section]').first().waitFor({ timeout: 40000 }).then(() => true, () => false));
  const planText = sql(`select plan from public.tasks where id = ${quote(improvement)}`);
  check('one plan covers both pieces', planText.includes('E2E first') && planText.includes('E2E second'), planText.slice(0, 200));
  check('the plan follows the notes for AI', planText.includes('Following the notes: E2E notes'));
  await page.screenshot({ path: 'tests/e2e/.shots/improve-working.png', fullPage: false });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('with less motion asked for, the working block holds still', await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid=changes-working], [data-testid=changes-working] *')).every((element) => getComputedStyle(element).animationName === 'none')));
  await page.emulateMedia({ reducedMotion: null });
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

  // Reviewed in the lesson, by keyboard; the three ways to read it.
  const position = () => page.locator('[data-testid=review-position]').innerText();
  const shown = page.locator('[data-testid=inline-change]');
  check('the review bar says which change', /^1 of \d+$/.test(await position()), await position());
  check('the path shows both places', (await page.locator('[data-testid=improvement-path]').innerText()).includes('Main course'));
  check('Publish says it goes to the main course too', (await page.locator('[data-testid=also-course]').getAttribute('aria-checked')) === 'true' && (await page.locator('[data-testid=also-course]').getAttribute('aria-label')) === 'Also to the main course');
  await page.locator('[data-testid=lesson-part]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Backspace');
  check('⌫ skips the change', (await shown.first().getAttribute('data-decision')) === 'skip');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  check('⏎ keeps it', (await shown.first().getAttribute('data-decision')) === 'keep');
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(200);
  check('the three ways to read it stay in view as the lesson scrolls', await page.locator('[data-testid=review-view]').evaluate((control) => control.getBoundingClientRect().top >= 0 && control.getBoundingClientRect().top < 40));
  await page.locator('[data-testid=review-view]').getByRole('button', { name: 'Final', exact: true }).click();
  check('Final reads without marks', (await page.locator('[data-testid=lesson-part] ins, [data-testid=lesson-part] del').count()) === 0);
  await page.locator('[data-testid=review-view]').getByRole('button', { name: 'Markup', exact: true }).click();
  await page.screenshot({ path: 'tests/e2e/.shots/improve-review-window.png', fullPage: false });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/e2e/.shots/improve-review-dark.png', fullPage: false });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/e2e/.shots/improve-review-phone.png', fullPage: false });
  await page.getByRole('button', { name: 'Lesson', exact: true }).click();
  await page.locator('[data-testid=review-bar]').waitFor({ timeout: 5000 });
  await page.locator('[data-testid=inline-change]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/e2e/.shots/improve-review-phone-lesson.png', fullPage: false });
  const reachable = (testId) =>
    page.locator(`[data-testid=${testId}]`).evaluate((button) => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    });
  check('on a phone Keep and Skip can be pressed, nothing lies over them', (await reachable('review-keep')) && (await reachable('review-skip')));
  check('on a phone the bar stays on the page', await page.locator('[data-testid=review-bar]').evaluate((bar) => bar.scrollWidth <= window.innerWidth));
  check('and the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1280, height: 900 });

  // One save: what the draft covered is done; the late piece starts the next improvement.
  await page.click('[data-testid=apply-improvement]');
  await page.locator('[data-testid=improvements-notice]').waitFor({ timeout: 30000 });
  const notice = await page.locator('[data-testid=improvements-notice]').innerText();
  check('saving says what it did', notice.includes('Published') && notice.includes('next improvement'), notice);
  check('and that the main course has it too', notice.includes('in the main course too'), notice);
  check('the feedback it covered is done', status(first) === 'RESOLVED' && status(second) === 'RESOLVED');
  const next = usedBy(late);
  check('the late piece starts the next improvement', status(late) === 'OPEN' && Boolean(next) && next !== improvement);
  check('one change recorded for the improvement', sql(`select count(*) from courses.lesson_changes where lesson_id = ${quote(lessonId)} and task_id = ${quote(improvement)}`) === '1');
  const carriedOpen = () =>
    sql(`select count(*) from public.ai_proposals where target_id = ${quote(baseLessonId)} and status = 'OPEN' and created_at >= ${quote(started)}`);
  // The same Publish: the main course's lesson has the change, recorded for the same improvement.
  const groupChange = sql(`select id from courses.lesson_changes where lesson_id = ${quote(lessonId)} and task_id = ${quote(improvement)} limit 1`);
  const courseText = () => sql(`select replace(markdown_content, chr(13), '') from courses.lessons where id = ${quote(baseLessonId)}`);
  // The notes the change added on the group's copy (one per passage the feedback points at).
  const added = sql(`select replace(markdown_content, chr(13), '') from courses.lessons where id = ${quote(lessonId)}`)
    .split(/\n{2,}/)
    .filter((block) => block.startsWith('> [!note]') && !JSON.parse(lessonBefore).markdown_content.includes(block));
  const courseBefore = JSON.parse(courseLessonBefore).markdown_content.replace(/\r/g, '');
  check('one Publish puts the change into the main course’s lesson', added.length > 0 && courseText() !== courseBefore.trim() && added.some((block) => courseText().includes(block)), added.join(' | ').slice(0, 200));
  check(
    'recorded there as the same improvement’s change, from the group’s',
    sql(`select count(*) from courses.lesson_changes where lesson_id = ${quote(baseLessonId)} and task_id = ${quote(improvement)} and carried_from_id = ${quote(groupChange)}`) === '1'
  );
  check('and its learners get it', added.some((block) => sql(`select replace(coalesce(published_markdown_content, ''), chr(13), '') from courses.lessons where id = ${quote(baseLessonId)}`).includes(block)));
  const waitingAfterPublish = carriedOpen();
  check('what waits there for a look is at most one draft', waitingAfterPublish === '0' || waitingAfterPublish === '1', waitingAfterPublish);

  // Undo: the text, the feedback, the draft and the late piece go back.
  await page.locator('[data-testid=improvements-notice]').getByRole('button', { name: 'Undo' }).click();
  await waitFor(() => usedBy(late) === improvement, 40);
  check('Undo says it also took the changes back from the main course', await page.locator('[data-testid=improvements-notice]', { hasText: 'here and on the main course' }).waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('Undo gives the late piece back to the improvement', usedBy(late) === improvement && sql(`select count(*) from public.tasks where id = ${quote(next)}`) === '0');
  check('Undo opens the feedback again', status(first) === 'OPEN' && status(second) === 'OPEN');
  // Forms send line breaks as CRLF, as every save from the browser does.
  const textNow = sql(`select replace(markdown_content, chr(13), '') from courses.lessons where id = ${quote(lessonId)}`);
  check('Undo puts the lesson’s text back', textNow === JSON.parse(lessonBefore).markdown_content.replace(/\r/g, '').trim());
  await page.goto(`${improveUrl}?i=${improvement}`);
  check('and the changes wait for review again', await page.locator('[data-testid=apply-improvement]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('Undo takes back what the save carried to the main course’s lesson', carriedOpen() === '0');
  check('Undo puts the main course’s text back', courseText() === courseBefore.trim() || !added.some((block) => courseText().includes(block)));
  check('and forgets its change there', sql(`select count(*) from courses.lesson_changes where lesson_id = ${quote(baseLessonId)} and task_id = ${quote(improvement)}`) === '0');

  // Discarded, the plan comes first again: it was written before the late piece joined.
  for (let attempt = 0; attempt < 5 && !(await page.getByRole('menuitem', { name: 'Discard changes' }).isVisible()); attempt += 1) {
    await page.locator('[data-testid=improvement-detail]').getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Discard changes' }).waitFor({ timeout: 3000 }).catch(() => {});
  }
  await page.getByRole('menuitem', { name: 'Discard changes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  check('a plan written before more feedback asks to be updated', await page.locator('[data-testid=plan-stale]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  // Improve this lesson again: the plan is updated (keeping what still applies) and the changes written.
  await page.click('[data-testid=improve-lesson]');
  await page.waitForSelector('[data-testid=apply-improvement]', { timeout: 60000 });
  check('the updated plan keeps the plan and adds the late piece', /E2E first[\s\S]*E2E late/.test(sql(`select plan from public.tasks where id = ${quote(improvement)}`)));
  // Discarded again: the next Improve takes in the feedback that comes next.
  for (let attempt = 0; attempt < 5 && !(await page.getByRole('menuitem', { name: 'Discard changes' }).isVisible()); attempt += 1) {
    await page.locator('[data-testid=improvement-detail]').getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Discard changes' }).waitFor({ timeout: 3000 }).catch(() => {});
  }
  await page.getByRole('menuitem', { name: 'Discard changes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await page.waitForSelector('[data-testid=improve-lesson]', { timeout: 15000 });

  // A diagram AI draws, saved on the group's copy for this group and the main course: the main
  // course's lesson shows the same image in its review, and binds it when it's saved.
  const diagramNote = await note('A CSRF token, sent with every form', 'E2E diagram: a diagram of how the token travels would help.');
  created.push(diagramNote);
  // The main course's lesson says a little more right where the notes go: what's added there waits
  // on its lesson for a look instead of going in by itself.
  const addAfter = (text, phrase, extra) => {
    const at = text.indexOf(phrase);
    if (at < 0) return text;
    const end = text.slice(at).search(/\r?\n\r?\n/);
    return end < 0 ? `${text}\n\n${extra}` : `${text.slice(0, at + end)}\n\n${extra}${text.slice(at + end)}`;
  };
  const courseMarkdown = sql(`select markdown_content from courses.lessons where id = ${quote(baseLessonId)}`);
  const drifted = addAfter(
    addAfter(courseMarkdown, 'A CSRF token, sent with every form', 'E2E course: the main course says more about tokens here.'),
    'Flask-Security-Too stores a',
    'E2E course: the main course says more about sessions here.'
  );
  check('the main course’s lesson differs where the notes go', drifted !== courseMarkdown);
  sql(`update courses.lessons set markdown_content = ${quote(drifted)} where id = ${quote(baseLessonId)}`);
  await page.goto(`${improveUrl}?i=${improvement}`);
  await page.click('[data-testid=improve-lesson]');
  check('the new note comes in with Improve this lesson', await waitFor(() => usedBy(diagramNote) === improvement, 30));
  await page.waitForSelector('[data-testid=apply-improvement]', { timeout: 60000 });
  check('the updated plan covers it', sql(`select plan from public.tasks where id = ${quote(improvement)}`).includes('E2E diagram'));
  check('the improvement goes to the group and the main course', /Scope: group and core/.test(sql(`select plan from public.tasks where id = ${quote(improvement)}`)));
  // Where it goes, chosen at Publish: the switch alone changes nothing yet.
  const scopeNow = () => sql(`select plan from public.tasks where id = ${quote(improvement)}`);
  await page.click('[data-testid=also-course]');
  check('switched off, the foot says so', (await page.locator('[data-testid=also-course]').getAttribute('aria-checked')) === 'false');
  await page.waitForTimeout(500);
  check('and the plan stays as it is until Publish', /Scope: group and core/.test(scopeNow()));
  await page.click('[data-testid=also-course]');
  check('switched on again', (await page.locator('[data-testid=also-course]').getAttribute('aria-checked')) === 'true');
  // Before Publish, the review tags what won't go into the main course by itself.
  const courseTags = await page.locator('[data-testid=course-tag]').count();
  const drawn = page.locator('[data-testid=lesson-part] img[src*="/admin/api/drafts/"]');
  check('the review shows the diagram AI drew', await drawn.first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.click('[data-testid=apply-improvement]');
  await page.locator('[data-testid=improvements-notice]').waitFor({ timeout: 30000 });
  const copyAsset = sql(`select coalesce(asset_id, '') from courses.lesson_asset_references where lesson_id = ${quote(lessonId)} and source_path like 'diagrams/%' limit 1`);
  check('saved on the copy, the diagram is stored and bound there', Boolean(copyAsset));
  const carriedDraft = sql(
    `select id from public.ai_proposals where target_id = ${quote(baseLessonId)} and status = 'OPEN' and task_id = ${quote(improvement)} order by updated_at desc limit 1`
  );
  check('the main course’s lesson gets the change, diagram and all', courseText().includes('diagrams/') || sql(`select coalesce(payload->>'markdown', '') from public.ai_proposals where id = ${quote(carriedDraft)}`).includes('diagrams/'));
  check('what differs a little there waits as a draft', Boolean(carriedDraft));
  check('as the review’s tags said before Publish', courseTags > 0, `${courseTags}`);
  check('and the improvement isn’t done while it waits', sql(`select status from public.tasks where id = ${quote(improvement)}`) !== 'DONE');
  const courseImproveUrl = `${BASE}/admin/courses/${courseId}/lessons/${baseLessonId}/improvements?draft=${carriedDraft}`;
  // A change placed where the text differs a little: tagged, and skipped until kept.
  const carriedMarkdown = sql(`select payload->>'markdown' from public.ai_proposals where id = ${quote(carriedDraft)}`);
  const check0 = sql(`select payload->'why'->'check' from public.ai_proposals where id = ${quote(carriedDraft)}`);
  await page.goto(`${BASE}/admin/courses/${courseId}/lessons/${baseLessonId}/improvements?i=${improvement}`);
  check('on the main course, the path shows where it came from', await page.locator('[data-testid=improvement-path]').waitFor({ timeout: 15000 }).then(async () => (await page.locator('[data-testid=improvement-path]').innerText()).includes('copy'), () => false));
  check('a change placed nearby is tagged', await page.locator('[data-testid=check-place]').first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('and starts skipped', (await page.locator('[data-testid=inline-change]', { has: page.locator('[data-testid=check-place]') }).first().getAttribute('data-decision')) === 'skip');
  check('feedback from the group’s copy comes along', (await page.locator('[data-testid=inline-change][data-current] [data-testid=change-answers]').count()) === 1);
  await page.screenshot({ path: 'tests/e2e/.shots/improve-course.png', fullPage: false });

  // One of the changes didn't make it into the draft: it can't be placed, and goes to AI from there.
  // The note on the session-cookie paragraph (the demo's own feedback there, or the test's).
  const unplacedBlock = carriedMarkdown.split(/\n{2,}/).find((block) => block.startsWith('> [!note]') && (block.includes('Learners mixed up') || block.includes('E2E second')));
  check('a note to take out of the draft', Boolean(unplacedBlock));
  const withoutIt = carriedMarkdown.replace(`${unplacedBlock}\n\n`, '');
  sql(`update public.ai_proposals set payload = jsonb_set(payload::jsonb, '{markdown}', ${quote(JSON.stringify(withoutIt))}::jsonb) where id = ${quote(carriedDraft)}`);
  const courseSteps = `${BASE}/admin/courses/${courseId}/lessons/${baseLessonId}/improvements?i=${improvement}`;
  await page.goto(courseSteps);
  const fit = page.locator('[data-testid=fit-with-ai]');
  check('what couldn’t be placed offers Fit it with AI', await fit.waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.screenshot({ path: 'tests/e2e/.shots/improve-couldnt-place.png', fullPage: false });
  // Stopped, the changes that were waiting are back.
  await fit.click();
  const fitStop = page.locator('[data-testid=changes-working]').getByRole('button', { name: 'Stop' });
  await fitStop.waitFor({ timeout: 15000 });
  await fitStop.click();
  check('stopped, the changes waiting come back', await page.locator('[data-testid=apply-improvement]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('still waiting in the database', sql(`select status from public.ai_proposals where id = ${quote(carriedDraft)}`) === 'OPEN');
  // Left to finish, it takes their place, still from the group's copy.
  await fit.click();
  await page.locator('[data-testid=changes-working]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid=apply-improvement]').waitFor({ timeout: 60000 });
  const fitted = sql(`select id from public.ai_proposals where target_id = ${quote(baseLessonId)} and status = 'OPEN' and task_id = ${quote(improvement)} order by created_at desc limit 1`);
  check('the fitted draft replaces the one waiting', Boolean(fitted) && fitted !== carriedDraft && (await waitFor(() => sql(`select status from public.ai_proposals where id = ${quote(carriedDraft)}`) === 'DISCARDED', 20)));
  check('and is still reviewed against the same lesson, from the same group', sql(`select (payload->'why'->'fromCopy' is not null and payload->>'base' = (select payload->>'base' from public.ai_proposals where id = ${quote(carriedDraft)}))::text from public.ai_proposals where id = ${quote(fitted)}`) === 'true');
  check('with the changes carried before it', sql(`select payload->>'markdown' from public.ai_proposals where id = ${quote(fitted)}`).includes('diagrams/'));
  await page.goto(courseSteps);
  await page.waitForSelector('[data-testid=apply-improvement]', { timeout: 30000 });
  const carriedImage = page.locator('[data-testid=lesson-part] img[src*="diagrams"], [data-testid=lesson-part] img[alt*="request travels"]').first();
  await carriedImage.waitFor({ timeout: 15000 }).catch(() => {});
  const shows = await carriedImage.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
  check('the main course’s review shows the copy’s image', shows);
  // Changes placed nearby start skipped: the reviewer keeps them, having looked.
  check('the carry itself says what to check', check0 !== '', check0);
  const toCheck = page.locator('[data-testid=inline-change]', { has: page.locator('[data-testid=check-place]') });
  for (let left = await toCheck.count(); left > 0; left = await toCheck.count()) {
    await toCheck.first().click();
    await page.click('[data-testid=review-keep]');
    await page.waitForTimeout(100);
  }
  await page.click('[data-testid=apply-improvement]');
  await page.locator('[data-testid=improvements-notice]').waitFor({ timeout: 30000 });
  const courseNotice = await page.locator('[data-testid=improvements-notice]').innerText();
  const courseAsset = sql(`select coalesce(asset_id, '') from courses.lesson_asset_references where lesson_id = ${quote(baseLessonId)} and source_path like 'diagrams/%' limit 1`);
  check('saved on the main course, its lesson binds the same image', Boolean(courseAsset) && courseAsset === copyAsset, `${courseAsset} vs ${copyAsset}; ${courseNotice}`);
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
