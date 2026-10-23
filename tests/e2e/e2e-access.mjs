// Member access end to end: owners and admins always see everything; a member limited to a course
// sees and edits only it; an instructor of one group (that reads the core curriculum) reads its
// lessons and works on its learners' feedback only; feedback off means read only; a course of
// another organisation can't be granted; access is per organisation (not in the local edition, which
// runs one organisation); and losing the last group leaves nothing, never everything. Needs the demo
// seed and a server (yarn dev, or BASE_URL).
// node tests/e2e/e2e-access.mjs
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
const courseId = sql(`select id from courses.courses where organization_id = ${quote(orgId)} and slug = 'web-development-ii'`);
const otherCourseId = sql(`select id from courses.courses where organization_id = ${quote(orgId)} and id <> ${quote(courseId)} order by created_at limit 1`);
const otherTitle = sql(`select title from courses.courses where id = ${quote(otherCourseId)}`);
// The Summer group reads the core curriculum: its version, and a published lesson in it.
const summerId = sql(`select id from courses.course_groups where course_id = ${quote(courseId)} and slug = 'summer-2026'`);
const springId = sql(`select id from courses.course_groups where course_id = ${quote(courseId)} and slug = 'spring-2026'`);
const coreVersionId = sql(`select curriculum_version_id from courses.course_groups where id = ${quote(summerId)}`);
const coreLessonId = sql(`select id from courses.lessons where curriculum_version_id = ${quote(coreVersionId)} and published_at is not null order by position limit 1`);
const linkFor = (slug) =>
  sql(`select l.token from courses.access_links l join courses.course_groups g on g.id = l.group_id
    where g.slug = ${quote(slug)} and g.course_id = ${quote(courseId)} and l.member_id is not null and l.revoked_at is null and l.expires_at > now()
      and l.curriculum_version_id = ${quote(coreVersionId)} order by l.id limit 1`);
