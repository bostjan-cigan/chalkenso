// Sessions end to end: "Keep me signed in" chooses the longer limits and a cookie that outlives the
// browser, without it the cookie goes with the browser; Profile lists where you're signed in (this
// browser first, the browser and its kind) and signs one out, or all devices (this one too, and no
// browser remembered any more); a session about
// to run out without activity asks "Are you still there?" and Stay signed in moves it on; when it
// runs out the sign-in page says so and comes back after; the hard end can't be moved on; an owner
// signs a member out of the organisation from the Team page (they sign in again to open it); five
// wrong passwords lock new browsers out of an account for 15 minutes, the right one included (an email
// without an account too), while a browser that signed in before still gets in and has its own lock.
// Needs the demo seed and a server (yarn dev, or BASE_URL).
// node tests/e2e/e2e-sessions.mjs
import { randomBytes, scryptSync } from 'node:crypto';
import { generateSync } from 'otplib';
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
const orgName = sql(`select name from public.organizations where id = ${quote(orgId)}`);
if (!orgId) {
  console.log('FAIL  demo organisation found (run yarn db:seed-demo)');
  process.exit(1);
}

// A member of the demo organisation, made here (the app's password format), so signing them out
// never touches anyone else's sessions.
const password = `E2e-${run}-password!`;
const salt = randomBytes(16).toString('hex');
const memberEmail = `sessions-${run}@example.com`;
const memberName = `Sia Sessions ${run}`;
const memberUserId = `e2e-sessions-${run}`;
const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
/** The password, where Better Auth keeps it: the account's "credential" row. */
const withPassword = (userId) =>
  sql(`insert into public.auth_accounts (id, account_id, provider_id, user_id, password, updated_at)
       values (${quote(`cred-${userId}`)}, ${quote(userId)}, 'credential', ${quote(userId)}, ${quote(passwordHash)}, now())`);
sql(`insert into public.users (id, identifier, display_username, email, name, first_name, last_name, updated_at)
     values (${quote(memberUserId)}, ${quote(memberEmail)}, ${quote(memberEmail)}, ${quote(memberEmail)}, ${quote(memberName)}, 'Sia', ${quote(`Sessions ${run}`)}, now())`);
withPassword(memberUserId);
sql(`insert into public.organization_members (id, organization_id, user_id, role, updated_at) values (${quote(`e2e-sm-${run}`)}, ${quote(orgId)}, ${quote(memberUserId)}, 'MEMBER', now())`);
const adminEmail = `sessions-admin-${run}@example.com`;
const adminUserId = `e2e-sessions-admin-${run}`;
if (cloud) {
  sql(`insert into public.users (id, identifier, display_username, email, name, role, first_name, updated_at)
       values (${quote(adminUserId)}, ${quote(adminEmail)}, ${quote(adminEmail)}, ${quote(adminEmail)}, 'Ada', 'SUPERADMIN', 'Ada', now())`);
  withPassword(adminUserId);
}

const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const pages = [];
let step = 'start';

async function newPage(userAgent) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ...(userAgent ? { userAgent } : {}) });
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(30000);
  return page;
}

