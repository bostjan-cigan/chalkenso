// Instructor links end to end: an instructor gets their own link to a group's learner pages from the
// group page; marks through it are instructor notes under their name for that group (never learner
// feedback); every instructor on the link sees the group's instructor notes and deletes only their
// own; private notes are their team notes; the link leaves the group's own link alone. A guest
// instructor (notes only) is invited for one group, sees only "Your groups" on Overview, reads the
// group's lessons in the team preview (with the group's instructor notes, never learner feedback,
// other groups, the course or the version's own pages), and loses the link with their access.
// Needs the demo seed and a server (yarn dev, or BASE_URL).
// node tests/e2e/e2e-instructor-links.mjs
import { chromium } from 'playwright-core';
import { BASE, env, serverEdition, sql, teamMemberAction } from './helpers.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const run = Date.now().toString(36);
const cloud = (await serverEdition()) === 'cloud';

const orgId = sql(`select o.id from public.organizations o join public.organization_members m on m.organization_id = o.id
  join public.users u on u.id = m.user_id where lower(u.email) = lower(${quote(env.DEMO_EMAIL)}) and m.role = 'OWNER' order by o.created_at limit 1`);
const ownerId = sql(`select id from public.users where lower(email) = lower(${quote(env.DEMO_EMAIL)})`);
const ownerName = sql(`select coalesce(nullif(concat_ws(' ', first_name, last_name), ''), identifier) from public.users where id = ${quote(ownerId)}`);
const courseId = sql(`select id from courses.courses where organization_id = ${quote(orgId)} and slug = 'web-development-ii'`);
// The Summer group reads the core curriculum: its version, and a published lesson in it.
const summerId = sql(`select id from courses.course_groups where course_id = ${quote(courseId)} and slug = 'summer-2026'`);
const coreVersionId = sql(`select curriculum_version_id from courses.course_groups where id = ${quote(summerId)}`);
const coreLessonId = sql(`select id from courses.lessons where curriculum_version_id = ${quote(coreVersionId)} and published_at is not null order by position limit 1`);
// Another group on the same core, and the Evening group with its own copy (and a lesson in it).
const springId = sql(`select id from courses.course_groups where course_id = ${quote(courseId)} and slug = 'spring-2026'`);
const eveningId = sql(`select id from courses.course_groups where course_id = ${quote(courseId)} and slug = 'evening-autumn-2026'`);
const eveningCopyId = sql(`select curriculum_version_id from courses.course_groups where id = ${quote(eveningId)}`);
const eveningLessonId = sql(`select id from courses.lessons where curriculum_version_id = ${quote(eveningCopyId)} order by position limit 1`);
if (!orgId || !courseId || !summerId || !coreLessonId || !springId || !eveningLessonId) {
  console.log('FAIL  demo organisation found (run yarn db:seed-demo)');
  process.exit(1);
}
const instructorToken = (userId) =>
  sql(`select token from courses.access_links where instructor_user_id = ${quote(userId)} and group_id = ${quote(summerId)}
    and revoked_at is null and expires_at > now() order by created_at desc limit 1`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const password = `E2e-${run}-password!`;
const guestEmail = `guest-${run}@example.com`;
const guestName = `Gita Guest ${run}`;
let guestUserId = '';
let step = 'start';
const pages = [];

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  pages.push(page);
  page.setDefaultTimeout(30000);
  page.on('dialog', (dialog) => dialog.accept());
  return page;
}
/** Opens a page and waits until it settles (it streams, and a guard's redirect can land late). */
async function settle(page, path) {
  await page.goto(BASE + path).catch(() => null);
  await page.waitForLoadState('networkidle').catch(() => {});
  let last = '';
  for (let i = 0; i < 20 && last !== page.url(); i += 1) {
    last = page.url();
    await page.waitForTimeout(500);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
}
const landsOn = async (page, path) => {
  await settle(page, path);
  return new URL(page.url()).pathname;
};
const pick = async (page, trigger, option) => {
  await page.locator(trigger).locator('visible=true').first().click();
  await page.locator('[role=option]:visible', { hasText: option }).first().click();
};
const post = (path, body) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const mark = (token, body) => post('/api/access/comment', { token, lessonId: coreLessonId, selectedText: 'e2e passage', context: null, body });
const marks = async (token) =>
  (await (await fetch(`${BASE}/api/access/comment?token=${encodeURIComponent(token)}&lessonId=${coreLessonId}`)).json()).comments ?? [];

try {
  const owner = await newPage();
  await owner.goto(`${BASE}/admin/login`);
  await owner.fill('#admin-identifier', env.DEMO_EMAIL);
  await owner.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([owner.waitForURL(/\/admin(\?|$)/), owner.click('button[type=submit]')]);

  // 1. The owner gets their instructor link from the group page.
  step = 'get the owner’s link';
  const groupLinkBefore = sql(`select coalesce(string_agg(id, ',' order by id), '') from courses.access_links where group_id = ${quote(summerId)}
    and instructor_user_id is null and member_id is null and revoked_at is null and expires_at > now()`);
  await settle(owner, `/admin/courses/groups/${summerId}?tab=people`);
  // A row that opens its sheet (as a version's Share a preview).
  await owner.locator('[data-testid=instructor-links-row]:visible').first().click();
  const panel = owner.locator('[role=dialog] [data-testid=instructor-links]');
  if (await owner.locator('[data-testid=instructor-link-create]').count()) {
    await owner.locator('[data-testid=instructor-link-create]').click();
  }
  await owner.locator('[data-testid=instructor-link-url]').waitFor();
  const ownerToken = instructorToken(ownerId);
  check('the group page makes your instructor link', Boolean(ownerToken) && (await panel.innerText()).includes(ownerToken));
  check(
    'it is bound to you and the group, and follows the group (no version, no learner)',
    sql(`select coalesce(member_id, '') || '|' || coalesce(curriculum_version_id, '') || '|' || is_preview from courses.access_links where token = ${quote(ownerToken)}`) === '||false'
  );
  check(
    "the group's own link is untouched",
    sql(`select coalesce(string_agg(id, ',' order by id), '') from courses.access_links where group_id = ${quote(summerId)}
      and instructor_user_id is null and member_id is null and revoked_at is null and expires_at > now()`) === groupLinkBefore
  );

  // 2. The learner page in instructor view, signed out.
  step = 'open the link signed out';
  const reader = await newPage();
  await settle(reader, `/l/course/${ownerToken}`);
  check('the link opens the learner pages in instructor view', (await reader.locator('body').innerText()).includes('Instructor view'));

  // 3. A mark through the link is an instructor note under their name, for the group.
  const ownerSays = `Owner ${run} ran long here`;
  const ownerPosted = await mark(ownerToken, ownerSays);
  check('a mark through the link is saved', ownerPosted.status === 201, String(ownerPosted.status));
  const stored = sql(`select coalesce(author_user_id, '') || '|' || coalesce(group_id, '') || '|' || coalesce(member_id, '') || '|' || coalesce(access_link_id, '') || '|' || proposer_name
    from courses.curriculum_comments where body = ${quote(ownerSays)}`);
  check('it is an instructor note: their account and name, the group, no learner', stored === `${ownerId}|${summerId}|||${ownerName}`, stored);

  // 4. Private notes through the link are their team notes.
  const noted = await post('/api/access/note', { token: ownerToken, lessonId: coreLessonId, selectedText: 'e2e passage', context: null, body: `Private ${run}` });
  check('private notes through the link are their team notes', noted.status === 201 &&
    sql(`select access_link_id from courses.lesson_notes where body = ${quote(`Private ${run}`)}`) === `team:${ownerId}`, String(noted.status));

  // 5. Never a learner.
  if (cloud) {
    const pulse = await (await post('/api/access/pulse', { token: ownerToken, lessonId: coreLessonId, answer: 'YES' })).json();
    check('the lesson question refuses an instructor link', pulse.code === 'instructor_link', JSON.stringify(pulse));
    const readingBefore = sql(`select count(*) from courses.lesson_reading_sessions`);
    const reading = await (await post('/api/access/reading', { token: ownerToken, lessonId: coreLessonId, sessionKey: `e2e${run}session0000`, activeSeconds: 30 })).json();
    check('reading statistics refuse an instructor link', reading.code === 'instructor_link' && sql(`select count(*) from courses.lesson_reading_sessions`) === readingBefore, JSON.stringify(reading));
  } else {
    console.log('SKIP  learner answers (cloud only)');
  }

  // 6. Invite a guest instructor for the Summer group (notes only).
  step = 'invite a guest instructor';
  await owner.goto(`${BASE}/admin/team`);
  await owner.locator('[data-testid=team-invite]').locator('visible=true').first().click();
  await owner.locator('#invite-label').locator('visible=true').first().fill(guestName);
  await owner.locator('[data-testid=access-limited]').first().click();
  await pick(owner, '#invite-access-scope', 'Chosen groups');
  await owner.locator('[data-testid=access-groups] label', { hasText: 'Summer group · 2026' }).first().click();
  await pick(owner, '#invite-access-lessons', 'Guest instructor');
  check('the editor sums up a guest instructor', (await owner.locator('[data-testid=access-summary]').first().innerText()).includes('guest instructor'));
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  await owner.waitForSelector('[data-testid=invite-link]');
  const inviteLink = (await owner.locator('[data-testid=invite-link]').innerText()).trim().replace(/^https?:\/\/[^/]+/, BASE);

  step = 'the guest signs up';
  const guest = await newPage();
  await guest.goto(inviteLink);
  check('the invite page says guest instructor', (await guest.locator('body').innerText()).includes('guest instructor'));
  await guest.fill('#invite-name', guestName);
  await guest.fill('#invite-email', guestEmail);
  await guest.fill('#invite-password', password);
  await Promise.all([guest.waitForURL(/\/admin/), guest.getByRole('button', { name: /Create account and join/ }).click()]);
  guestUserId = sql(`select id from public.users where email = ${quote(guestEmail)}`);
  check(
    'the invite gave notes on the group, nothing else',
    sql(`select entity_type || ':' || entity_id || ':' || array_to_string(permissions, ',') from public.user_grants where user_id = ${quote(guestUserId)} and organization_id = ${quote(orgId)}`) ===
      `group:${summerId}:NOTES`
  );

  step = 'the guest’s Overview';
  await settle(guest, '/admin');
  const guestOverview = guest.locator('[data-testid=guest-groups]');
  check('Overview lists their group', (await guestOverview.innerText().catch(() => '')).includes('Summer group'));
  const previewHref = await guestOverview.locator('[data-testid=guest-preview]').first().getAttribute('href').catch(() => null);
  const summerPreview = `/admin/courses/${courseId}/versions/${coreVersionId}/preview?group=${summerId}`;
  check("Overview links the team preview of their group's lessons", previewHref === summerPreview, String(previewHref));
  check('no Courses or Tasks in their menu', (await guest.locator('nav a[href="/admin/courses"], nav a[href="/admin/tasks"]').count()) === 0);
  check('the group page is out of reach', !(await landsOn(guest, `/admin/courses/groups/${summerId}`)).includes(summerId));

  // 6b. The team preview of the lessons their group reads: the lessons and the group's instructor
  // notes, never learner feedback or another group's notes.
  step = 'the guest’s preview';
  const learnerSays = `Learner ${run} got lost here`;
  const springNoteSays = `Spring ${run} instructor note`;
  sql(`insert into courses.curriculum_comments (id, curriculum_version_id, lesson_id, group_id, proposer_name, selected_text, body, updated_at)
       values ('e2e-learner-${run}', ${quote(coreVersionId)}, ${quote(coreLessonId)}, ${quote(summerId)}, 'A learner · Summer', 'e2e passage', ${quote(learnerSays)}, now())`);
  sql(`insert into courses.curriculum_comments (id, curriculum_version_id, lesson_id, group_id, author_user_id, is_instructor_note, proposer_name, selected_text, body, updated_at)
       values ('e2e-spring-note-${run}', ${quote(coreVersionId)}, ${quote(coreLessonId)}, ${quote(springId)}, ${quote(ownerId)}, true, ${quote(ownerName)}, 'e2e passage', ${quote(springNoteSays)}, now())`);
  const previewLanding = await landsOn(guest, summerPreview);
  const previewText = await guest.locator('body').innerText();
  check('the guest opens the preview of their group’s lessons', previewLanding.endsWith('/preview') && previewText.includes('Team preview for Summer group'), previewLanding);
  check('its way back is Home, not the group page', (await guest.getByRole('link', { name: /Back to Home/ }).count()) === 1);
  const lesson = await guest.request.post(`${BASE}/admin/api/version-lesson`, { data: { courseId, versionId: coreVersionId, lessonId: coreLessonId } });
  check('the lessons load', lesson.status() === 200 && Boolean((await lesson.json()).lesson?.html), String(lesson.status()));
  const guestPreviewSays = `Guest ${run} preview note`;
  const previewNote = await guest.request.post(`${BASE}/api/team/comment`, {
    data: { lessonId: coreLessonId, selectedText: 'e2e passage', context: null, body: guestPreviewSays, token: `group:${summerId}` },
  });
  check(
    'a note in the preview is an instructor note for their group',
    previewNote.status() === 201 &&
      sql(`select author_user_id || '|' || group_id from courses.curriculum_comments where body = ${quote(guestPreviewSays)}`) === `${guestUserId}|${summerId}`,
    String(previewNote.status())
  );
  const margin = (await (await guest.request.get(`${BASE}/api/team/comment?lessonId=${coreLessonId}`)).json()).comments ?? [];
  const marginBodies = margin.map((comment) => comment.body);
  check("the preview shows the group's instructor notes", marginBodies.includes(ownerSays) && marginBodies.includes(guestPreviewSays), marginBodies.join(' | '));
  check(
    "learner feedback and other groups' notes stay out of reach",
    margin.every((comment) => comment.isNote) && !marginBodies.includes(learnerSays) && !marginBodies.includes(springNoteSays),
    marginBodies.join(' | ')
  );
  const previewPrivate = await guest.request.post(`${BASE}/api/team/note`, {
    data: { lessonId: coreLessonId, selectedText: 'e2e passage', context: null, body: `Guest private ${run}` },
  });
  check(
    'private notes in the preview are their team notes',
    previewPrivate.status() === 201 && sql(`select access_link_id from courses.lesson_notes where body = ${quote(`Guest private ${run}`)}`) === `team:${guestUserId}`,
    String(previewPrivate.status())
  );
  const previewNoteId = margin.find((comment) => comment.body === guestPreviewSays)?.id ?? '';
  const deletedInPreview = await guest.request.delete(`${BASE}/api/team/comment?commentId=${encodeURIComponent(previewNoteId)}`);
  check('they delete their own note in the preview', deletedInPreview.status() === 200 && sql(`select count(*) from courses.curriculum_comments where body = ${quote(guestPreviewSays)}`) === '0');

  // 6c. Nothing else: other groups, the course and the version's own pages stay closed.
  step = 'what the guest still can’t open';
  const springNote = await guest.request.post(`${BASE}/api/team/comment`, {
    data: { lessonId: coreLessonId, selectedText: 'e2e passage', context: null, body: `Guest ${run} for Spring`, token: `group:${springId}` },
  });
  check('no notes for another group', springNote.status() === 403, String(springNote.status()));
  await settle(guest, `/admin/courses/${courseId}/versions/${coreVersionId}/preview?group=${springId}`);
  check("another group's name stays out of the preview", !(await guest.locator('body').innerText()).includes('Spring group'));
  check('other groups are out of reach', !(await landsOn(guest, `/admin/courses/groups/${springId}`)).includes(springId));
  check("another group's own copy is out of reach", !(await landsOn(guest, `/admin/courses/${courseId}/versions/${eveningCopyId}/preview?group=${eveningId}`)).includes(courseId));
  const otherLesson = await guest.request.post(`${BASE}/admin/api/version-lesson`, { data: { courseId, versionId: eveningCopyId, lessonId: eveningLessonId } });
  check("another group's lessons don't load", otherLesson.status() === 401, String(otherLesson.status()));
  check('the course is out of reach', !(await landsOn(guest, `/admin/courses/${courseId}`)).includes(courseId));
  check("the version's own page is out of reach", !(await landsOn(guest, `/admin/courses/${courseId}/versions/${coreVersionId}`)).includes(courseId));
  check("a lesson's own page is out of reach", !(await landsOn(guest, `/admin/courses/${courseId}/lessons/${coreLessonId}`)).includes(courseId));
  check('the feedback board is out of reach', !(await landsOn(guest, '/admin/courses/comments')).startsWith('/admin/courses'));
  const guestExports = await Promise.all([
    guest.request.get(`${BASE}/admin/api/feedback-export?group=${summerId}`),
    guest.request.get(`${BASE}/admin/api/feedback-export?course=${courseId}`),
  ]);
  check('no feedback export, not even their group’s', guestExports.every((response) => response.status() === 401), guestExports.map((response) => response.status()).join(','));
  await settle(guest, '/admin');
  await guest.locator('[data-testid=guest-groups] [data-testid=instructor-link-create]').first().click();
  await guest.locator('[data-testid=guest-groups] [data-testid=instructor-link-url]').first().waitFor();
  const guestToken = instructorToken(guestUserId);
  check('Overview makes their instructor link', Boolean(guestToken));

  // 7. Two instructors on one group: both see the notes, each deletes only their own.
  const guestSays = `Guest ${run} saw confusion`;
  check('a guest adds a note through their link', (await mark(guestToken, guestSays)).status === 201);
  const seen = await marks(guestToken);
  const ownerNote = seen.find((comment) => comment.body === ownerSays);
  const guestNote = seen.find((comment) => comment.body === guestSays);
  check(
    "they see every instructor's notes for the group, named, their own marked",
    ownerNote?.author === ownerName && ownerNote?.mine === false && guestNote?.mine === true && guestNote?.author === null,
    JSON.stringify(seen.map(({ body, author, mine }) => ({ body, author, mine })))
  );
  check('learner feedback is not on the instructor link', seen.every((comment) => comment.mine || comment.author));
  const deleteOther = await fetch(`${BASE}/api/access/comment?token=${encodeURIComponent(guestToken)}&commentId=${ownerNote?.id}`, { method: 'DELETE' });
  check("they can't delete another instructor's note", deleteOther.status === 404 && sql(`select count(*) from courses.curriculum_comments where body = ${quote(ownerSays)}`) === '1');
  const deleteOwn = await fetch(`${BASE}/api/access/comment?token=${encodeURIComponent(guestToken)}&commentId=${guestNote?.id}`, { method: 'DELETE' });
  check('they delete their own', deleteOwn.status === 200 && sql(`select count(*) from courses.curriculum_comments where body = ${quote(guestSays)}`) === '0');

  // 8. The group page lists who has a link, for the people who manage it.
  await settle(owner, `/admin/courses/groups/${summerId}?tab=people`);
  check('its row counts the links', /\d+ links?/.test(await owner.locator('[data-testid=instructor-links-row]:visible').first().innerText()));
  await owner.locator('[data-testid=instructor-links-row]:visible').first().click();
  await owner.locator('[role=dialog] [data-testid=instructor-links]').waitFor();
  check('the group page lists the instructors with a link', (await owner.locator('[data-testid=instructor-link-row]:visible', { hasText: guestName }).count()) === 1);

  // 9. Losing access ends the link at once.
  step = 'take the guest’s access away';
  sql(`delete from public.user_grants where user_id = ${quote(guestUserId)} and organization_id = ${quote(orgId)}`);
  const afterLoss = await mark(guestToken, `After ${run}`);
  check('without access, the link takes no notes', afterLoss.status === 403, String(afterLoss.status));
  await settle(reader, `/l/course/${guestToken}`);
  check('and reads as revoked', (await reader.locator('body').innerText()).includes('Access revoked'));

  // 10. Removing them from the team revokes their links outright.
  step = 'remove the guest';
  await owner.goto(`${BASE}/admin/team`);
  await teamMemberAction(owner, guestName, 'Remove from the team…', 'Remove');
  await owner.waitForTimeout(1500);
  check(
    'removing them revokes their instructor links',
    sql(`select count(*) from courses.access_links where instructor_user_id = ${quote(guestUserId)} and revoked_at is null`) === '0'
  );
} catch (error) {
  check(`unexpected error (at: ${step})`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `tests/e2e/.shots/instructor-links-fail-${index}.png` }).catch(() => {});
} finally {
  sql(`delete from courses.curriculum_comments where body like ${quote(`%${run}%`)}`);
  sql(`delete from courses.lesson_notes where body like ${quote(`%${run}%`)}`);
  sql(`update courses.access_links set revoked_at = now() where instructor_user_id = ${quote(ownerId)} and group_id = ${quote(summerId)} and revoked_at is null`);
  if (guestUserId) {
    sql(`delete from public.users where id = ${quote(guestUserId)}`);
  }
  await browser.close();
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
}
