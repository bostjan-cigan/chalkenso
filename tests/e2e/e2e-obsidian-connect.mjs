// Connecting an Obsidian vault, for someone new: Getting started lists it as an optional step, outside
// the count, that can be ticked as "not for me"; it leads to Settings → Tokens, whose card has the
// three steps (the plugin's download, a token, the server address); once the plugin has synced with a
// token, the card folds to "connected" and the step ticks itself.
// Needs open sign-up.
// node tests/e2e/e2e-obsidian-connect.mjs
import { chromium } from 'playwright-core';
import { BASE, signUp, signupOpen, skipSuite, sql } from './helpers.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const run = Date.now().toString(36);

if (!(await signupOpen())) {
  skipSuite('sign-up is closed: run it on the cloud or a local installation nobody has set up yet');
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.setDefaultTimeout(60000);
  const email = `obsidian-${run}@example.com`;
  await signUp(page, { email, password: `pw-${run}-secret`, organization: `Obsidian School ${run}`, name: 'Vera Vault' });
  const userId = sql(`select id from public.users where email = ${quote(email)}`);

  const ring = page.locator('[data-testid=getting-started]:visible');
  const panel = page.locator('[data-testid=getting-started-panel]:visible');
  const step = panel.locator('[data-testid=getting-started-obsidian]');
  const openPanel = async () => {
    await page.goto(`${BASE}/admin`);
    await ring.click();
    await panel.waitFor();
  };

  // Getting started: the step is there, last and optional, and doesn't count.
  await openPanel();
  check('Getting started has the Obsidian step, not done', (await step.getAttribute('data-done')) === 'false');
  const total = Number((await ring.getAttribute('aria-label')).match(/of (\d+)/)?.[1]);
  const listed = await panel.locator('li[data-testid^=getting-started-]').count();
  check("it isn't in the count", total === listed - 1, `${total} counted, ${listed} listed`);
  const lastTwo = await panel.locator('ul').first().evaluate((list) => [...list.children].slice(-2).map((item) => item.dataset.testid ?? item.textContent));
  check('it comes last, under its own heading', lastTwo[1] === 'getting-started-obsidian' && /Obsidian/.test(lastTwo[0] ?? ''), JSON.stringify(lastTwo));

  // Ticked by hand ("not for me"), it stays ticked; and it can be taken back.
  await step.locator('[role=checkbox]').click();
  const tickKey = `hidden:getting-started-obsidian:${userId}`;
  const ticked = () => sql(`select count(*) from public.settings where key = ${quote(tickKey)}`) === '1';
  for (let i = 0; i < 20 && !ticked(); i += 1) await page.waitForTimeout(250);
  await openPanel();
  check('ticked by hand, it stays ticked', (await step.getAttribute('data-done')) === 'true');
  await step.locator('[role=checkbox]').click();
  for (let i = 0; i < 20 && ticked(); i += 1) await page.waitForTimeout(250);
  await openPanel();
  check('and the tick can be taken back', (await step.getAttribute('data-done')) === 'false');

  // It leads to Settings → Tokens, with the three steps.
  await Promise.all([page.waitForURL((url) => url.pathname === '/admin/api-tokens'), step.locator('a').click()]);
  const card = page.locator('[data-testid=obsidian-connect]:visible');
  await card.waitFor();
  check('Settings → Tokens shows how to connect a vault', (await card.locator('ol > li').count()) === 3);
  const download = await card.getByRole('link', { name: 'Download the plugin' }).getAttribute('href');
  check("the download is the plugin's zip from its latest release", /\/releases\/latest\/download\/chalkenso-plugin\.zip$/.test(download ?? ''), download ?? 'no link');
  const server = await card.locator('ol > li').nth(2).locator('code').innerText();
  check("with this installation's address to paste", /^https?:\/\/\S+$/.test(server), server);
  check('and no "connected" yet', (await page.locator('[data-testid=obsidian-connected]:visible').count()) === 0);

  // A token, used by the plugin: connected.
  const tokenName = `Obsidian — test ${run}`;
  await page.fill('#api-token-name', tokenName);
  await page.getByRole('button', { name: 'Create token' }).click();
  await page.waitForFunction(() => /usr_[A-Za-z0-9_-]{10,}/.test(document.body.innerText));
  const token = (await page.locator('body').innerText()).match(/usr_[A-Za-z0-9_-]{10,}/)[0];
  const me = await page.request.get(`${BASE}/api/sync/me`, { headers: { Authorization: `Bearer ${token}` } });
  check('the plugin signs in with the token', me.status() === 200, String(me.status()));
  const used = () => sql(`select count(*) from public.api_tokens where name = ${quote(tokenName)} and last_used_at is not null`) === '1';
  for (let i = 0; i < 40 && !used(); i += 1) await page.waitForTimeout(250);
  await page.goto(`${BASE}/admin/api-tokens`);
  const connected = page.locator('[data-testid=obsidian-connected]:visible');
  await connected.waitFor();
  check('once it has synced, Tokens says the vault is connected', (await connected.innerText()).includes(tokenName));
  check('instead of the steps', (await card.locator('ol').count()) === 0);
  await openPanel();
  check('and Getting started ticks the step itself', (await step.getAttribute('data-done')) === 'true' && (await step.locator('[role=checkbox]').isDisabled()));
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
