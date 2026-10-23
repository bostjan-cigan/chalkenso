// Group instructors end to end: whoever manages a group adds a team member as its instructor (here one
// limited to another course, who gets the group added at their level); the instructor finds it on
// Overview and under "My groups"; learners see who teaches them; the group's tasks offer its
// instructors first; removing an instructor keeps their access; leaving the team ends it; a guest
// instructor invited from the group's page joins with notes on it and teaches it, and an unused
// invite can be withdrawn. Needs the demo seed and a server (yarn dev, or BASE_URL).
// node tests/e2e/e2e-group-instructors.mjs
import { chromium } from 'playwright-core';
import { BASE, env, sql, teamMemberAction } from './helpers.mjs';

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
const summerId = sql(`select id from courses.course_groups where course_id = ${quote(courseId)} and slug = 'summer-2026'`);
const otherCourseTitle = sql(`select title from courses.courses where organization_id = ${quote(orgId)} and id <> ${quote(courseId)} order by title limit 1`);
const otherCourseId = sql(`select id from courses.courses where organization_id = ${quote(orgId)} and title = ${quote(otherCourseTitle)}`);
const learnerToken = sql(`select l.token from courses.access_links l join courses.course_group_members m on m.id = l.member_id
  where m.group_id = ${quote(summerId)} and l.revoked_at is null and l.expires_at > now() order by l.id limit 1`);
