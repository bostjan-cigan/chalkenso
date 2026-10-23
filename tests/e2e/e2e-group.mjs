// A group end to end: creating one with only its lessons, name and roster (the rest is in Settings); links for all its learners, copied in one go; a
// learner's feedback following them to a new link, and feedback from a learner who left moved to one
// on the roster;
// the group page hydrating without warnings; its feedback (and the course's) exported as CSV, with
// learners never named and formula-looking cells kept as text; its Settings, rows that open a sheet
// for each part, saved on its own.
// node tests/e2e/e2e-group.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { BASE, env, sql } from './helpers.mjs';
mkdirSync('tests/e2e/.shots', { recursive: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const run = Date.now().toString(36);

const orgId = sql(`select o.id from public.organizations o join public.organization_members m on m.organization_id = o.id
  join public.users u on u.id = m.user_id where lower(u.email) = lower(${quote(env.DEMO_EMAIL)}) and m.role = 'OWNER' order by o.created_at limit 1`);
const courseId = sql(`select id from courses.courses where organization_id = ${quote(orgId)} and slug = 'web-development-ii'`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const hydrationErrors = [];
// React reports a hydration mismatch as a page error (and some as console errors).
page.on('pageerror', (error) => {
  if (/hydrat/i.test(String(error))) hydrationErrors.push(String(error).slice(0, 200));
});
page.on('console', (message) => {
  if (message.type() === 'error' && /hydrat/i.test(message.text())) hydrationErrors.push(message.text().slice(0, 200));
});
let groupId = '';
let step = 'start';
try {
  await page.goto(BASE + '/admin/login');
  await page.fill('#admin-identifier', env.DEMO_EMAIL);
  await page.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin(\?|$)/), page.click('button[type=submit]')]);

  // 1. A group with only what it needs to start: its lessons, its name and its learners.
  step = 'create the group';
  await page.goto(BASE + '/admin/courses/groups/new');
  check(
    'the new-group form asks only for the lessons, a name and the learners (the rest is in Settings)',
    (await page.locator('main #group-slack-handle, main #group-starts-at, main #group-ends-at, main #group-description, main #group-partners').count()) === 0 &&
      (await page.locator('main #group-roster:visible').count()) === 1
  );
  // The page's own dropdowns (the sidebar has the language menu).
  const pickers = page.locator('main button[aria-haspopup=listbox]:visible');
  await pickers.nth(0).click();
  await page.locator('[role=option]:visible', { hasText: 'Web Development II' }).first().click();
  await page.waitForTimeout(400);
  await pickers.nth(1).click();
  await page.locator('[role=option]:visible', { hasText: 'v1' }).first().click();
  await page.fill('#group-name', 'Weekend group');
  const quietSlug = page.locator('[data-testid=group-slug-quiet]:visible');
  check(
    'its short name follows the name quietly, under it',
    (await page.locator('main #group-slug').count()) === 0 && (await quietSlug.innerText()).includes('Short name: weekend-group'),
    await quietSlug.innerText()
  );
  await quietSlug.getByRole('button', { name: 'Change' }).click();
  check('Change opens the short name, to edit', (await page.locator('main #group-slug:visible').inputValue()) === 'weekend-group');
  await page.locator('#group-roster:visible').fill('Ana Learner\nBor Learner');
  await Promise.all([page.waitForURL(/\/admin\/courses\/groups\/(?!new)[^/?]+/), page.locator('button[type=submit]:visible').last().click()]);
  groupId = new URL(page.url()).pathname.split('/').pop() ?? '';
  check('group created', Boolean(groupId), page.url());
  check('group page shows the group', (await page.locator('body').innerText()).includes('Weekend group'));
  const started = sql(`select (starts_at is null and ends_at is null and description is null and slack_handle is null)::text || '|' ||
    (select count(*) from courses.course_group_partners where group_id = g.id) from courses.course_groups g where id = ${quote(groupId)}`);
  check('it starts undated, without a description, Slack or partners', started === 'true|0', started);
  const toSettings = page.locator('p', { hasText: 'Group created. Add its dates, description and more in' }).getByRole('link', { name: 'Settings' });
  check('the notice points to Settings for the rest', (await toSettings.getAttribute('href')) === `/admin/courses/groups/${groupId}?tab=settings`);

  // 2. Links for all learners, then every link copied at once (the cards follow the new links).
  step = 'learner links';
  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=people`);
  await page.getByRole('button', { name: 'Make links for all learners' }).click();
  await page.getByRole('button', { name: 'Create all links' }).click();
  await page.getByRole('heading', { name: 'Links created' }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-testid=copy-all-links]').click();
  await page.locator('[data-testid=copy-all-links-hint]').waitFor();
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).trim().split('\n');
  const active = sql(`select string_agg(m.full_name || ' ' || l.token, ',' order by m.position) from courses.access_links l
    join courses.course_group_members m on m.id = l.member_id where m.group_id = ${quote(groupId)} and l.revoked_at is null and l.expires_at > now()`).split(',');
  check(
    "Copy all links copies every learner's current link, with their name",
    copied.length === 2 &&
      active.length === 2 &&
      active.every((entry, index) => {
        const [first, last, token] = entry.split(' ');
        return copied[index].startsWith(`${index + 1}. ${first} ${last}: `) && copied[index].endsWith(`/l/course/${token}`);
      }),
    copied.join(' | ')
  );

  // 2b. A learner's feedback follows her to a link made again for her.
  step = 'feedback follows the learner';
  const linkOf = (name) =>
    sql(`select l.id || ' ' || l.token from courses.access_links l join courses.course_group_members m on m.id = l.member_id
      where m.group_id = ${quote(groupId)} and m.full_name = ${quote(name)} and l.revoked_at is null and l.expires_at > now() order by l.created_at desc limit 1`).split(' ');
  const memberOf = (name) => sql(`select id from courses.course_group_members where group_id = ${quote(groupId)} and full_name = ${quote(name)}`);
  const post = (body) => fetch(`${BASE}/api/access/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const listed = async (token, lessonId) => ((await (await fetch(`${BASE}/api/access/comment?token=${encodeURIComponent(token)}&lessonId=${lessonId}`)).json()).comments ?? []).map((comment) => comment.body);
  const [anaLinkId, anaToken] = linkOf('Ana Learner');
  const [borFirstLinkId] = linkOf('Bor Learner');
  const linkVersion = sql(`select curriculum_version_id from courses.access_links where id = ${quote(anaLinkId)}`);
  const lessonForLearners = sql(`select id from courses.lessons where curriculum_version_id = ${quote(linkVersion)} and published_at is not null order by position limit 1`);
  const anaSays = `Ana ${run} got lost here`;
  const posted = await post({ token: anaToken, lessonId: lessonForLearners, selectedText: 'e2e passage', context: null, body: anaSays });
  check('a learner leaves feedback through her link', posted.status === 201, String(posted.status));
  step = 'make links again: open';
  await page.getByRole('button', { name: 'Make links for all learners' }).click();
  step = 'make links again: create';
  await page.getByRole('button', { name: 'Create all links' }).click();
  step = 'make links again: created';
  await page.getByRole('heading', { name: 'Links created' }).waitFor();
  step = 'make links again: close';
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const [anaNewLinkId, anaNewToken] = linkOf('Ana Learner');
  check(
    'making links again moves her feedback onto her new link',
    anaNewLinkId !== anaLinkId && sql(`select access_link_id from courses.curriculum_comments where body = ${quote(anaSays)}`) === anaNewLinkId
  );
  check('and her new link shows it', (await listed(anaNewToken, lessonForLearners)).includes(anaSays));
  // Links made again before feedback moved with them: what she wrote from an earlier link shows too.
  sql(`update courses.curriculum_comments set access_link_id = ${quote(anaLinkId)} where body = ${quote(anaSays)}`);
  check('feedback from an earlier link of hers shows on the new one', (await listed(anaNewToken, lessonForLearners)).includes(anaSays));

  // 2c. Feedback from a learner no longer on the roster is moved to one on it, and shows on their link.
  step = 'move feedback';
  const formerSays = `Former ${run} learner was confused`;
  sql(`insert into courses.curriculum_comments (id, curriculum_version_id, lesson_id, group_id, access_link_id, proposer_name, selected_text, body, updated_at)
       values ('e2e-former-${run}', ${quote(linkVersion)}, ${quote(lessonForLearners)}, ${quote(groupId)}, ${quote(borFirstLinkId)}, 'A learner · Weekend group', 'e2e passage', ${quote(formerSays)}, now())`);
  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=people`);
  await page.waitForLoadState('networkidle').catch(() => {});
  check('the People tab says feedback waits for a learner', (await page.locator('[data-testid=unattached-feedback]').innerText()).includes('1 piece of feedback'));
  await page.locator('[data-testid=move-feedback]').click();
  const dialog = page.locator('[role=dialog]:visible');
  await dialog.locator('button[aria-haspopup=listbox]').first().click();
  await page.locator('[role=option]:visible', { hasText: 'Bor Learner' }).first().click();
  await dialog.locator('[data-testid=move-feedback-confirm]').click();
  await page.locator('[data-testid=unattached-feedback]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  const [borLinkId, borToken] = linkOf('Bor Learner');
  check(
    'it moves to the learner chosen, onto their link',
    sql(`select member_id || ' ' || access_link_id from courses.curriculum_comments where body = ${quote(formerSays)}`) === `${memberOf('Bor Learner')} ${borLinkId}`
  );
  check('and shows on their link', (await listed(borToken, lessonForLearners)).includes(formerSays));
  check('the People tab no longer asks', (await page.locator('[data-testid=unattached-feedback]').count()) === 0);

  // 3. The group link: a row that opens its sheet (as a version's Share a preview); with one made,
  // the group page hydrates without warnings.
  step = 'group link';
  const groupLinkRow = page.locator('[data-testid=group-link-row]:visible').first();
  check('the group link row says there is none yet', (await groupLinkRow.innerText()).includes('None'));
  await groupLinkRow.click();
  await page.getByRole('button', { name: 'Create group link' }).click();
  await page.getByRole('button', { name: 'Create link', exact: true }).click();
  await page.waitForTimeout(1500);
  check('its sheet shows the new link', (await page.locator('[role=dialog]').first().innerText()).includes('/l/course/'));
  hydrationErrors.length = 0;
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const groupLinkShown = /Until /.test(await page.locator('[data-testid=group-link-row]:visible').first().innerText());
  check('the group page hydrates without warnings (its row says until when)', groupLinkShown && hydrationErrors.length === 0, hydrationErrors[0] ?? (groupLinkShown ? '' : 'no group link'));

  // 4. Feedback as CSV: the group's, then the course's.
  step = 'export';
  const versionId = sql(`select curriculum_version_id from courses.course_groups where id = ${quote(groupId)}`);
  const lessonId = sql(`select id from courses.lessons where curriculum_version_id = ${quote(versionId)} order by position limit 1`);
  const formula = `=HYPERLINK("https://example.com") ${run}`;
  sql(`insert into courses.curriculum_comments (id, curriculum_version_id, lesson_id, group_id, proposer_name, selected_text, body, updated_at)
       values ('e2e-export-${run}', ${quote(versionId)}, ${quote(lessonId)}, ${quote(groupId)}, 'A learner · Weekend group', 'e2e passage', ${quote(formula)}, now())`);
  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=feedback`);
  // The page streams in: until it settles, a streamed copy can still sit hidden beside the shown one.
  await page.waitForLoadState('networkidle').catch(() => {});
  const button = page.locator('[data-testid=feedback-export]');
  check(
    'the Feedback tab offers the export as a download',
    (await button.getAttribute('href')) === `/admin/api/feedback-export?group=${groupId}` && (await button.getAttribute('download')) !== null
  );
  const groupCsv = await page.request.get(`${BASE}/admin/api/feedback-export?group=${groupId}`);
  const groupText = await groupCsv.text();
  check(
    "the group's feedback comes as a CSV file",
    groupCsv.status() === 200 &&
      (groupCsv.headers()['content-type'] ?? '').startsWith('text/csv') &&
      (groupCsv.headers()['content-disposition'] ?? '').includes('filename="feedback-weekend-group-') &&
      groupText.replace(/^﻿/, '').startsWith('Date,Course,Lessons,Lesson,Group,From,Kind,Passage,Feedback,Status'),
    `${groupCsv.status()} ${groupCsv.headers()['content-disposition'] ?? ''}`
  );
  const groupLines = groupText.trim().split('\r\n');
  check("it holds the group's feedback only", groupLines.length >= 2 && groupLines.slice(1).every((line) => line.includes('Weekend group')), String(groupLines.length));
  check('a cell that would run as a formula stays text', groupText.includes(`"'=HYPERLINK(""https://example.com"") ${run}"`));
  const courseCsv = await page.request.get(`${BASE}/admin/api/feedback-export?course=${courseId}`);
  const courseText = await courseCsv.text();
  const learnerNames = sql(`select string_agg(m.full_name, '|') from courses.course_group_members m join courses.course_groups g on g.id = m.group_id where g.course_id = ${quote(courseId)}`)
    .split('|')
    .filter(Boolean);
  check(
    "the course's export has every group's feedback and the team's notes",
    courseCsv.status() === 200 && courseText.includes(`${run}`) && courseText.includes(',Note,') && courseText.includes('Evening group'),
    String(courseCsv.status())
  );
  check('learners are never named in it', learnerNames.length > 0 && learnerNames.every((name) => !courseText.includes(name)));
  const ownOnly = await (await page.request.get(`${BASE}/admin/api/feedback-export?course=${courseId}&group=course`)).text();
  check("the course's own lessons only, when filtered so", !ownOnly.includes('Weekend group') && !ownOnly.includes('Evening group'));

  // 5. Settings, as a course's: rows with their value, each opening a sheet that saves its part only.
  step = 'settings';
  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=settings`);
  // The page streams in: until it settles, a streamed copy can still sit hidden beside the shown one.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('[data-testid=group-details]:visible').first().waitFor();
  const sheet = page.locator('[role=dialog]');
  const openSheet = async (row) => {
    await page.locator(`[data-testid=${row}]:visible`).first().click();
    await sheet.waitFor();
  };
  // Save is in the sheet's header, and closes it once saved; a refused save keeps it open, saying why.
  const saveSheet = async () => {
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await sheet.waitFor({ state: 'detached' });
  };
  const refusedSheet = async (says) => {
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await sheet.getByText(says).waitFor();
  };
  const groupRow = (columns) => sql(`select ${columns} from courses.course_groups where id = ${quote(groupId)}`);
  const learnerCount = () => sql(`select count(*) from courses.course_group_members where group_id = ${quote(groupId)}`);
  const settingsText = await page.locator('main').first().innerText();
  check(
    "Settings groups its rows: Group · Dates · Learners · The group's lessons · Delete group",
    /Group[\s\S]*Dates[\s\S]*Learners[\s\S]*The group’s lessons[\s\S]*Delete group/.test(settingsText),
    settingsText.replace(/\s+/g, ' ')
  );
  check(
    'a group with its own copy shows its lessons, with nothing to change there',
    (await page.locator('[data-testid=group-lessons-row]:visible').first().evaluate((row) => row.tagName)) === 'DIV' &&
      (await page.locator('[data-testid=group-lessons-row]:visible').first().innerText()).includes('Own copy of'),
  );

  await openSheet('group-name-row');
  await sheet.locator('#group-name').fill(`Weekend group ${run}`);
  await saveSheet();
  check('the Name sheet renames the group, its short name following', groupRow(`name || '|' || slug`) === `Weekend group ${run}|weekend-group-${run}`, groupRow(`name || '|' || slug`));
  check('…its row shows the new name', (await page.locator('[data-testid=group-name-row]:visible').first().innerText()).includes(`Weekend group ${run}`));
  check('…and so does its copy of the lessons', sql(`select label from courses.curriculum_versions where owner_group_id = ${quote(groupId)}`) === `Weekend group ${run}`);
  check('saving one part keeps the rest (its learners)', learnerCount() === '2', learnerCount());

  await openSheet('group-description-row');
  await sheet.locator('#group-description').fill(`Saturdays ${run}`);
  await saveSheet();
  check('the Description sheet saves the description only', groupRow(`description || '|' || name`) === `Saturdays ${run}|Weekend group ${run}`);

  await openSheet('group-starts-row');
  check('a group without a start date opens with the date off', (await sheet.locator('[data-testid=group-starts-at-switch]').getAttribute('aria-checked')) === 'false');
  await sheet.locator('[data-testid=group-starts-at-switch]').click();
  await saveSheet();
  check('turning the date on and saving sets when it starts', groupRow(`(starts_at is not null)::text || '|' || (ends_at is null)::text`) === 'true|true');
  // The row follows once the page has refreshed after the save.
  await page.locator('[data-testid=group-starts-row]:visible', { hasNotText: 'None' }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const startsRow = await page.locator('[data-testid=group-starts-row]:visible').first().innerText();
  check('its row says the date', !startsRow.includes('None'), startsRow.replace(/\s+/g, ' '));
  await openSheet('group-ends-row');
  await sheet.locator('[data-testid=group-ends-at-switch]').click();
  await sheet.getByRole('button', { name: 'Previous month' }).click();
  await sheet.getByRole('button', { name: '1', exact: true }).click();
  await refusedSheet('End date must be on or after the start date.');
  check('an end before the start is refused, in the sheet', groupRow(`(ends_at is null)::text`) === 'true');
  // Cancel with a change asks first; Discard closes it as it was.
  await sheet.first().getByRole('button', { name: 'Cancel', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard your changes?' });
  await discard.waitFor();
  check('Cancel after a change asks before discarding it', (await discard.innerText()).includes('Keep editing'));
  await discard.getByRole('button', { name: 'Discard changes' }).click();
  await sheet.first().waitFor({ state: 'detached' });

  await openSheet('group-roster-row');
  await sheet.locator('#group-roster').fill('Ana Learner\nBor Learner\nCene Learner');
  await saveSheet();
  check('the Learners sheet saves the roster', learnerCount() === '3', learnerCount());
  check('…and its row counts them', (await page.locator('[data-testid=group-roster-row]:visible').first().innerText()).includes('3 learners'));

  // Its copy's actions and Delete are rows too, and ask first.
  check(
    'an own copy offers Close and, in red, the course’s lessons instead',
    (await page.locator('[data-testid=group-copy-close]:visible').count()) === 1 && (await page.locator('[data-testid=group-copy-use-course]:visible').count()) === 1
  );
  await page.locator('[data-testid=group-delete]:visible').first().click();
  const deleteDialog = page.locator('[role=dialog]').filter({ hasText: 'Delete this group?' });
  await deleteDialog.waitFor();
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  await deleteDialog.waitFor({ state: 'detached' });
  check('Delete group asks first, and Cancel keeps the group', groupRow('count(*)') === '1');
} catch (error) {
  check(`unexpected error (at: ${step})`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  await page.screenshot({ path: 'tests/e2e/.shots/group-fail.png', fullPage: true }).catch(() => {});
} finally {
  sql(`delete from courses.curriculum_comments where id = ${quote(`e2e-export-${run}`)} or body like ${quote(`%${run}%`)}`);
  // An undated group runs all the time: leave none behind, or the demo's classes at a time fill up.
  if (groupId) sql(`delete from courses.course_groups where id = ${quote(groupId)}`);
  await browser.close();
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
}
