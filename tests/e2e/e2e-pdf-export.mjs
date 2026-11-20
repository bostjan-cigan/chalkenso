// End-to-end check of PDF export for learners, on the demo organisation (`yarn db:seed-demo` first):
// off by default (no button on a learner's page); switched on for a curriculum version, its groups'
// learners get Download PDF; a group's own answer wins over its version's; the whole course and one
// lesson download as PDF files, named after them. What it switches is put back at the end.
// node tests/e2e/e2e-pdf-export.mjs
// PDF_SAMPLES=<folder> also saves the PDFs of the team's preview (PDF_VERSION: of which version).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE, env, sql } from './helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const samples = process.env.PDF_SAMPLES || '';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
if (process.env.PDF_DEBUG) {
  page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 600)));
  page.on('console', (message) => (message.type() === 'error' ? console.log('console:', message.text().slice(0, 600)) : null));
}

// A group that reads one of the course's own versions (not its own copy), and a learner's link to it.
const [groupId, versionId, courseId, token] = sql(
  "select g.id || '|' || v.id || '|' || v.course_id || '|' || l.token from courses.course_groups g join courses.curriculum_versions v on v.id = g.curriculum_version_id and v.owner_group_id is null join courses.courses c on c.id = v.course_id join public.organizations o on o.id = c.organization_id join courses.course_group_members m on m.group_id = g.id join courses.access_links l on l.member_id = m.id and l.revoked_at is null and l.expires_at > now() where o.slug = 'northwind-academy' limit 1"
).split('|');
const before = { version: sql(`select pdf_export from courses.curriculum_versions where id = ${quote(versionId)}`), group: sql(`select coalesce(pdf_export::text, 'null') from courses.course_groups where id = ${quote(groupId)}`) };
sql(`update courses.curriculum_versions set pdf_export = false where id = ${quote(versionId)}`);
sql(`update courses.course_groups set pdf_export = null where id = ${quote(groupId)}`);

const learner = `${BASE}/l/course/${token}`;
const hasButton = async () => {
  await page.goto(learner);
  await page.waitForSelector('ol li button[aria-expanded]');
  return (await page.locator('[data-testid=course-pdf]').count()) > 0;
};

/** One of it on the page, and none still waiting in a hidden part. */
const settled = (selector) =>
  page.waitForFunction((sel) => document.querySelectorAll(sel).length === 1 && !document.querySelector(`[hidden] ${sel}`), selector);

/** Presses an export button and returns the file it downloads: its name, and whether it is a PDF of some size. */
async function downloaded(button, saveAs) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const file = saveAs || (await download.path());
  if (saveAs) await download.saveAs(saveAs);
  const bytes = readFileSync(file);
  return { name: download.suggestedFilename(), pdf: bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 10_000 };
}