/** Signs in on `page`, ticking "Keep me signed in" or not; true when it worked. */
async function signIn(page, email, secret, { keep = false, next = null } = {}) {
  await page.goto(`${BASE}/admin/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.fill('#admin-identifier', email);
  await page.fill('#admin-password', secret);
  if (keep) await page.locator('label', { hasText: 'Keep me signed in' }).click();
  // In, or still on the sign-in page saying why not.
  await page.click('button[type=submit]');
  await page
    .waitForFunction(() => !location.pathname.startsWith('/admin/login') || document.querySelector('[data-testid=sign-in-error]'), null, { timeout: 30000 })
    .catch(() => null);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return !new URL(page.url()).pathname.startsWith('/admin/login');
}

async function sessionCookie(page) {
  return (await page.context().cookies()).find((cookie) => cookie.name.endsWith('cai.session_token'));
}

/** The member's newest open session (optionally: kept signed in or not). */
const newestSession = (persistent) =>
  sql(`select id from public.user_sessions where user_id = ${quote(memberUserId)} and revoked_at is null
       ${persistent === undefined ? '' : `and persistent = ${persistent}`} order by created_at desc limit 1`);
const hoursLeft = (id, column) => Number(sql(`select extract(epoch from (${column} - now())) / 3600 from public.user_sessions where id = ${quote(id)}`));

/** Loads `path` and waits for streaming and any late guard redirect. */
async function settle(page, path) {
  await page.goto(BASE + path).catch(() => null);
  await page.waitForLoadState('networkidle').catch(() => {});
}

try {
  // 1. "Keep me signed in": the long limits and a lasting cookie.
  step = 'sign in, kept';
  const kept = await newPage();
  check('signing in with Keep me signed in works', await signIn(kept, memberEmail, password, { keep: true }));
  const keptId = newestSession(true);
  const keptCookie = await sessionCookie(kept);
  check('the session is kept signed in', Boolean(keptId));
  check(
    'it ends after 14 days without activity, and after 30 days at most',
    Math.abs(hoursLeft(keptId, 'expires_at') - 14 * 24) < 1 && Math.abs(hoursLeft(keptId, 'max_expires_at') - 30 * 24) < 1
  );
  // Better Auth's cookie lasts as long as the idle end and moves on with it; the hard end is kept in the database.
  check('its cookie outlives the browser, moving on with the session', Boolean(keptCookie) && Math.abs((keptCookie.expires - Date.now() / 1000) / 86400 - 14) < 1);

  // 2. Without it: the short limits, and the cookie goes with the browser.
  step = 'sign in, not kept';
  const short = await newPage(FIREFOX_WINDOWS);
  check('signing in without it works', await signIn(short, memberEmail, password));
  const shortId = newestSession(false);
  const shortCookie = await sessionCookie(short);
  check(
    'it ends after 2 hours without activity, and after 12 hours at most',
    Math.abs(hoursLeft(shortId, 'expires_at') - 2) < 0.1 && Math.abs(hoursLeft(shortId, 'max_expires_at') - 12) < 0.1
  );
  check('its cookie ends with the browser', Boolean(shortCookie) && shortCookie.expires === -1);

  const phone = await newPage(SAFARI_IPHONE);
  await signIn(phone, memberEmail, password);

  // 3. Where you're signed in.
  step = 'profile list';
  await settle(kept, '/admin/profile');
  const list = kept.locator('[data-testid=sessions]');
  await list.waitFor();
  const rows = list.locator('[data-testid=session-row]');
  check('Profile lists the three sessions', (await rows.count()) === 3, String(await rows.count()));
  check('this browser first, marked', (await rows.first().getAttribute('data-current')) === 'true' && (await rows.first().innerText()).includes('This browser'));
  const listText = await list.innerText();
  check('each says its browser and system', listText.includes('Firefox on Windows') && listText.includes('Safari on iPhone') && listText.includes('Chrome on Mac'));
  check('the limits are explained', listText.includes('2 hours without activity') && listText.includes('(30 days at most)'));

  // Their details: rows that open a sheet each, saving only that part.
  step = 'profile details';
  await kept.locator('[data-testid=profile-name-row]:visible').first().click();
  const nameSheet = kept.locator('[role=dialog]');
  await nameSheet.locator('#profile-first-name').fill(`Kept ${run}`);
  // Save is the sheet's, and closes it once saved.
  await nameSheet.getByRole('button', { name: 'Save', exact: true }).click();
  await nameSheet.waitFor({ state: 'detached' });
  check(
    'the Name sheet saves the name and keeps the email',
    sql(`select first_name || '|' || email from public.users where id = ${quote(memberUserId)}`) === `Kept ${run}|${memberEmail}`,
    sql(`select first_name || '|' || coalesce(email, '') from public.users where id = ${quote(memberUserId)}`)
  );
  check('…and its row shows the name', (await kept.locator('[data-testid=profile-name-row]:visible').first().innerText()).includes(`Kept ${run}`));
  // Later steps find them by their name.
  sql(`update public.users set first_name = 'Sia' where id = ${quote(memberUserId)}`);

  // 4. Signing one other session out.
  step = 'sign one out';
  // The row opens its details, like a device list; Sign out is in there.
  await rows.filter({ hasText: 'Firefox on Windows' }).getByRole('button').click();
  const dialog = kept.locator('[role=dialog]:visible');
  await dialog.waitFor();
  const details = await dialog.innerText();
  check('a row opens its details, named for the browser', details.includes('Firefox on Windows') && details.includes('Last active'));
  check('a session without Keep me signed in says it ends with the browser', details.includes('Until the browser closes'));
  // As in a system alert: Cancel is the default for a destructive action, and Tab stays inside.
  await kept.waitForFunction(() => document.activeElement?.textContent === 'Cancel').catch(() => null);
  check('Cancel has the focus, so Return doesn’t sign anything out', await kept.evaluate(() => document.activeElement?.textContent === 'Cancel'));
  for (let press = 0; press < 3; press += 1) await kept.keyboard.press('Tab');
  check('Tab stays inside the dialog', await kept.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))));
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await kept.getByText('Signed out.').waitFor();
  check('that session ends, by them', sql(`select ended_reason from public.user_sessions where id = ${quote(shortId)}`) === 'self');
  // The list refreshes just after the notice.
  const gone = await kept
    .waitForFunction(() => !document.querySelector('[data-testid=sessions]')?.textContent?.includes('Firefox on Windows'), null, { timeout: 10000 })
    .then(() => true, () => false);
  check('the list no longer shows it', gone);
  await settle(short, '/admin');
  check('that browser is asked to sign in, told why', new URL(short.url()).searchParams.get('signedout') === '1' && (await short.locator('body').innerText()).includes('You’re signed out'));

  // 6. About to run out without activity: "Are you still there?", and Stay signed in moves it on.
  // On a session without Keep me signed in (2 hours): a kept one is moved on by any visit at all.
  step = 'still there';
  const idle = await newPage();
  await signIn(idle, memberEmail, password);
  const idleId = newestSession(false);
  await settle(idle, '/admin/profile');
  // Seen just now, so loading the page doesn't move the end on by itself.
  sql(`update public.auth_sessions set expires_at = now() + interval '90 seconds' where id = ${quote(idleId)}`);
  sql(`update public.user_sessions set last_seen_at = now() where id = ${quote(idleId)}`);
  await settle(idle, '/admin/profile');
  const prompt = idle.locator('[data-testid=session-prompt]');
  check('the page asks if they are still there', await prompt.waitFor({ timeout: 20000 }).then(() => true, () => false));
  check('saying when, once, with a countdown to see', /signed out at \d{1,2}:\d\d/.test(await prompt.innerText()) && /^\d:\d\d$/.test((await idle.getByTestId('session-countdown').innerText()).trim()));
  await idle.getByRole('button', { name: 'Stay signed in' }).click();
  await prompt.waitFor({ state: 'detached' });
  check('Stay signed in moves the end on', hoursLeft(idleId, 'expires_at') > 1.9);

  // 7. Running out: the sign-in page says so, and comes back after.
  step = 'runs out';
  sql(`update public.auth_sessions set expires_at = now() + interval '4 seconds' where id = ${quote(idleId)}`);
  sql(`update public.user_sessions set last_seen_at = now() where id = ${quote(idleId)}`);
  await settle(idle, '/admin/profile');
  const sentToSignIn = await idle.waitForURL(/\/admin\/login\?signedout=1/, { timeout: 30000 }).then(() => true, () => false);
  check('when it runs out, the sign-in page opens and says so', sentToSignIn && (await idle.locator('body').innerText()).includes('Your session ended'));
  check('and knows where they were', new URL(idle.url()).searchParams.get('next') === '/admin/profile');
  await idle.fill('#admin-identifier', memberEmail);
  await idle.fill('#admin-password', password);
  await Promise.all([idle.waitForURL(/\/admin\/profile/), idle.click('button[type=submit]')]);
  check('signing in again comes back there', new URL(idle.url()).pathname === '/admin/profile');

  // 8. The hard end isn't moved on by activity: the next page asks to sign in.
  step = 'hard end';
  const afterId = newestSession();
  sql(`update public.auth_sessions set max_expires_at = now() - interval '1 second' where id = ${quote(afterId)}`);
  await settle(idle, '/admin');
  check('after its hard end, the session is over', new URL(idle.url()).pathname === '/admin/login');

  // 9. An owner signs the member out of the organisation.
  step = 'team sign out';
  const member = await newPage();
  await signIn(member, memberEmail, password, { keep: true });
  const memberSession = newestSession();
  // And one that began before, working elsewhere (in no organisation, as if in another): it keeps
  // going until it tries to open this one.
  const elsewhere = await newPage();
  await signIn(elsewhere, memberEmail, password);
  const elsewhereSession = newestSession();
  sql(`update public.auth_sessions set organization_id = null where id = ${quote(elsewhereSession)}`);
  const owner = await newPage();
  await signIn(owner, env.DEMO_EMAIL, env.DEMO_PASSWORD);
  await settle(owner, '/admin/team');
  await teamMemberAction(owner, memberName, 'Sign out…', 'Sign out');
  await owner.getByText('Signed out. They’ll need to sign in again').waitFor();
  check('the member’s session there ends, by the organisation', sql(`select ended_reason from public.user_sessions where id = ${quote(memberSession)}`) === 'organization');
  check('the membership remembers when', sql(`select signed_out_at is not null from public.organization_members where user_id = ${quote(memberUserId)}`) === 't');
  // A session that began earlier, working elsewhere, can't come back to it either.
  check('a session working elsewhere goes on', sql(`select count(*) from public.auth_sessions where id = ${quote(elsewhereSession)}`) === '1');
  await settle(elsewhere, '/admin');
  check('but can’t open the organisation again', new URL(elsewhere.url()).pathname === '/admin/login');
  check('their membership and access stay', sql(`select count(*) from public.organization_members where user_id = ${quote(memberUserId)}`) === '1');
  check('signing in again opens it', await signIn(member, memberEmail, password));
  const ownRow = owner.locator('[data-testid=team-members] li', { hasText: '(you)' }).first();
  check('owners can’t sign themselves out from the Team page', (await ownRow.locator('button[aria-label^="More for"]').count()) === 0);

  if (cloud) {
    step = 'superadmin';
    const admin = await newPage();
    await signIn(admin, adminEmail, password);
    // "Log in as" still opens an hour-long visit, never moved on, and comes back to the admin's own session.
    await settle(admin, `/admin/platform/users/${memberUserId}`);
    await Promise.all([admin.waitForURL(/\/admin(\?|$)/), admin.getByRole('button', { name: /^Log in as / }).click()]);
    const visit = sql(`select round(extract(epoch from (expires_at - now())) / 60) || ':' || (expires_at = max_expires_at) || ':' || persistent
      from public.user_sessions where user_id = ${quote(memberUserId)} and impersonator_id = ${quote(adminUserId)} and revoked_at is null`);
    check('a log-in-as visit lasts its hour, and only that', visit === '60:true:false', visit);
    check('it doesn’t ask if they are still there', (await admin.locator('[data-testid=session-prompt]').count()) === 0);
    await Promise.all([admin.waitForURL(/\/admin\/platform\/users\//), admin.getByRole('button', { name: 'Return to your account' }).click()]);
    const adminCookie = await sessionCookie(admin);
    // The page streams in: wait for the person's name.
    const backOnPage = await admin.locator('main:visible').getByText(memberName).first().waitFor().then(() => true, () => false);
    check('Return comes back to the admin’s own session, cookie and all', Boolean(adminCookie) && adminCookie.expires === -1 && backOnPage);
    await settle(admin, `/admin/platform/users/${memberUserId}?tab=signins`);
    const table = await admin.locator('[data-testid=user-sessions]').innerText();
    check('Sign-ins says how each session ended', table.includes('signed out by their organisation') && table.includes('ended by them'));
    await admin.getByTestId('sign-out-everywhere').click();
    await admin.locator('[role=dialog]:visible').getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
    await admin.getByText(/Signed out of \d+ sessions?\./).waitFor();
    check('every session of theirs ends', sql(`select count(*) from public.auth_sessions where user_id = ${quote(memberUserId)}`) === '0');
    check('by a platform admin, in the log', sql(`select count(*) from public.platform_audit_events where action = 'user.signout' and target_user_id = ${quote(memberUserId)}`) === '1');
  }

  // 11. Five wrong passwords from browsers the account hasn't been used on lock those for 15 minutes,
  // the right password included; a browser that has signed in before isn't stopped by them.
  step = 'lockout';
  // `kept` signs in once more: a Sign out everywhere before may have forgotten every browser.
  await kept.goto(`${BASE}/admin/logout`);
  await signIn(kept, memberEmail, password);
  await kept.goto(`${BASE}/admin/logout`);
  const guesser = await newPage();
  const lockKey = `signin-lock:user:${memberUserId}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) await signIn(guesser, memberEmail, `wrong-${attempt}`);
  check('four wrong passwords only say they don’t match', (await guesser.locator('body').innerText()).includes('don\'t match an account'));
  await signIn(guesser, memberEmail, 'wrong-5');
  check('the fifth locks new browsers out, and says so', (await guesser.locator('body').innerText()).includes('use a device you’ve signed in on before'));
  const lockMinutes = Number(sql(`select extract(epoch from (expires_at - now())) / 60 from public.rate_limits where key = ${quote(lockKey)}`));
  check('for 15 minutes from then', lockMinutes > 14 && lockMinutes <= 15, lockMinutes.toFixed(2));
  check('while locked, the right password is refused in a new browser', !(await signIn(await newPage(), memberEmail, password)));
  // A copied cookie with a changed signature isn't a remembered browser.
  const knownCookie = (await kept.context().cookies()).find((cookie) => cookie.name.startsWith('cai_known_'));
  const forged = await newPage();
  await forged.context().addCookies([{ ...knownCookie, value: knownCookie.value.replace(/.$/, (last) => (last === '0' ? '1' : '0')) }]);
  check('a forged remembered-browser cookie doesn’t get past the lock', !(await signIn(forged, memberEmail, password)));
  // `kept` has signed in to this account before: someone else's guessing can't keep its owner out.
  await kept.goto(`${BASE}/admin/logout`);
  check('a browser that signed in before still gets in', await signIn(kept, memberEmail, password));
  check('without ending the lock for new browsers', sql(`select count(*) from public.rate_limits where key = ${quote(lockKey)} and expires_at > now()`) === '1');
  // Its own wrong tries lock only it.
  await kept.goto(`${BASE}/admin/logout`);
  for (let attempt = 1; attempt <= 5; attempt += 1) await signIn(kept, memberEmail, `typo-${attempt}`);
  check('its own wrong tries lock that browser, and say so', (await kept.locator('body').innerText()).includes('Too many wrong tries here.'));
  check(
    'as its own lock',
    sql(`select count(*) from public.rate_limits where key like ${quote(`signin-lock:known:${memberUserId}:%`)} and count >= 5`) === '1'
  );
  sql(`update public.rate_limits set expires_at = now() - interval '1 second' where key like ${quote(`signin-lock:%:${memberUserId}%`)}`);
  check('once it runs out, the right password works in a new browser', await signIn(await newPage(), memberEmail, password));
  check('and signing in clears the count', sql(`select count(*) from public.rate_limits where key = ${quote(lockKey)}`) === '0');
  const nobody = `nobody-${run}@example.com`;
  for (let attempt = 1; attempt <= 5; attempt += 1) await signIn(guesser, nobody, `wrong-${attempt}`);
  check('an email without an account locks the same way (it never tells which have one)', (await guesser.locator('body').innerText()).includes('use a device you’ve signed in on before'));

  // 12. Sign out of all devices: every session ends, this one too, and no browser is remembered.
  step = 'all devices';
  sql(`delete from public.rate_limits where key like ${quote(`signin-lock:%:${memberUserId}%`)}`);
  const other = await newPage(FIREFOX_WINDOWS);
  await signIn(other, memberEmail, password);
  await signIn(kept, memberEmail, password, { keep: true });
  const versionBefore = Number(sql(`select known_browsers_version from public.users where id = ${quote(memberUserId)}`));
  await settle(kept, '/admin/profile');
  await kept.getByRole('button', { name: 'Sign out of all devices' }).click();
  const everywhereDialog = kept.locator('[role=dialog]:visible');
  check('it asks first, saying this browser goes too', (await everywhereDialog.innerText()).includes('this one too'));
  await Promise.all([kept.waitForURL(/\/admin\/login\?everywhere=1/), everywhereDialog.getByRole('button', { name: 'Sign out of all', exact: true }).click()]);
  // The address changes before the page has drawn: wait for the words.
  check('then the sign-in page says so', await kept.getByText('Signed out everywhere').first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  check(
    'every session of theirs has ended, by them',
    sql(`select count(*) from public.auth_sessions where user_id = ${quote(memberUserId)}`) === '0' &&
      sql(`select count(*) from public.user_sessions where user_id = ${quote(memberUserId)} and ended_reason = 'self' and revoked_at > now() - interval '1 minute'`) !== '0'
  );
  check('this browser’s session cookie is gone', !(await sessionCookie(kept)));
  await settle(other, '/admin');
  check('the other browser is asked to sign in', new URL(other.url()).pathname === '/admin/login');
  check('no browser is remembered any more', Number(sql(`select known_browsers_version from public.users where id = ${quote(memberUserId)}`)) === versionBefore + 1);
  // So guessing elsewhere now locks it out like any new browser, until it signs in again.
  for (let attempt = 1; attempt <= 5; attempt += 1) await signIn(guesser, memberEmail, `wrong-${attempt}`);
  check('a browser remembered before counts as new again', !(await signIn(kept, memberEmail, password)) && (await kept.locator('body').innerText()).includes('use a device you’ve signed in on before'));

  // 13. Touch screens: shared controls are at least 44px to hit (Apple's minimum); with a mouse they keep their size.
  step = 'touch targets';
  const phoneOwner = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  pages.push(phoneOwner);
  await signIn(phoneOwner, env.DEMO_EMAIL, env.DEMO_PASSWORD);
  await settle(phoneOwner, '/admin/team');
  const heightOf = (page, selector) => page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().height);
  const touchMenu = await heightOf(phoneOwner, 'button[aria-label^="More for"]:visible');
  const touchCompact = await heightOf(phoneOwner, '[data-testid=team-members] button:visible:has-text("Access")');
  check('on a touch screen the ⋯ and compact buttons are 44px', touchMenu >= 44 && touchCompact >= 44, `${touchMenu}, ${touchCompact}`);
  await settle(owner, '/admin/team');
  const mouseMenu = await heightOf(owner, 'button[aria-label^="More for"]:visible');
  check('with a mouse they keep their size', mouseMenu === 32, String(mouseMenu));

  // 14. Two-factor, by Better Auth: on from Profile (the password, the secret, a code, the backup
  // codes once), then signing in asks for a code (a wrong one refused), and off with the password.
  step = 'two-factor';
  sql(`delete from public.rate_limits where key like ${quote(`signin-lock:%:${memberUserId}%`)}`);
  const setter = await newPage();
  check('signing in before two-factor', await signIn(setter, memberEmail, password));
  await settle(setter, '/admin/profile');
  // Two-factor is a row of the Profile (Off ›): it opens the set-up steps.
  check('the two-factor row says it is off', (await setter.locator('[data-testid=two-factor-row]:visible').first().innerText()).includes('Off'));
  await setter.locator('[data-testid=two-factor-row]:visible').first().click();
  await setter.locator('#setup-totp-password').fill(password);
  await setter.getByRole('button', { name: 'Continue' }).click();
  const secret = (await setter.locator('code').filter({ hasText: /^[A-Z2-7]{16,}$/ }).first().innerText()).trim();
  await setter.locator('#confirm-totp-modal').fill(generateSync({ secret }));
  await setter.getByRole('button', { name: 'Enable' }).click();
  const codes = setter.getByTestId('totp-backup-codes');
  check('turning it on shows the backup codes, once', await codes.waitFor().then(() => true, () => false) && (await codes.locator('li').count()) >= 8);
  await setter.getByRole('button', { name: 'Done' }).click();
  check('it is on', sql(`select totp_enabled from public.users where id = ${quote(memberUserId)}`) === 't');
  check('…and its row says so', await setter.locator('[data-testid=two-factor-row]:visible', { hasText: 'On' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  const second = await newPage();
  await signIn(second, memberEmail, password);
  check('signing in now asks for a code', new URL(second.url()).pathname === '/admin/login/two-factor');
  await second.fill('#admin-totp-code', '000000');
  await second.click('button[type=submit]');
  check('a wrong code is refused', await second.getByText('That code was not valid').waitFor().then(() => true, () => false));
  await second.fill('#admin-totp-code', generateSync({ secret }));
  await Promise.all([second.waitForURL((url) => !url.pathname.startsWith('/admin/login')), second.click('button[type=submit]')]);
  check('the right one signs in', !new URL(second.url()).pathname.startsWith('/admin/login'));
  await settle(second, '/admin/profile');
  // Its row (On ›) opens Turn off; the row then says Off.
  await second.locator('[data-testid=two-factor-row]:visible').first().click();
  await second.locator('#disable-password-modal').fill(password);
  await second.getByRole('button', { name: 'Turn off two-factor' }).click();
  check(
    'turning it off takes the password, and its row says Off',
    await second.locator('[data-testid=two-factor-row]:visible', { hasText: 'Off' }).first().waitFor({ timeout: 15000 }).then(() => true, () => false) &&
      sql(`select totp_enabled from public.users where id = ${quote(memberUserId)}`) === 'f'
  );
} catch (error) {
  check(`unexpected error (at: ${step})`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `tests/e2e/.shots/sessions-fail-${index}.png` }).catch(() => {});
} finally {
  sql(`delete from public.platform_audit_events where target_user_id = ${quote(memberUserId)} or actor_id = ${quote(adminUserId)}`);
  sql(`delete from public.users where id in (${quote(memberUserId)}, ${quote(adminUserId)})`);
  sql(`delete from public.rate_limits where key like ${quote(`signin-lock:%:${memberUserId}%`)}`);
  await browser.close();
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
}
