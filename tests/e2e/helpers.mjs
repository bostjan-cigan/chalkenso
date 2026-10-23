// Shared by the end-to-end suites: where the server is, the settings they sign in with, and SQL
// against the test database (through the Postgres container from docker-compose.yml).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const BASE = process.env.BASE_URL || 'http://localhost:3100';

/** `.env.local` (when there is one), overridden by the process environment. */
export const env = {
  ...(existsSync('.env.local')
    ? Object.fromEntries(
        readFileSync('.env.local', 'utf8')
          .split('\n')
          .filter((line) => /^[A-Z_]+=/.test(line))
          .map((line) => [line.split('=')[0], line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '')])
      )
    : {}),
  ...process.env,
};

const container = env.E2E_PG_CONTAINER || 'curriculum-ai-postgres';
const database = env.E2E_DB || env.POSTGRES_DB || 'curriculum_ai';
const user = env.POSTGRES_USER || 'postgres';

/**
 * One SQL statement through psql in the Postgres container. No shell in between: values may hold
 * backticks, `$` or quotes (lesson text does), and must reach psql exactly as written.
 */
export function sql(query) {
  return execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', database, '-Atc', query.trim()]).toString().trim();
}

/** `local` when the home page sends people into the app (the local edition has no landing page). */
export async function serverEdition() {
  const response = await fetch(`${BASE}/`, { redirect: 'manual' });
  return response.status >= 300 &&
    response.status < 400 &&
    new URL(response.headers.get('location') ?? '/', BASE).pathname.startsWith('/admin')
    ? 'local'
    : 'cloud';
}

/** Whether /signup takes new accounts (closed on a local installation that has its owner). */
export async function signupOpen() {
  const response = await fetch(`${BASE}/signup?plan=solo`, { redirect: 'manual' });
  return response.status === 200 && (await response.text()).includes('id="signup-email"');
}

/**
 * Signing up through /signup's two steps: the email and a password; then the organisation and the
 * handles, as suggested unless given. Then into the app (`waitForApp`), and their name set as Profile
 * would (sign-up asks for none). With `trap`, the hidden field is filled in, as a bot would. Returns
 * nothing; on a refusal the form says why.
 */
export async function signUp(page, { email, password, organization, plan = 'solo', handle, organizationHandle, name, trap = false, waitForApp = true }) {
  await page.goto(`${BASE}/signup?plan=${plan}`);
  await page.fill('#signup-email', email);
  await page.fill('#signup-password', password);
  await page.click('[data-testid=signup-continue]');
  await page.fill('#signup-organization', organization);
  if (handle) await page.fill('#signup-handle', handle);
  if (organizationHandle) await page.fill('#signup-organization-handle', organizationHandle);
  if (trap) await page.evaluate(() => (document.querySelector('input[name=website]').value = 'https://spam.example'));
  if (waitForApp) {
    await Promise.all([page.waitForURL((url) => url.pathname.startsWith('/admin')), page.click('[data-testid=signup-submit]')]);
  } else {
    await page.click('[data-testid=signup-submit]');
  }
  if (name && waitForApp) {
    const [first, ...rest] = name.split(' ');
    const quoted = (value) => `'${String(value).replace(/'/g, "''")}'`;
    sql(`update public.users set first_name = ${quoted(first)}, last_name = ${rest.length ? quoted(rest.join(' ')) : 'null'}, name = ${quoted(name)} where email = ${quoted(email.toLowerCase())}`);
  }
}

/** Ends a suite that can't run against this server, saying why (the runner counts it as skipped). */
export function skipSuite(reason) {
  console.log(`SKIPPED  ${reason}`);
  process.exit(0);
}

/** Mailpit (`yarn mail:up`): where the server sends email in the tests (SMTP_HOST set). */
export const MAILPIT = env.MAILPIT_URL || 'http://localhost:8025';

/** Whether this run sends email to Mailpit: the server's SMTP is set and Mailpit answers. */
export async function mailOn() {
  if (!env.SMTP_HOST) return false;
  return fetch(`${MAILPIT}/api/v1/info`).then((response) => response.ok, () => false);
}

/**
 * The newest email to `to` (optionally whose subject contains `subject`), waiting for it to arrive:
 * `{ subject, text, html, replyTo }`, or null after `timeout`.
 */
export async function latestEmail(to, { subject = '', timeout = 20000 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((response) => response.json(), () => null);
    const found = (search?.messages ?? []).find((message) => !subject || message.Subject.includes(subject));
    if (found) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${found.ID}`).then((response) => response.json());
      return { subject: message.Subject, text: message.Text, html: message.HTML, replyTo: (message.ReplyTo ?? []).map((entry) => entry.Address) };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** The first link in an email's text whose address contains `path`. */
export function linkIn(text, path) {
  return (text ?? '').match(new RegExp(`https?://[^\\s]*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s]*`))?.[0] ?? null;
}

/** On the Team page: one of a member's ⋯ actions ("Sign out…", "Remove from the team…"), confirmed in its dialog. */
export async function teamMemberAction(page, name, item, confirm) {
  await page.locator(`button[aria-label="More for ${name}"]:visible`).first().click();
  await page.getByRole('menuitem', { name: item }).click();
  await page.locator('[role=dialog]:visible').getByRole('button', { name: confirm, exact: true }).click();
}