if (!orgId || !courseId || !summerId || !otherCourseId) {
  console.log('FAIL  demo organisation found (run yarn db:seed-demo)');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const password = `E2e-${run}-password!`;
const memberEmail = `teacher-${run}@example.com`;
const memberName = `Tea Teacher ${run}`;
let memberUserId = '';
let guestUserId = '';
const guestEmail = `guest-teacher-${run}@example.com`;
const guestName = `Gal Guest ${run}`;
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
async function settle(page, path) {
  await page.goto(BASE + path).catch(() => null);
  await page.waitForLoadState('networkidle').catch(() => {});
}
const pick = async (page, trigger, option) => {
  await page.locator(trigger).locator('visible=true').first().click();
  await page.locator('[role=option]:visible', { hasText: option }).first().click();
};
/** Opens a collapsible card on the page if it is closed. */
const expand = async (page, kicker) => {
  const trigger = page.getByRole('button', { name: `Expand ${kicker}` });
  if (await trigger.count()) await trigger.click();
};
const assigned = () => sql(`select count(*) from courses.course_group_instructors where group_id = ${quote(summerId)} and user_id = ${quote(memberUserId)}`);
const grantRow = () =>
  sql(`select coalesce(array_to_string(permissions, ','), '') from public.user_grants where user_id = ${quote(memberUserId)}
    and organization_id = ${quote(orgId)} and entity_type = 'group' and entity_id = ${quote(summerId)}`);

try {
  const owner = await newPage();
  await owner.goto(`${BASE}/admin/login`);
  await owner.fill('#admin-identifier', env.DEMO_EMAIL);
  await owner.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([owner.waitForURL(/\/admin(\?|$)/), owner.click('button[type=submit]')]);

  // 1. A member limited to another course (invited from the Team page).
  step = 'invite a member limited to another course';
  await owner.goto(`${BASE}/admin/team`);
  // Invite opens its sheet from the members' card.
  await owner.locator('[data-testid=team-invite]').locator('visible=true').first().click();
  await owner.locator('#invite-label').locator('visible=true').first().fill(memberName);
  await owner.locator('[data-testid=access-limited]').first().click();
  await owner.locator('[data-testid=access-courses] label', { hasText: otherCourseTitle }).first().click();
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  await owner.waitForSelector('[data-testid=invite-link]');
  const inviteLink = (await owner.locator('[data-testid=invite-link]').innerText()).trim().replace(/^https?:\/\/[^/]+/, BASE);
  const member = await newPage();
  await member.goto(inviteLink);
  await member.fill('#invite-name', memberName);
  await member.fill('#invite-email', memberEmail);
  await member.fill('#invite-password', password);
  await Promise.all([member.waitForURL(/\/admin/), member.getByRole('button', { name: /Create account and join/ }).click()]);
  memberUserId = sql(`select id from public.users where email = ${quote(memberEmail)}`);

  // 2. The owner makes them an instructor of the Summer group.
  step = 'add them as an instructor';
  await settle(owner, `/admin/courses/groups/${summerId}?tab=people`);
  await expand(owner, 'Instructors');
  await owner.locator(`#group-instructor-add-${summerId}`).click();
  const option = owner.locator('[role=option]:visible', { hasText: memberName }).first();
  check('the picker says adding them adds the group to their access', (await option.innerText()).includes('adds this group to their access'));
  await option.click();
  await owner.locator('[data-testid=group-instructors]').getByRole('button', { name: 'Add', exact: true }).click();
  await owner.locator('[data-testid=group-instructor]', { hasText: memberName }).waitFor();
  check('they are the group’s instructor', assigned() === '1');
  check('the group is added to their access, at their level', grantRow() === 'READ,WRITE,DELETE,TASKS', grantRow());
  await settle(owner, `/admin/courses/groups/${summerId}`);
  check('the group page says who teaches it', (await owner.locator('body').innerText()).includes(`taught by`) && (await owner.locator('body').innerText()).includes(memberName));
  await settle(owner, '/admin/courses/groups');
  check('the groups list says who teaches each group', (await owner.locator('main:visible').innerText()).includes(`${memberName}`));

  // 3. The instructor: their group on Overview and under "My groups".
  step = 'the instructor’s Overview and My groups';
  await settle(member, '/admin');
  check('Home lists the group they teach', (await member.locator('[data-testid=home-groups], [data-testid=guest-groups]').first().innerText().catch(() => '')).includes('Summer group'));
  await settle(member, '/admin/courses/groups?mine=1');
  const mine = await member.locator('main:visible').innerText();
  check('"My groups" shows the groups they teach only', mine.includes('Summer group') && !mine.includes('Spring group'));
  // The owner may teach groups too (the demo seed assigns some): a group they don't teach stays out.
  const ownerId = sql(`select id from public.users where lower(email) = lower(${quote(env.DEMO_EMAIL)})`);
  const notOwners = sql(`select g.name from courses.course_groups g join courses.courses c on c.id = g.course_id
    where c.organization_id = ${quote(orgId)} and g.id not in (select group_id from courses.course_group_instructors where user_id = ${quote(ownerId)})
    order by g.name limit 1`);
  await settle(owner, '/admin/courses/groups?mine=1');
  check('"My groups" leaves out the groups you don’t teach', !(await owner.locator('main:visible').innerText()).includes(notOwners), notOwners);

  // 4. Learners see who teaches them.
  if (learnerToken) {
    const reader = await newPage();
    await settle(reader, `/l/course/${learnerToken}`);
    const taughtBy = await reader.locator('[data-testid=course-instructors]').innerText().catch(() => '');
    check('the learner page says who teaches the group', taughtBy.includes(memberName), taughtBy);
  } else {
    console.log('SKIP  learner page (no active learner link in the Summer group)');
  }

  // 5. The group's tasks offer its instructors first (a task of the Summer group, made here).
  const summerTask = `e2e-task-${run}`;
  sql(`insert into public.tasks (id, kind, title, organization_id, updated_at) values (${quote(summerTask)}, 'curriculum', ${quote(`Summer task ${run}`)}, ${quote(orgId)}, now())`);
  sql(`insert into public.task_entity_links (id, task_id, entity_type, entity_id) values
    (${quote(`${summerTask}-c`)}, ${quote(summerTask)}, 'course', ${quote(courseId)}),
    (${quote(`${summerTask}-g`)}, ${quote(summerTask)}, 'course_group', ${quote(summerId)})`);
  {
    step = 'task assignees';
    await settle(owner, `/admin/tasks/${summerTask}`);
    await owner.locator(`#task-assignee-${summerTask}`).click();
    // The list opens once the page is live: wait for the person, not just the "Unassigned" row.
    await owner.locator('[role=option]:visible', { hasText: memberName }).first().waitFor();
    const options = await owner.locator('[role=option]:visible').allInnerTexts();
    const firstPerson = options.find((text) => !text.startsWith('Unassigned')) ?? '';
    check('a group task offers its instructors first', firstPerson.includes('Teaches this group'), options.slice(0, 3).join(' | '));
    check('marked as teaching it', options.some((text) => text.includes(memberName) && text.includes('Teaches this group')));
    await owner.keyboard.press('Escape');
  }

  // 6. Removing an instructor keeps their access.
  step = 'remove the instructor';
  await settle(owner, `/admin/courses/groups/${summerId}?tab=people`);
  await expand(owner, 'Instructors');
  await owner.locator('[data-testid=group-instructor]', { hasText: memberName }).getByRole('button', { name: 'Remove' }).click();
  await owner.locator('[data-testid=group-instructor]', { hasText: memberName }).waitFor({ state: 'detached' });
  check('removing them takes them off the group', assigned() === '0');
  check('and leaves their access as it was', grantRow() === 'READ,WRITE,DELETE,TASKS');

  // 7. Leaving the team ends it.
  step = 'remove them from the team';
  sql(`insert into courses.course_group_instructors (id, group_id, user_id, created_at) values ('e2e-gi-${run}', ${quote(summerId)}, ${quote(memberUserId)}, now())`);
  await owner.goto(`${BASE}/admin/team`);
  await teamMemberAction(owner, memberName, 'Remove from the team…', 'Remove');
  await owner.waitForTimeout(1500);
  check('leaving the team takes them off its groups', assigned() === '0');

  // 8. Invite a guest instructor from the group's page.
  step = 'invite a guest from the group page';
  const openInvite = async (name) => {
    await settle(owner, `/admin/courses/groups/${summerId}?tab=people`);
    await expand(owner, 'Instructors');
    await owner.locator('[data-testid=guest-invite-start]').click();
    await owner.locator(`#guest-invite-name-${summerId}`).fill(name);
    await owner.getByRole('button', { name: 'Create invite link' }).click();
    await owner.locator('[data-testid=guest-invite-link]').waitFor();
    return (await owner.locator('[data-testid=guest-invite-link]').innerText()).trim().replace(/^https?:\/\/[^/]+/, BASE);
  };
  const guestInvite = await openInvite(guestName);
  check('the group page makes a guest instructor invite', guestInvite.includes('/invite/'));
  check(
    'the invite gives notes on this group and teaching it',
    sql(`select array_to_string(array(select jsonb_array_elements(grants)->>'permissions'), '') || '|' || coalesce(teaches_group_id, '')
      from public.user_invites where label = ${quote(guestName)}`) === `["NOTES"]|${summerId}`
  );
  await settle(owner, `/admin/courses/groups/${summerId}?tab=people`);
  await expand(owner, 'Instructors');
  check('the unused invite is listed on the card', (await owner.locator('[data-testid=guest-invite-pending]:visible', { hasText: guestName }).count()) === 1);

  const guest = await newPage();
  await guest.goto(guestInvite);
  check('the invite page says which group they will teach', (await guest.locator('body').innerText()).includes('invited to teach Summer group'));
  await guest.fill('#invite-name', guestName);
  await guest.fill('#invite-email', guestEmail);
  await guest.fill('#invite-password', password);
  await Promise.all([guest.waitForURL(/\/admin/), guest.getByRole('button', { name: /Create account and join/ }).click()]);
  guestUserId = sql(`select id from public.users where email = ${quote(guestEmail)}`);
  check(
    'they joined as a guest instructor of the group, and teach it',
    sql(`select string_agg(entity_type || ':' || entity_id || ':' || array_to_string(permissions, ','), ';') from public.user_grants where user_id = ${quote(guestUserId)}`) ===
      `group:${summerId}:NOTES` &&
      sql(`select count(*) from courses.course_group_instructors where group_id = ${quote(summerId)} and user_id = ${quote(guestUserId)}`) === '1'
  );
  await settle(guest, '/admin');
  check('their Overview has the group', (await guest.locator('[data-testid=guest-groups]').innerText().catch(() => '')).includes('Summer group'));

  // 9. An unused invite can be withdrawn.
  step = 'withdraw an invite';
  const withdrawnName = `Unused ${run}`;
  const unused = await openInvite(withdrawnName);
  await settle(owner, `/admin/courses/groups/${summerId}?tab=people`);
  await expand(owner, 'Instructors');
  await owner.locator('[data-testid=guest-invite-pending]', { hasText: withdrawnName }).getByRole('button', { name: 'Withdraw' }).click();
  await owner.locator('[data-testid=guest-invite-pending]', { hasText: withdrawnName }).waitFor({ state: 'detached' });
  const late = await newPage();
  await late.goto(unused);
  check('a withdrawn invite no longer works', (await late.locator('body').innerText()).includes('no longer valid'));
} catch (error) {
  check(`unexpected error (at: ${step})`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `tests/e2e/.shots/group-instructors-fail-${index}.png` }).catch(() => {});
} finally {
  sql(`delete from public.tasks where id = 'e2e-task-${run}'`);
  sql(`delete from public.user_invites where label in (${quote(guestName)}, ${quote(`Unused ${run}`)})`);
  if (guestUserId) {
    sql(`delete from public.users where id = ${quote(guestUserId)}`);
  }
  if (memberUserId) {
    sql(`delete from public.users where id = ${quote(memberUserId)}`);
  }
  await browser.close();
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
}