if (!orgId || !courseId || !otherCourseId || !coreLessonId || !summerId) {
  console.log('FAIL  demo organisation found (run yarn db:seed-demo)');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const password = `E2e-${run}-password!`;
const memberEmail = `access-${run}@example.com`;
const memberName = `Ivo Access ${run}`;
const orgB = `e2e-org-b-${run}`;
let memberId = '';
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
/** Where a page ends up. */
async function landsOn(page, path) {
  await settle(page, path);
  return new URL(page.url()).pathname;
}
const text = async (page) => (await page.locator('main:visible').innerText().catch(() => '')) || '';
const pick = async (page, trigger, option) => {
  await page.locator(trigger).locator('visible=true').first().click();
  await page.locator('[role=option]:visible', { hasText: option }).first().click();
};

try {
  const owner = await newPage();
  await owner.goto(`${BASE}/admin/login`);
  await owner.fill('#admin-identifier', env.DEMO_EMAIL);
  await owner.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([owner.waitForURL(/\/admin(\?|$)/), owner.click('button[type=submit]')]);

  // 1. Owners keep everything, whatever rules they have.
  sql(`insert into public.user_grants (id, user_id, organization_id, entity_type, entity_id, permissions, created_at, updated_at)
       values ('e2e-owner-${run}', ${quote(ownerId)}, ${quote(orgId)}, 'course', ${quote(courseId)}, '{READ}', now(), now())`);
  await settle(owner, '/admin/courses');
  const ownerCourses = await text(owner);
  check('an owner sees every course, whatever rules they have', ownerCourses.includes(otherTitle));
  if (!ownerCourses.includes(otherTitle)) console.log(`      expected "${otherTitle}" on ${owner.url()}: ${ownerCourses.slice(0, 200).replace(/\s+/g, ' ')}`);
  sql(`delete from public.user_grants where id = 'e2e-owner-${run}'`);

  // 2. Invite a member limited to Web Development II (through the Team page).
  await owner.goto(`${BASE}/admin/team`);
  // Invite opens its sheet from the members' card.
  await owner.locator('[data-testid=team-invite]').locator('visible=true').first().click();
  await owner.locator('#invite-label').locator('visible=true').first().fill(memberName);
  await owner.locator('[data-testid=access-limited]').first().click();
  await owner.locator('[data-testid=access-courses] label', { hasText: 'Web Development II' }).first().click();
  check('the editor sums up the access', (await owner.locator('[data-testid=access-summary]').first().innerText()).includes('Web Development II · edits lessons'));
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  await owner.waitForSelector('[data-testid=invite-link]');
  const inviteLink = (await owner.locator('[data-testid=invite-link]').innerText()).trim().replace(/^https?:\/\/[^/]+/, BASE);
  // The pending invites refresh just after the link appears.
  const pendingShown = await owner
    .waitForFunction(() => document.querySelector('main')?.innerText.includes('Web Development II · edits lessons'), null, { timeout: 15000 })
    .then(() => true, () => false);
  check('the pending invite shows its access', pendingShown);

  const member = await newPage();
  await member.goto(inviteLink);
  check('the invite page says what they will reach', (await member.locator('body').innerText()).includes('for Web Development II'));
  await member.fill('#invite-name', memberName);
  await member.fill('#invite-email', memberEmail);
  await member.fill('#invite-password', password);
  await Promise.all([member.waitForURL(/\/admin/), member.getByRole('button', { name: /Create account and join/ }).click()]);
  const memberUserId = sql(`select id from public.users where email = ${quote(memberEmail)}`);
  memberId = sql(`select id from public.organization_members where user_id = ${quote(memberUserId)} and organization_id = ${quote(orgId)}`);
  check(
    'the invite gave exactly its access',
    sql(`select access from public.organization_members where id = ${quote(memberId)}`) === 'LIMITED' &&
      sql(`select entity_type || ':' || entity_id || ':' || array_to_string(permissions, ',') from public.user_grants where user_id = ${quote(memberUserId)} and organization_id = ${quote(orgId)}`) ===
        `course:${courseId}:READ,WRITE,DELETE,TASKS`
  );

  await settle(member, '/admin/courses');
  const courses = await text(member);
  check('limited to a course: only that course is listed', courses.includes('Web Development II') && !courses.includes(otherTitle));
  check("another course's page is out of reach", !(await landsOn(member, `/admin/courses/${otherCourseId}`)).includes(otherCourseId));
  await member.goto(`${BASE}/admin/courses/${courseId}/lessons/${coreLessonId}`);
  check('they edit its lessons', await member.locator('[data-testid=lesson-document]').first().waitFor().then(() => true, () => false));
  check('creating courses stays with unrestricted members', (await landsOn(member, '/admin/courses/new')) !== '/admin/courses/new');
  check('partners stay with unrestricted members', (await landsOn(member, '/admin/courses/partners')) !== '/admin/courses/partners');
  check('course settings stay with unrestricted members', (await landsOn(member, `/admin/courses/${courseId}/edit`)).endsWith(courseId));
  check(
    'no Team or Reports in the menu (Settings has only their own pages)',
    (await member.locator('nav a[href="/admin/team"], nav a[href="/admin/reports"]').count()) === 0
  );

  // 3. The owner makes them an instructor of the Summer group only, view only (Access dialog).
  step = 'open the Access dialog';
  await owner.goto(`${BASE}/admin/team`);
  await owner.locator('li:visible', { hasText: memberName }).getByRole('button', { name: 'Access', exact: true }).click();
  const dialog = owner.locator('[role=dialog]');
  step = 'pick Chosen groups';
  await pick(owner, `[role=dialog] #member-access-${memberId}-scope`, 'Chosen groups');
  step = 'tick the Summer group';
  await dialog.locator('[data-testid=access-groups] label', { hasText: 'Summer group · 2026' }).first().click();
  step = 'pick View only';
  await pick(owner, `[role=dialog] #member-access-${memberId}-lessons`, 'View only');
  step = 'save access';
  await dialog.locator('[data-testid=access-save]').click();
  await dialog.waitFor({ state: 'detached' });
  check(
    'the Access dialog saves the group, view only, feedback on',
    sql(`select entity_type || ':' || entity_id || ':' || array_to_string(permissions, ',') from public.user_grants where user_id = ${quote(memberUserId)} and organization_id = ${quote(orgId)}`) ===
      `group:${summerId}:READ,TASKS`
  );

  const landed = await landsOn(member, '/admin/courses');
  // One group: the group itself is their place.
  check('an instructor of one group works from their group', landed === `/admin/courses/groups/${summerId}`, landed);
  const groups = await text(member);
  check('they see only their group', groups.includes('Summer group') && !groups.includes('Evening group'));
  await settle(member, `/admin/courses/groups/${summerId}?tab=people`);
  const groupPage = [
    await member.locator('[data-testid=group-roster-form]').count(),
    await member.locator('#group-name').count(),
    await member.getByRole('link', { name: 'Read the lessons' }).count(),
  ];
  check('their group page: roster and lessons to read, not the group settings', groupPage.join() === '1,0,1', groupPage.join());
  const lessonLanding = await landsOn(member, `/admin/courses/${courseId}/lessons/${coreLessonId}`);
  check('a core lesson opens read only (the preview)', lessonLanding.endsWith('/preview'), lessonLanding);

  // Learner feedback from two groups that read the same core lessons.
  const say = async (token, body) =>
    fetch(`${BASE}/api/access/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, lessonId: coreLessonId, selectedText: 'e2e passage', context: null, body }),
    });
  const summerToken = linkFor('summer-2026');
  const summerSays = `Summer ${run} says`;
  const springSays = `Spring ${run} says`;
  const posted = summerToken ? (await say(summerToken, summerSays)).status : 0;
  check('a learner leaves feedback through their link', posted === 201, String(posted));
  // The Spring group's links have expired by now: its feedback on the same lesson goes in directly.
  sql(`insert into courses.curriculum_comments (id, curriculum_version_id, lesson_id, group_id, proposer_name, selected_text, body, updated_at)
       values ('e2e-spring-${run}', ${quote(coreVersionId)}, ${quote(coreLessonId)}, ${quote(springId)}, 'A learner · Spring', 'e2e passage', ${quote(springSays)}, now())`);
  check('feedback knows its group', sql(`select group_id from courses.curriculum_comments where body = ${quote(summerSays)}`) === summerId);
  check(
    'the team sees "A learner", never the learner\'s name',
    sql(`select proposer_name from courses.curriculum_comments where body = ${quote(summerSays)}`).startsWith('A learner')
  );
  const margin = await (await member.request.get(`${BASE}/api/team/comment?lessonId=${coreLessonId}`)).json();
  const bodies = (margin.comments ?? []).map((comment) => comment.body);
  check("an instructor sees their group's feedback only", bodies.includes(summerSays) && !bodies.includes(springSays), bodies.join(' | '));
  const note = (token) =>
    member.request.post(`${BASE}/api/team/comment`, {
      data: { lessonId: coreLessonId, selectedText: 'e2e passage', body: `Class note ${run}`, ...(token ? { token } : {}) },
    });
  check('a class note needs their group (not the course)', (await note(null)).status() === 403);
  check('with their group, it is saved as that group’s', (await note(`group:${summerId}`)).status() === 201 && sql(`select group_id from courses.curriculum_comments where body = ${quote(`Class note ${run}`)}`) === summerId);
  await settle(member, `/admin/courses/comments/${coreVersionId}`);
  const inbox = await text(member);
  check('the feedback inbox shows their group only', inbox.includes(summerSays) && !inbox.includes(springSays));
  const exported = await member.request.get(`${BASE}/admin/api/feedback-export?group=${summerId}`);
  const exportedText = await exported.text();
  check("they export their group's feedback, and only that", exported.status() === 200 && exportedText.includes(summerSays) && !exportedText.includes(springSays), String(exported.status()));
  const exportElsewhere = await Promise.all([
    member.request.get(`${BASE}/admin/api/feedback-export?group=${springId}`),
    member.request.get(`${BASE}/admin/api/feedback-export?course=${courseId}`),
  ]);
  check("not another group's or the whole course's", exportElsewhere.every((response) => response.status() === 401), exportElsewhere.map((response) => response.status()).join(','));

  // 4. Feedback off: read only.
  sql(`update public.user_grants set permissions = '{READ}' where user_id = ${quote(memberUserId)} and organization_id = ${quote(orgId)}`);
  check('feedback off: no class notes', (await note(`group:${summerId}`)).status() === 403);
  await settle(member, `/admin/courses/comments/${coreVersionId}`);
  check('feedback off: the inbox is read only', (await text(member)).includes(summerSays) && (await member.getByRole('button', { name: 'Done' }).count()) === 0);

  // 5–6 need a second organisation: not in the local edition, which runs one.
  if (cloud) {
    // 5. Only this organisation's courses can be granted.
    const orgBId = `${orgB}`;
    sql(`insert into public.organizations (id, name, slug, updated_at) values (${quote(orgBId)}, 'E2E Second ${run}', ${quote(orgB)}, now())`);
    const foreignCourse = `e2e-course-b-${run}`;
    sql(`insert into courses.courses (id, organization_id, title, slug, updated_at) values (${quote(foreignCourse)}, ${quote(orgBId)}, 'Foreign course ${run}', 'foreign-${run}', now())`);
    await owner.goto(`${BASE}/admin/team`);
    await owner.locator('[data-testid=team-invite]').locator('visible=true').first().click();
    await owner.locator('#invite-label').locator('visible=true').first().fill(`Foreign ${run}`);
    await owner.evaluate((id) => {
      const field = document.querySelector('input[name=access]');
      // A tampered form naming another organisation's course.
      if (field) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(field, JSON.stringify({ kind: 'limited', preset: { scope: 'courses', courseIds: [id], lessons: 'edit', feedback: true } }));
      }
    }, foreignCourse);
    // React may restore the value on the next render, so submit straight away.
    await owner.getByRole('button', { name: 'Create invite link' }).click();
    await owner.waitForTimeout(1500);
    const invitesBefore = Number(sql(`select count(*) from public.user_invites where organization_id = ${quote(orgId)} and label = ${quote(`Foreign ${run}`)} and grants::text like ${quote(`%${foreignCourse}%`)}`));
    check("another organisation's course can't be granted", invitesBefore === 0);

    // 6. Access is per organisation: the same person owns another organisation.
    sql(`insert into public.organization_members (id, organization_id, user_id, role, updated_at) values ('e2e-m-b-${run}', ${quote(orgBId)}, ${quote(memberUserId)}, 'OWNER', now())`);
    await member.goto(`${BASE}/admin`);
    await member.locator('#org-switcher').locator('visible=true').first().click();
    await member.locator('[role=menuitemradio]:visible', { hasText: `E2E Second ${run}` }).first().click();
    // The switch is a server action: wait until the sidebar names the other organisation.
    await member.locator('#org-switcher:visible', { hasText: `E2E Second ${run}` }).waitFor();
    await settle(member, '/admin/courses');
    check('in their own organisation they see everything', (await text(member)).includes(`Foreign course ${run}`), member.url());
    await member.goto(`${BASE}/admin`);
    await member.locator('#org-switcher').locator('visible=true').first().click();
    await member.locator('[role=menuitemradio]:visible', { hasText: 'Northwind Academy' }).first().click();
    await member.locator('#org-switcher:visible', { hasText: 'Northwind Academy' }).waitFor();
    const backIn = await landsOn(member, '/admin/courses');
    check('back in the first, their limits apply again', backIn === `/admin/courses/groups/${summerId}`, backIn);
  } else {
    console.log('SKIP  another organisation (the local edition runs one)');
  }

  // 7. Losing the last group leaves nothing, never everything.
  sql(`delete from public.user_grants where user_id = ${quote(memberUserId)} and organization_id = ${quote(orgId)}`);
  await settle(member, '/admin');
  check(
    'with no courses or groups left they see nothing',
    (await text(member)).includes('Ask an owner or admin') && (await member.locator('nav a[href="/admin/courses"], nav a[href="/admin/courses/groups"]').count()) === 0
  );
  check('and stay limited', sql(`select access from public.organization_members where id = ${quote(memberId)}`) === 'LIMITED');

  // 8. Removing the member removes their rules.
  sql(`insert into public.user_grants (id, user_id, organization_id, entity_type, entity_id, permissions, created_at, updated_at)
       values ('e2e-left-${run}', ${quote(memberUserId)}, ${quote(orgId)}, 'course', ${quote(courseId)}, '{READ}', now(), now())`);
  await owner.goto(`${BASE}/admin/team`);
  await teamMemberAction(owner, memberName, 'Remove from the team…', 'Remove');
  await owner.waitForTimeout(1500);
  check(
    'removing a member removes their rules there',
    sql(`select count(*) from public.user_grants where user_id = ${quote(memberUserId)} and organization_id = ${quote(orgId)}`) === '0'
  );
} catch (error) {
  check(`unexpected error (at: ${step})`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `tests/e2e/.shots/access-fail-${index}.png` }).catch(() => {});
} finally {
  sql(`delete from public.user_grants where id = 'e2e-owner-${run}'`);
  sql(`delete from courses.curriculum_comments where body like ${quote(`%${run}%`)}`);
  sql(`delete from public.organizations where slug = ${quote(orgB)}`);
  await browser.close();
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
}