try {
  check('off by default: a learner has no Download PDF', !(await hasButton()));

  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', env.DEMO_EMAIL);
  await page.fill('#admin-password', env.DEMO_PASSWORD);
  await Promise.all([page.waitForURL(/\/admin(\?|$)/), page.click('button[type=submit]')]);

  // The version's switch.
  await page.goto(`${BASE}/admin/courses/${courseId}/versions/${versionId}`);
  // Once the page has settled (while it streams in, its rows are there twice for a moment).
  await settled('[data-testid=version-pdf-export]');
  const versionSwitch = page.locator('[data-testid=version-pdf-export]');
  check('the version shows its switch, off', (await versionSwitch.getAttribute('aria-checked')) === 'false');
  await versionSwitch.click();
  await page.waitForFunction(() => document.querySelector('[data-testid=version-pdf-export]')?.getAttribute('aria-checked') === 'true');
  await page.waitForTimeout(800);
  check('switching it on is stored', sql(`select pdf_export from courses.curriculum_versions where id = ${quote(versionId)}`) === 't');
  check('its group’s learners get Download PDF', await hasButton());

  // The group's own answer.
  await page.goto(`${BASE}/admin/courses/groups/${groupId}?tab=settings`);
  await settled('[data-testid=group-pdf-export-row]');
  const row = page.locator('[data-testid=group-pdf-export-row]');
  check('the group follows its lessons, shown as on', /Same as lessons · On/.test(await row.innerText()));
  await row.locator('button').first().click();
  await page.getByRole('option', { name: 'Off for this group' }).click();
  await page.waitForTimeout(1200);
  check('the group’s own answer is stored', sql(`select pdf_export from courses.course_groups where id = ${quote(groupId)}`) === 'f');
  check('off for the group: its learners have no button, whatever the version says', !(await hasButton()));
  await page.goto(`${learner}/pdf`);
  check('off: the PDF page of the link is not there', (await page.locator('[data-testid=pdf-unavailable]').count()) === 1);
  sql(`update courses.course_groups set pdf_export = null where id = ${quote(groupId)}`);

  // A learner downloads the whole course, then one lesson.
  await page.goto(learner);
  const courseTitle = sql(`select title from courses.courses where id = ${quote(courseId)}`);
  const whole = await downloaded(page.locator('[data-testid=course-pdf]'));
  check('the whole course downloads as a PDF named after it', whole.pdf && whole.name === `${courseTitle}.pdf`, whole.name);
  await page.locator('ol li button[aria-expanded]').first().click();
  const one = await downloaded(page.locator('[data-testid=lesson-pdf]').first());
  check('one lesson downloads alone, named after it', one.pdf && one.name.startsWith(`${courseTitle} – 01 `), one.name);

  // The PDF page of the link (where a website that shows the course itself sends its learners): it
  // downloads as it opens, the whole course or one lesson.
  const opened = async (address) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.goto(address)]);
    const bytes = readFileSync(await download.path());
    return { name: download.suggestedFilename(), pdf: bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 10_000 };
  };
  const linked = await opened(`${learner}/pdf`);
  check('the link’s PDF page downloads the whole course', linked.pdf && linked.name === `${courseTitle}.pdf`, linked.name);
  const again = await downloaded(page.locator('[data-testid=pdf-download]'));
  check('its button downloads it again', again.pdf && again.name === `${courseTitle}.pdf`, again.name);
  const firstLesson = sql(`select id from courses.lessons where curriculum_version_id = ${quote(versionId)} and published_at is not null order by position limit 1`);
  const linkedOne = await opened(`${learner}/pdf?lesson=${firstLesson}`);
  check('with a lesson, it downloads that lesson alone', linkedOne.pdf && linkedOne.name.startsWith(`${courseTitle} – `), linkedOne.name);
  await page.goto(`${learner}/pdf?lesson=nope`);
  check('a lesson that is not the link’s: not there', (await page.locator('[data-testid=pdf-unavailable]').count()) === 1);
  await page.goto(`${BASE}/l/course/nope/pdf`);
  check('a link that does not exist: not there', (await page.locator('[data-testid=pdf-unavailable]').count()) === 1);

  if (samples) {
    // The team's preview (always exportable) of the version named in PDF_VERSION, or the same one.
    const version = process.env.PDF_VERSION || versionId;
    const course = sql(`select course_id from courses.curriculum_versions where id = ${quote(version)}`);
    await page.goto(`${BASE}/admin/courses/${course}/versions/${version}/preview`);
    await settled('[data-testid=course-pdf]');
    await downloaded(page.locator('[data-testid=course-pdf]'), path.join(samples, 'course.pdf'));
    await page.locator('ol li button[aria-expanded]').first().click();
    await downloaded(page.locator('[data-testid=lesson-pdf]').first(), path.join(samples, 'lesson.pdf'));
    console.log(`Saved the samples in ${samples}`);
  }
} catch (error) {
  check('ran to the end', false, String(error).slice(0, 400));
} finally {
  sql(`update courses.curriculum_versions set pdf_export = ${before.version === 't'} where id = ${quote(versionId)}`);
  sql(`update courses.course_groups set pdf_export = ${before.group === 'null' ? 'null' : before.group === 't'} where id = ${quote(groupId)}`);
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
