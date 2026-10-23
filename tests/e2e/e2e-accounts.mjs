// Accounts and email (both editions): an invite emailed from the Team page arrives and works; signing up
// from it takes a handle; "Forgot your password?" emails a link (the same answer for an unknown email),
// the link sets a new password once, ends every session and the old password stops working. Needs email
// to Mailpit (SMTP_HOST set; `yarn mail:up`), the demo seed and a server (yarn dev, or BASE_URL).
// node tests/e2e/e2e-accounts.mjs
import { chromium } from 'playwright-core';
import { BASE, env, latestEmail, linkIn, mailOn, skipSuite, sql } from './helpers.mjs';

if (!(await mailOn())) {
  skipSuite('email isn’t going to Mailpit (set SMTP_HOST and run yarn mail:up)');
}

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const run = Date.now().toString(36);
const email = `acct-${run}@example.com`;
const name = `Iva Invited ${run}`;
const handle = `iva-${run}`;
const firstPassword = `First-${run}-password`;
const secondPassword = `Second-${run}-password`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const pages = [];
let step = 'start';
async function newPage() {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  pages.push(page);
  page.setDefaultTimeout(30000);
  return page;
}
async function signIn(page, identifier, password) {
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', identifier);
  await page.fill('#admin-password', password);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle').catch(() => {});
  return !new URL(page.url()).pathname.startsWith('/admin/login');
}

try {
  // 1. An invite, emailed from the Team page.
  step = 'invite by email';
  const owner = await newPage();
  await signIn(owner, env.DEMO_EMAIL, env.DEMO_PASSWORD);
  await owner.goto(`${BASE}/admin/team`);
  // Invite opens its sheet from the members' card.
  await owner.locator('[data-testid=team-invite]').locator('visible=true').first().click();
  await owner.locator('#invite-label').locator('visible=true').first().fill(name);
  await owner.locator('[data-testid=invite-delivery-email]').locator('visible=true').first().click();
  await owner.locator('#invite-email').locator('visible=true').first().fill(email);
  await owner.getByRole('button', { name: 'Send invite' }).locator('visible=true').first().click();
  await owner.locator('[data-testid=invite-link]').locator('visible=true').first().waitFor();
  check('the Team page says the invite was emailed', (await owner.locator('body').innerText()).includes(`Invite emailed to ${email}`));
  const invite = await latestEmail(email, { subject: 'invited you' });
  const inviteLink = linkIn(invite?.text, '/invite/');
  check('the invite email arrives with its link', Boolean(inviteLink), invite?.subject);
  check('the invite records where it went', sql(`select count(*) from public.user_invites where email = ${quote(email)} and emailed_at is not null`) === '1');

  // 2. Signing up from it, with a handle.
  step = 'sign up from the invite';
  const invited = await newPage();
  await invited.goto(inviteLink.replace(/^https?:\/\/[^/]+/, BASE));
  await invited.fill('#invite-name', name);
  await invited.fill('#invite-handle', handle);
  await invited.fill('#invite-email', email);
  await invited.fill('#invite-password', firstPassword);
  await Promise.all([invited.waitForURL(/\/admin/), invited.getByRole('button', { name: /Create account and join/ }).click()]);
  check('signing up from an invite keeps their handle', sql(`select handle from public.users where email = ${quote(email)}`) === handle);

  // 3. Forgot the password.
  step = 'forgot password';
  const visitor = await newPage();
  await visitor.goto(`${BASE}/admin/login`);
  // Beside the form, a learning quote or bit of trivia in the red-pen hand; "Another one" draws the next.
  const noteBefore = await visitor.getByTestId('learning-note').textContent();
  await visitor.getByRole('button', { name: 'Another one' }).click();
  await visitor.waitForFunction((before) => document.querySelector('[data-testid=learning-note]')?.textContent !== before, noteBefore);
  const noteFont = await visitor.getByTestId('learning-note').locator('blockquote, p:last-child').first().evaluate((node) => getComputedStyle(node).fontFamily);
  check('sign-in shows a learning note, and Another one draws the next', Boolean(noteBefore?.trim()) && /caveat/i.test(noteFont), noteFont);
  await visitor.getByRole('link', { name: 'Forgot your password?' }).click();
  await visitor.fill('#forgot-email', `nobody-${run}@example.com`);
  await visitor.getByRole('button', { name: 'Email me a link' }).click();
  await visitor.waitForSelector('[data-testid=reset-sent]');
  check('an unknown email gets the same answer', true);
  check('and no email', (await latestEmail(`nobody-${run}@example.com`, { timeout: 3000 })) === null);
  await visitor.goto(`${BASE}/admin/forgot-password`);
  await visitor.fill('#forgot-email', email.toUpperCase());
  await visitor.getByRole('button', { name: 'Email me a link' }).click();
  await visitor.waitForSelector('[data-testid=reset-sent]');
  const reset = await latestEmail(email, { subject: 'Reset your' });
  const resetLink = linkIn(reset?.text, '/admin/reset-password');
  check('the reset email arrives (any case of the address)', Boolean(resetLink), reset?.subject);
  check('in the one template (the logo), unsigned', reset?.html?.includes('/brand/chalkenso-email-logo.png') && !reset.html.includes('Boštjan'));

  // 4. Setting the new password.
  step = 'reset password';
  await visitor.goto(resetLink.replace(/^https?:\/\/[^/]+/, BASE));
  await visitor.fill('#reset-password', secondPassword);
  await visitor.fill('#reset-confirm', `${secondPassword}x`);
  await visitor.getByRole('button', { name: 'Set the new password' }).click();
  check('two different passwords are refused', await visitor.getByText('The two passwords are different.').waitFor().then(() => true, () => false));
  await visitor.fill('#reset-confirm', secondPassword);
  await Promise.all([visitor.waitForURL(/\/admin\/login\?reset=1/), visitor.getByRole('button', { name: 'Set the new password' }).click()]);
  check('then it says the new password is set', await visitor.getByText('Your new password is set').waitFor().then(() => true, () => false));
  await invited.goto(`${BASE}/admin`);
  // The page streams in: its guard's redirect can land a moment later.
  const endedEverywhere = await invited.waitForURL(/\/admin\/login/, { timeout: 15000 }).then(() => true, () => false);
  check('every session ended', endedEverywhere, invited.url());
  check('the old password no longer works', !(await signIn(await newPage(), email, firstPassword)));
  check('the new one does', await signIn(await newPage(), email, secondPassword));
  const again = await newPage();
  await again.goto(resetLink.replace(/^https?:\/\/[^/]+/, BASE));
  check('the reset link works once', (await again.locator('body').innerText()).includes('This link no longer works'));
} catch (error) {
  check(`unexpected error (at: ${step})`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `tests/e2e/.shots/accounts-fail-${index}.png` }).catch(() => {});
} finally {
  sql(`delete from public.users where email = ${quote(email)}`);
  sql(`delete from public.user_invites where email = ${quote(email)} or label = ${quote(name)}`);
  await browser.close();
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
}
