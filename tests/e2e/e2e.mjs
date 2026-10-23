// End-to-end check of the core app: sign-up, course and lesson creation, Improve (AI), invites, a
// colleague editing the same lesson, team roles, and what other sign-ups may do (local: nothing, the
// installation has its owner).
// Needs open sign-up: a local installation nobody has set up yet.
// node tests/e2e/e2e.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { BASE, serverEdition, signUp, signupOpen, skipSuite, sql } from './helpers.mjs';

const SHOTS = new URL('./.shots/', import.meta.url).pathname;
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!(await signupOpen())) {
  skipSuite('sign-up is closed: run it on the live cloud site or a local installation nobody has set up yet');
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  return { ctx, page };
}

const edition = await serverEdition();

try {
  // 0. Local: a new installation has nobody to sign in yet, so signing in leads to setting it up
  // (in a browser: the sign-in page streams in after a loading state, so the redirect is inside it).
  if (edition === 'local') {
    const { ctx, page } = await newPage();
    await page.goto(BASE + '/');
    await page.waitForURL((url) => url.pathname === '/signup', { timeout: 30000 }).catch(() => {});
    check('local: opening a new installation leads to setting it up', new URL(page.url()).pathname === '/signup', page.url());
    await ctx.close();
  }

  // 1. Sign up a new organisation (owner A); in the local edition, this sets up the installation
  const ownerEmail = `owner-${run}@example.com`;
  const password = `pw-${run}-secret`;
  const { ctx: ctxA, page: a } = await newPage();
  await signUp(a, { email: ownerEmail, password, organization: `Test School ${run}`, plan: 'studio', name: 'Olga Owner' });
  check('sign-up lands on the dashboard', a.url().includes('/admin'), a.url());
  // Getting started: a ring in the corner, closed, with a note in red pen pointing at it on Home.
  const ring = a.locator('[data-testid=getting-started]:visible');
  await ring.waitFor();
  check(
    'Home has Getting started in the corner, closed, with a note pointing at it',
    (await a.locator('[data-testid=getting-started-panel]:visible').count()) === 0 && (await a.locator('[data-testid=getting-started-hint]:visible').count()) === 1
  );
  await ring.click();
  const checklist = a.locator('[data-testid=getting-started-panel]:visible');
  const stepDone = (id) => checklist.locator(`[data-testid=getting-started-${id}]`).getAttribute('data-done');
  check(
    'it opens the steps: the account done, the course to do',
    (await stepDone('account')) === 'true' && (await stepDone('course')) === 'false' && (await a.locator('[data-testid=getting-started-hint]:visible').count()) === 0
  );
  // A step ticked by hand is kept, and ticked again it comes back.
  const ownerId = sql(`select id from public.users where email = ${quote(ownerEmail)}`);
  const groupTicked = () => sql(`select count(*) from public.settings where key = ${quote(`hidden:getting-started-group:${ownerId}`)}`) === '1';
  const until = async (test) => {
    for (let i = 0; i < 20; i++) {
      if (test()) return true;
      await a.waitForTimeout(300);
    }
    return false;
  };
  await checklist.locator('[data-testid=getting-started-group] [role=checkbox]').click();
  check('a step ticked by hand is kept', (await stepDone('group')) === 'true' && (await until(groupTicked)));
  await checklist.locator('[data-testid=getting-started-group] [role=checkbox]').click();
  check('and unticked, it comes back', (await stepDone('group')) === 'false' && (await until(() => !groupTicked())));
  // Hidden, it's gone from every page; Home offers it back.
  await checklist.locator('[data-testid=getting-started-hide]').click();
  await a.waitForTimeout(800);
  await a.reload();
  await a.waitForLoadState('networkidle').catch(() => {});
  check('hidden, Getting started stays hidden', (await ring.count()) === 0 && (await a.locator('[data-testid=getting-started-show]:visible').count()) === 1);
  await a.locator('[data-testid=getting-started-show]:visible').click();
  check('and Home brings it back', await ring.waitFor({ timeout: 15000 }).then(() => true, () => false));

  // 3. Create a course
  await a.goto(BASE + '/admin/courses/new');
  await a.fill('#course-title', `Data Basics ${run}`);
  await a.fill('#course-summary', 'Spreadsheets to SQL for adult learners.');
  await Promise.all([a.waitForURL(/\/admin\/courses\/(?!new)[^/?]+(\?|$)/), a.click('button[type=submit]')]);
  const courseUrl = a.url().split('?')[0];
  const courseId = courseUrl.split('/').pop();
  check('course created', Boolean(courseId) && courseId !== 'new', courseUrl);

  // 4. Add a lesson to the course's first version (its Lessons tab)
  const newLessonHref = await a.locator('a[href*="/lessons/new"]').first().getAttribute('href');
  await a.goto(BASE + newLessonHref);
  // Developers can write Markdown directly; everyone else uses the visual editor (below).
  await a.getByRole('button', { name: 'Markdown', exact: true }).click();
  await a.fill('#lesson-title', 'Your first query');
  await a.fill('#lesson-markdown', '## Select\n\nA SELECT statement reads rows from a table.\n\n## Filter\n\nWHERE keeps only the rows you need.');
  await Promise.all([a.waitForURL(/\/lessons\/(?!new)[^/?]+/), a.click('#lesson-editor button[type=submit]')]);
  const lessonUrl = a.url().split('?')[0];
  check('lesson created', /\/lessons\/(?!new)/.test(lessonUrl), lessonUrl);

  // 5. Improve with AI (mock): something to change goes into the lesson's improvement, which is planned,
  // its changes drafted and edited, and saved
  await a.goto(lessonUrl);
  await a.getByRole('button', { name: 'Visual', exact: true }).click();
  await a.waitForSelector('[data-testid=lesson-document] >> text=A SELECT statement reads rows');
  check('visual editor shows the lesson', true);
  check('Edit mode has no AI in its toolbar', (await a.locator('[data-testid=revise-control]').count()) === 0);
  await a.goto(lessonUrl + '/improvements?new=1');
  await a.fill('[data-testid=new-improvement-why]', 'Add a check-your-work step for learners.');
  await a.click('[data-testid=create-improvement]');
  await a.waitForSelector('[data-testid=plan-with-ai]');
  check('the lesson’s improvement starts with an empty plan, and nothing to change yet', (await a.locator('[data-testid=draft-changes]').count()) === 0);
  await a.click('[data-testid=plan-with-ai]');
  await a.waitForFunction(() => ((document.querySelector('[data-testid=plan-box] .ProseMirror')?.textContent || document.querySelector('[data-testid=plan-box] textarea')?.value || '')).trim().length > 0, null, { timeout: 30000 });
  await a.click('[data-testid=save-plan]');
  // The plan step has its own rows already: wait for the drafting step itself.
  const drafting = await a.waitForSelector('[data-testid=draft-changes]', { timeout: 30000 }).then(() => true, () => false);
  check('the plan is saved, and changes can be drafted', drafting && (await a.locator('[data-testid=draft-changes]').count()) === 1);
  await a.click('[data-testid=draft-changes]');
  await a.waitForSelector('[data-testid=inline-change]', { timeout: 30000 });
  const change = a.locator('[data-testid=inline-change]').first();
  check('AI drafted changes, in place in the lesson', (await a.locator('[data-testid=inline-change]').count()) >= 1);
  check('each is marked in the lesson, numbered', ((await change.getAttribute('aria-label')) ?? '').startsWith('Change 1 of'));
  check('nothing changed in the lesson yet', !sql(`select markdown_content from courses.lessons where id = '${lessonUrl.split('/').pop()}'`).includes('Check your work'));
  await a.screenshot({ path: SHOTS + 'ai-revision.png', fullPage: false });
  // Opened side by side: skipped, it shows the lesson as it is; kept again and rewritten by hand, it's yours.
  await change.click();
  const sheet = a.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Skip', exact: true }).click();
  check('a skipped change shows the lesson as it is', (await change.getAttribute('data-decision')) === 'skip');
  await sheet.getByRole('button', { name: 'Keep', exact: true }).click();
  await sheet.locator('[data-testid=edit-change]').click();
  await sheet.getByRole('button', { name: 'Markdown', exact: true }).click();
  await sheet.locator('textarea').fill('> [!tip] Check your work\n> Run the query and count the rows it returns.');
  await sheet.getByRole('button', { name: 'Visual', exact: true }).click();
  await a.click('[data-testid=keep-edited]');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  check('the edited suggestion is kept as yours', ((await a.locator('[data-testid=inline-change]').first().getAttribute('aria-label')) ?? '').includes('Your version'));
  // Saving is the review's last step.
  await a.click('[data-testid=apply-improvement]');
  await a.waitForSelector('[data-testid=see-what-changed]', { timeout: 15000 });
  check('AI revision saved, as edited', sql(`select markdown_content from courses.lessons where id = '${lessonUrl.split('/').pop()}'`).includes('count the rows it returns'));
  await a.click('[data-testid=see-what-changed]');
  await a.waitForSelector('[data-testid=what-changed]');
  check('See what changed shows the change, who saved it and when', (await a.locator('[data-testid=what-changed]').innerText()).includes('count the rows it returns') && (await a.locator('[data-testid=record-status]').count()) >= 1);

  // 6. Invite a colleague (local: the manager invites instructors only).
  await a.goto(BASE + '/admin/team');
  // Invite opens its sheet from the members' card.
  await a.locator('[data-testid=team-invite]:visible').first().click();
  await a.waitForSelector('#invite-label:visible');
  check(
    edition === 'local' ? 'local: invites make instructors, no role to choose' : 'cloud: invites offer member or admin',
    edition === 'local'
      ? (await a.locator('#invite-role').count()) === 0 && (await a.locator('main:visible').innerText()).includes('They join as an instructor')
      : await (async () => {
          // Our own dropdown: the options exist only while it is open.
          await a.click('#invite-role:visible');
          const roles = (await a.locator('[role=option]:visible').allInnerTexts()).join('|');
          // Picked, not Escape: Escape would close the invite sheet too.
          await a.locator('[role=option]:visible', { hasText: 'Member' }).first().click();
          return roles.includes('Admin');
        })()
  );
  await a.fill('#invite-label:visible', 'Colleague');
  await a.getByRole('button', { name: 'Create invite link' }).click();
  await a.waitForSelector('[data-testid=invite-link]');
  const inviteLink = (await a.locator('[data-testid=invite-link]').innerText()).trim();
  check('invite link created', inviteLink.includes('/invite/'), inviteLink.replace(/[a-f0-9]{20,}/, '…'));

  // 7. Colleague signs up through the invite and edits the same lesson
  const { ctx: ctxB, page: b } = await newPage();
  await b.goto(inviteLink.replace(/^https?:\/\/[^/]+/, BASE));
  check('the invite says the role', (await b.content()).includes(edition === 'local' ? 'as an instructor' : 'as a member'));
  await b.fill('#invite-name', 'Cara Colleague');
  await b.fill('#invite-email', `colleague-${run}@example.com`);
  await b.fill('#invite-password', password);
  await Promise.all([b.waitForURL(/\/admin/), b.getByRole('button', { name: /Create account and join/ }).click()]);
  check('colleague joined via invite', b.url().includes('/admin'), b.url());
  await b.goto(lessonUrl);
  const colleagueSees = (await b.inputValue('#lesson-markdown').catch(() => '')).includes('Check your work');
  check('colleague can open the shared lesson', colleagueSees);
  // The colleague edits in the visual editor: a new heading and paragraph at the end.
  await b.locator('[data-testid=lesson-document] p', { hasText: 'WHERE keeps only' }).first().click();
  await b.keyboard.press('End');
  await b.keyboard.press('Enter');
  await b.keyboard.type('## Practice');
  await b.keyboard.press('Enter');
  await b.keyboard.type('Write a query that lists every customer.');
  await b.click('#lesson-editor button[type=submit]');
  await b.waitForTimeout(2500);
  await a.goto(lessonUrl);
  check("owner sees the colleague's edit", (await a.inputValue('#lesson-markdown')).includes('## Practice'));
  await a.goto(BASE + '/admin/team');
  // The page streams in after a loading state: wait for the list itself.
  await a.waitForSelector('[data-testid=team-members]:visible li');
  check('team lists both people', (await a.locator('[data-testid=team-members]:visible li').count()) === 2);
  if (edition === 'local') {
    const team = await a.locator('[data-testid=team-members]:visible').innerText();
    check(
      'local: one manager and instructors, roles stay as they are',
      team.includes('Manager') && team.includes('Instructor') && (await a.locator('[data-testid=team-members]:visible button[aria-haspopup=listbox]').count()) === 0
    );
  }

  // 8. Team member cannot open team management
  // The guard redirects while the page streams, so the redirect can land after `goto` resolves.
  // The redirect can interrupt the navigation itself (ERR_ABORTED); what matters is where we end up.
  await b.goto(BASE + '/admin/team').catch(() => null);
  await b.waitForURL((url) => !url.pathname.startsWith('/admin/team'), { timeout: 15000 }).catch(() => {});
  check('members cannot manage the team', !b.url().includes('/admin/team'), b.url());
  // Members have Settings of their own, never the organisation's: locally it opens on their sync tokens.
  const memberSettings = edition === 'cloud' ? '/admin/settings/claude' : '/admin/api-tokens';
  await b.goto(BASE + '/admin/settings').catch(() => null);
  await b.waitForURL((url) => url.pathname.startsWith(memberSettings), { timeout: 15000 }).catch(() => {});
  check(
    `members’ Settings opens on ${edition === 'cloud' ? 'Use with Claude' : 'their Tokens'}, not the organisation’s settings`,
    b.url().includes(memberSettings) && (await b.locator('a[href="/admin/settings/ai"]').count()) === 0,
    b.url()
  );
  await a.goto(BASE + '/admin/settings');
  // The page streams in after a loading state: wait for the form itself.
  await a.waitForSelector('#organization-name:visible');
  check('owners have Settings: the organisation name', (await a.locator('nav a[href="/admin/settings"]').count()) > 0);
  // The organisation's look: an icon on a colour, or its logo (sidebar card and switcher).
  await a.locator('[data-testid=org-identity]:visible [role=radio][aria-label="School"]').click();
  await a.locator('[data-testid=org-identity]:visible [role=radio][aria-label="Teal"]').click();
  check(
    'an icon and colour picked in Settings show in the sidebar',
    await a.locator('aside [data-testid=org-badge][data-icon=school]').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  );
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await a.setInputFiles('[data-testid=org-logo-input]', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await a.getByRole('button', { name: 'Save logo' }).click();
  check('an SVG logo is refused', await a.getByText('Use a PNG, JPG or WEBP image.').first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  await a.setInputFiles('[data-testid=org-logo-input]', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await a.getByRole('button', { name: 'Save logo' }).click();
  const logo = a.locator('aside [data-testid=org-badge] img').first();
  const logoShown = await logo.waitFor({ timeout: 15000 }).then(() => true, () => false);
  const logoSrc = logoShown ? await logo.getAttribute('src') : '';
  const logoResponse = logoSrc ? await a.request.get(BASE + logoSrc) : null;
  check('a logo replaces the icon in the sidebar', logoShown && logoResponse?.status() === 200 && /image\/png/.test(logoResponse.headers()['content-type'] ?? ''));
  await a.getByRole('button', { name: 'Remove logo' }).click();
  check('removing the logo brings the icon back', await a.locator('aside [data-testid=org-badge][data-icon=school]').first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  check('the Team page is about people only', await (async () => {
    await a.goto(BASE + '/admin/team');
    await a.waitForSelector('[data-testid=team-members]:visible li');
    return (await a.locator('#organization-name, [data-testid=ai-key]').count()) === 0;
  })());

  // 9. Someone else signs up.
  // Local: the installation already has its owner, so sign-up is closed.
  const { ctx: ctxC, page: c } = await newPage();
  if (edition === 'local') {
    await c.goto(BASE + '/signup');
    check('local: sign-up is closed once the installation is set up', (await c.locator('#signup-email').count()) === 0 && (await c.content()).includes('This installation is set up'));
    const home = await fetch(BASE + '/', { redirect: 'manual' });
    check('local: no landing page, the home page is signing in', home.status === 307 && home.headers.get('location')?.endsWith('/admin/login'), String(home.status));
    // Not there (the public repository), or sent to the app or "not found" (the local edition built
    // from the private one; under a loading state, "not found" arrives in a 200 response).
    const notServed = async (path) => {
      const response = await fetch(BASE + path, { redirect: 'manual' });
      const location = new URL(response.headers.get('location') ?? '/', BASE).pathname;
      return (
        response.status === 404 ||
        (response.status >= 300 && response.status < 400 && location.startsWith('/admin')) ||
        (response.status === 200 && (await response.text()).includes('NEXT_HTTP_ERROR_FALLBACK;404'))
      );
    };
    check('local: no website pages', (await notServed('/pricing')) && (await notServed('/waitlist')) && (await notServed('/pilot')));
    check('local: no superadmin page', await notServed('/admin/platform'));
    // One organisation per installation: nothing creates, joins, leaves or deletes another.
    check(
      'local: one organisation, with no page to create another',
      (await notServed('/admin/organizations/new')) && sql('SELECT count(*) FROM public.organizations') === '1'
    );
    await a.goto(BASE + '/admin');
    await a.locator('#org-switcher:visible').first().click();
    const localMenu = await a.locator('[role=menu]:visible').innerText();
    check(
      'local: the organisation card offers no create, join or leave',
      localMenu.includes('Organisation settings') && !/Create organisation|Join another|Leave /.test(localMenu),
      localMenu
    );
    await a.keyboard.press('Escape');
    await a.goto(BASE + '/admin/settings');
    await a.waitForSelector('#organization-name:visible');
    check('local: no deleting the organisation', (await a.locator('[data-testid=danger-zone]').count()) === 0);
    check(
      'local: no website API, docs or Website page',
      (await fetch(BASE + '/api/v1/courses')).status === 404 &&
        (await fetch(BASE + '/llms.txt')).status === 404 &&
        (await notServed('/docs/website')) &&
        (await notServed('/admin/website')) &&
        (await a.locator('nav a[href="/admin/website"]').count()) === 0
    );

    // Bring your own AI key: stored encrypted, shown only by its last four characters
    const fakeKey = `sk-ant-e2e-${run}-0000000000wxyz`;
    await a.goto(BASE + '/admin/settings/ai');
    await a.waitForSelector('[data-testid=ai-key]:visible >> text="Not active"');
    await a.click('[data-testid=ai-key-set]:visible');
    await a.fill('#ai-api-key:visible', fakeKey);
    await a.getByRole('button', { name: 'Save key' }).click();
    await a.waitForSelector('[data-testid=ai-key]:visible >> text="Active"');
    const stored = sql(`SELECT coalesce(ai_api_key_encrypted, '') || '|' || coalesce(ai_api_key_hint, '') FROM public.organizations WHERE name = 'Test School ${run}'`);
    check('local: an organisation can add its own AI key, stored encrypted', stored.endsWith('|wxyz') && !stored.includes(fakeKey) && stored.length > 40);
    await a.reload();
    await a.waitForSelector('[data-testid=ai-key]:visible');
    check('local: the key is shown only by its end', (await a.locator('[data-testid=ai-key]:visible').innerText()).includes('…wxyz') && !(await a.content()).includes(fakeKey));
    await a.click('[data-testid=ai-key-remove]:visible');
    await a.getByRole('dialog').getByRole('button', { name: 'Remove key' }).click();
    await a.waitForSelector('[data-testid=ai-key]:visible >> text="Not active"');
    check('local: and remove it', sql(`SELECT count(*) FROM public.organizations WHERE name = 'Test School ${run}' AND ai_api_key_encrypted IS NULL`) === '1');
    check('local: Settings has no Use with Claude tab', (await a.locator('a[href="/admin/settings/claude"]').count()) === 0);
    // Under the admin loading state, "not found" arrives in a 200 response with Next's 404 marker.
    const claudeSettings = await a.request.get(BASE + '/admin/settings/claude');
    const claudeHtml = await claudeSettings.text();
    check(
      'local: and no such page',
      (claudeSettings.status() === 404 || claudeHtml.includes('NEXT_HTTP_ERROR_FALLBACK;404')) && !claudeHtml.includes('connector-settings'),
      String(claudeSettings.status())
    );
    await a.goto(courseUrl);
    // The page streams in: read the visible strip once it is there.
    const courseTabs = await a.locator('nav[aria-label=Course]:visible').first().innerText();
    check('local: a course has Lessons, Groups, Feedback and Settings, no Insights tab', /Lessons[\s\S]*Groups[\s\S]*Feedback[\s\S]*Settings/.test(courseTabs) && !courseTabs.includes('Insights'), courseTabs.replace(/\s+/g, ' '));
  } else {
    await signUp(c, { email: `other-${run}@example.com`, password, organization: `Other Org ${run}`, name: 'Other Owner' });
    const foreign = await c.goto(courseUrl);
    const foreignBody = await c.content();
    await c.screenshot({ path: SHOTS + 'foreign-course.png', fullPage: true });
    check('other organisation cannot open the course', foreign.status() === 404 || !foreignBody.includes(`Data Basics ${run}`), String(foreign.status()));
    const foreignLesson = await c.goto(lessonUrl);
    const foreignLessonBody = await c.content();
    await c.screenshot({ path: SHOTS + 'foreign-lesson.png', fullPage: true });
    check('other organisation cannot open the lesson', foreignLesson.status() === 404 || !foreignLessonBody.includes('Your first query'), String(foreignLesson.status()));
    await c.goto(BASE + '/admin/courses');
    check('other organisation course list is empty of foreign courses', !(await c.content()).includes(`Data Basics ${run}`));
    const apiProbe = await c.request.get(`${BASE}/api/team/comment?lessonId=${lessonUrl.split('/').pop()}`);
    check('team comment API returns nothing across organisations', (await apiProbe.json()).comments.length === 0);
    await c.goto(BASE + '/admin/platform').catch(() => null);
    await c.waitForURL((url) => !url.pathname.startsWith('/admin/platform'), { timeout: 15000 }).catch(() => {});
    check('platform page is only for the platform admin', !c.url().includes('/admin/platform'), c.url());
    await a.goto(BASE + '/admin/settings/ai');
    await a.waitForSelector('[data-testid=ai-plan-usage]:visible');
    check(
      'cloud: Settings → AI shows the free group’s AI, and the own key on Team and Academy',
      (await a.locator('[data-testid=ai-plan-usage]:visible').innerText()).includes('for your free group') && (await a.locator('[data-testid=ai-key-not-in-plan]:visible').count()) === 1
    );
    await a.goto(BASE + '/admin/settings/claude');
    check(
      'cloud: Settings → Use with Claude',
      await a.waitForSelector('[data-testid=connector-settings]:visible', { timeout: 15000 }).then(() => true, () => false)
    );
  }

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
} catch (error) {
  check('unexpected error', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
