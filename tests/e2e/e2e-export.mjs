// "Export everything" (Settings → Export), end to end, on the demo organisation: the owner downloads
// the .zip from the page; it unzips (`unzip -t` where installed) into one folder with README.txt,
// which names every file; the lessons as the Obsidian plugin keeps them (a folder per version and per
// group copy, a note per lesson with the plugin's properties, images in _attachments), the version
// history with who published (through the sync API) and each published text, feedback (learners never
// named), tasks and the team. Nothing secret is in it (sync token, AI key, learner links, invite and
// share hashes, password hashes, sessions), and nothing from another organisation. A member limited to
// one group gets that group only.
// Needs the demo seed.
// node tests/e2e/e2e-export.mjs
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { BASE, env, serverEdition, sql } from './helpers.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const quote = (value) => (value === null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const run = Date.now().toString(36);
const cloud = (await serverEdition()) === 'cloud';
const STORAGE = env.R2_BUCKET ? null : path.resolve(env.STORAGE_DIR || '.data/media');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const orgId = sql(`select id from public.organizations where slug = 'northwind-academy'`);
const ownerId = sql(`select id from public.users where lower(email) = lower(${quote(env.DEMO_EMAIL)})`);
if (!orgId || !ownerId) {
  console.log('FAIL  demo organisation found (run yarn db:seed-demo)');
  process.exit(1);
}
const ownerName = sql(`select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) from public.users where id = ${quote(ownerId)}`);

// ── A .zip, read the plain way: the central directory, then each file's data ─────────────────────

function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('no end of central directory');
  let count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) {
    const end64 = Number(buffer.readBigUInt64LE(end - 20 + 8));
    count = Number(buffer.readBigUInt64LE(end64 + 32));
    at = Number(buffer.readBigUInt64LE(end64 + 48));
  }
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central record ${index}`);
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const raw = buffer.subarray(start, start + compressed);
    entries.set(name, { flags, data: method === 8 ? inflateRawSync(raw) : raw });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** RFC 4180 rows (the byte order mark dropped). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && source[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** A note's properties (`key: value`, the value plain or double-quoted). */
function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  return Object.fromEntries(
    match[1].split('\n').map((line) => {
      const [key, ...rest] = line.split(': ');
      const value = rest.join(': ');
      return [key, value.startsWith('"') ? JSON.parse(value) : /^\d+$/.test(value) ? Number(value) : value];
    })
  );
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
async function signIn(identifier, password) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#admin-identifier', identifier);
  await page.fill('#admin-password', password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/admin/login')), page.click('button[type=submit]')]);
  return page;
}

/** Opens Settings → Export, follows its button as the browser would, and reads the .zip. */
async function exportFrom(page, label) {
  await page.goto(`${BASE}/admin/settings/export`);
  const button = page.locator('[data-testid=export-download]:visible').first();
  await button.waitFor();
  const href = await button.getAttribute('href');
  const response = await page.request.get(new URL(href, BASE).toString());
  const body = Buffer.from(await response.body());
  const folder = mkdtempSync(path.join(os.tmpdir(), `export-${label}-`));
  const file = path.join(folder, 'export.zip');
  writeFileSync(file, body);
  // KEEP_EXPORT=<folder> keeps a copy to look at.
  if (env.KEEP_EXPORT) writeFileSync(path.join(env.KEEP_EXPORT, `${label}.zip`), body);
  return { href, response, body, file, folder, entries: readZip(body) };
}

const cleanup = [];
let step = 'start';
try {
  // ── Things that must never leave, and another organisation ─────────────────────────────────
  step = 'secrets';
  const inviteHash = `invitehash${run}${randomBytes(12).toString('hex')}`;
  const aiKey = `aikeyenc${run}${randomBytes(12).toString('hex')}`;
  const shareHash = `sharehash${run}${randomBytes(12).toString('hex')}`;
  const inviteId = randomUUID();
  sql(`insert into public.user_invites (id, organization_id, token_hash, label, expires_at) values (${quote(inviteId)}, ${quote(orgId)}, ${quote(inviteHash)}, 'Export check', now() + interval '1 day')`);
  cleanup.push(() => sql(`delete from public.user_invites where id = ${quote(inviteId)}`));
  const oldKey = sql(`select coalesce(ai_api_key_encrypted, '') || '|' || coalesce(ai_api_key_hint, '') from public.organizations where id = ${quote(orgId)}`).split('|');
  sql(`update public.organizations set ai_api_key_encrypted = ${quote(aiKey)}, ai_api_key_hint = 'abcd' where id = ${quote(orgId)}`);
  cleanup.push(() => sql(`update public.organizations set ai_api_key_encrypted = ${quote(oldKey[0] || null)}, ai_api_key_hint = ${quote(oldKey[1] || null)} where id = ${quote(orgId)}`));
  const reportId = randomUUID();
  if (cloud) {
    sql(`insert into public.term_reports (id, organization_id, title, period_start, period_end, scope, data, summary, themes, share_token_hash, updated_at)
      values (${quote(reportId)}, ${quote(orgId)}, ${quote(`Export check report ${run}`)}, now() - interval '30 days', now(), '{"courseIds":[],"groupIds":[]}', '{"version":1}', ${quote(`Summary ${run}`)},
        ${quote(JSON.stringify([{ title: `Theme ${run}`, count: 2, quotes: [`Quote ${run}`] }]))}, ${quote(shareHash)}, now())`);
    cleanup.push(() => sql(`delete from public.term_reports where id = ${quote(reportId)}`));
  }

  const otherOrg = randomUUID();
  const otherCourse = randomUUID();
  const otherVersion = randomUUID();
  sql(`insert into public.organizations (id, name, slug, updated_at) values (${quote(otherOrg)}, ${quote(`Other School ${run}`)}, ${quote(`other-school-${run}`)}, now())`);
  cleanup.push(() => sql(`delete from public.organizations where id = ${quote(otherOrg)}`));
  sql(`insert into courses.courses (id, organization_id, title, slug, updated_at) values (${quote(otherCourse)}, ${quote(otherOrg)}, ${quote(`Other course ${run}`)}, 'other-course', now())`);
  sql(`insert into courses.curriculum_versions (id, course_id, label, version, updated_at) values (${quote(otherVersion)}, ${quote(otherCourse)}, 'v1', 1, now())`);
  sql(`insert into courses.lessons (id, course_id, curriculum_version_id, title, slug, position, markdown_content, updated_at) values (${quote(randomUUID())}, ${quote(otherCourse)}, ${quote(otherVersion)}, 'Elsewhere', 'elsewhere', 1, ${quote(`OTHER-ORG-${run}`)}, now())`);

  let signedName = null;
  let unsignedName = null;
  if (cloud) {
    const signed = sql(`select s.id || '|' || m.full_name from courses.course_survey_responses s join courses.course_group_members m on m.id = s.member_id
      join courses.courses c on c.id = s.course_id where c.organization_id = ${quote(orgId)} and s.answer is not null and s.answer <> '' and not s.named order by s.id limit 1`).split('|');
    if (signed[0]) {
      sql(`update courses.course_survey_responses set named = true where id = ${quote(signed[0])}`);
      cleanup.push(() => sql(`update courses.course_survey_responses set named = false where id = ${quote(signed[0])}`));
      signedName = signed[1];
    }
    unsignedName = sql(`select m.full_name from courses.course_survey_responses s join courses.course_group_members m on m.id = s.member_id
      join courses.courses c on c.id = s.course_id where c.organization_id = ${quote(orgId)} and m.full_name <> ${quote(signedName ?? '')}
      and not exists (select 1 from courses.course_survey_responses o where o.member_id = m.id and o.named) order by m.full_name limit 1`);
  }

  // ── The owner: a course of their own, published through the sync API, with an image ──────────
  step = 'owner';
  const owner = await signIn(env.DEMO_EMAIL, env.DEMO_PASSWORD);
  await owner.goto(`${BASE}/admin/api-tokens`);
  await owner.fill('#api-token-name', `Export check ${run}`);
  await owner.getByRole('button', { name: 'Create token' }).click();
  await owner.waitForFunction(() => /usr_[A-Za-z0-9_-]{10,}/.test(document.body.innerText));
  const syncToken = (await owner.locator('body').innerText()).match(/usr_[A-Za-z0-9_-]{10,}/)[0];
  const tokenHash = sql(`select token_hash from public.api_tokens where name = ${quote(`Export check ${run}`)}`);
  cleanup.push(() => sql(`delete from public.api_tokens where name = ${quote(`Export check ${run}`)}`));

  const courseId = randomUUID();
  const versionId = randomUUID();
  const assetId = randomUUID();
  const courseTitle = `Export check ${run}`;
  sql(`insert into courses.courses (id, organization_id, title, slug, summary, updated_at) values (${quote(courseId)}, ${quote(orgId)}, ${quote(courseTitle)}, ${quote(`export-check-${run}`)}, 'A course for the export test', now())`);
  cleanup.push(() => sql(`delete from courses.courses where id = ${quote(courseId)}`));
  sql(`insert into courses.curriculum_versions (id, course_id, label, version, updated_at) values (${quote(versionId)}, ${quote(courseId)}, 'v1', 1, now())`);
  const assetKey = `organizations/${orgId}/courses/${courseId}/lessons/${assetId}.png`;
  sql(`insert into courses.media_assets (id, r2_key, original_filename, mime_type, bytes, updated_at) values (${quote(assetId)}, ${quote(assetKey)}, 'diagram.png', 'image/png', ${png.length}, now())`);
  cleanup.push(() => sql(`delete from courses.media_assets where id = ${quote(assetId)}`));
  if (STORAGE) {
    mkdirSync(path.dirname(path.join(STORAGE, assetKey)), { recursive: true });
    writeFileSync(path.join(STORAGE, assetKey), png);
    writeFileSync(`${path.join(STORAGE, assetKey)}.meta.json`, JSON.stringify({ contentType: 'image/png', cacheControl: null, updatedAt: new Date().toISOString() }));
    cleanup.push(() => rmSync(path.join(STORAGE, assetKey), { force: true }));
    cleanup.push(() => rmSync(`${path.join(STORAGE, assetKey)}.meta.json`, { force: true }));
  }
  const sync = (method, route, body) =>
    owner.request.fetch(`${BASE}${route}`, {
      method,
      headers: { Authorization: `Bearer ${syncToken}`, 'X-Curriculum-Version-Id': versionId, 'Content-Type': 'application/json' },
      data: body ? JSON.stringify(body) : undefined,
    });
  const lessonTitle = `Export lesson ${run}`;
  const embed = `diagram-${run}.png`;
  const created = await sync('POST', '/api/sync/lessons', {
    title: lessonTitle,
    markdownContent: `First text ${run}\n\n![[${embed}]]`,
    status: 'published',
    assetBindings: [{ sourcePath: embed, assetId }],
  });
  const lesson = (await created.json()).lesson;
  check('a lesson is published through the sync API', created.status() === 201 && Boolean(lesson?.id), String(created.status()));
  const updated = await sync('PATCH', `/api/sync/lessons/${lesson.id}`, {
    title: lessonTitle,
    markdownContent: `Second text ${run}\n\n![[${embed}]]`,
    status: 'published',
    baseRevision: lesson.revision,
    assetBindings: [{ sourcePath: embed, assetId }],
  });
  check('and published again', updated.ok(), String(updated.status()));
  check(
    'each publication records who published it',
    sql(`select count(*) from courses.lesson_publications where lesson_id = ${quote(lesson.id)} and publisher_name = ${quote(ownerName)} and published_by_id = ${quote(ownerId)}`) === '2'
  );

  const passwordHash = sql(`select password from public.auth_accounts where user_id = ${quote(ownerId)} and provider_id = 'credential'`);
  const sessionTokens = sql(`select token from public.auth_sessions where user_id = ${quote(ownerId)}`).split('\n').filter(Boolean);
  const linkTokens = sql(`select token from courses.access_links`).split('\n').filter(Boolean);
  const secrets = [syncToken, tokenHash, inviteHash, aiKey, passwordHash, ...sessionTokens, ...linkTokens, ...(cloud ? [shareHash] : [])].filter(Boolean);
  const foreign = [`OTHER-ORG-${run}`, `Other course ${run}`, `Other School ${run}`];

  // ── The owner's export ───────────────────────────────────────────────────────────────────────
  step = 'owner export';
  await owner.goto(`${BASE}/admin/settings/export`);
  const pageText = await owner.locator('[data-testid=export-everything]:visible').first().innerText();
  check('Settings → Export lists what the .zip holds', /Lessons, as Markdown notes/.test(pageText) && /Feedback and instructor notes/.test(pageText) && /People in the team/.test(pageText), pageText.slice(0, 200));
  check('Settings has an Export tab', (await owner.getByRole('link', { name: 'Export' }).count()) > 0);
  const owners = await exportFrom(owner, 'owner');
  const today = new Date().toISOString().slice(0, 10);
  const top = `chalkenso-northwind-academy-${today}/`;
  check('the button downloads /admin/api/export', owners.href === '/admin/api/export');
  check('it is a .zip, named for the organisation and the day', owners.response.headers()['content-type'] === 'application/zip' && owners.response.headers()['content-disposition'] === `attachment; filename="chalkenso-northwind-academy-${today}.zip"`, JSON.stringify(owners.response.headers()));
  const unzip = spawnSync('unzip', ['-tq', owners.file], { encoding: 'utf8' });
  if (unzip.error) console.log('(unzip not installed: the archive check is skipped)');
  else check('unzip accepts the archive', unzip.status === 0, `${unzip.stdout}${unzip.stderr}`.trim().slice(-300));

  const names = Array.from(owners.entries.keys());
  check('everything is in one folder, with UTF-8 names', names.length > 0 && names.every((name) => name.startsWith(top)) && Array.from(owners.entries.values()).every((entry) => entry.flags & 0x0800), names.find((name) => !name.startsWith(top)) ?? '');
  const file = (name) => owners.entries.get(`${top}${name}`)?.data.toString('utf8') ?? null;
  const csv = (name) => parseCsv(file(name) ?? '');
  const readme = file('README.txt') ?? '';
  const readmeWords = readme.replace(/\s+/g, ' ');
  check('README.txt says whose it is and that it has everything', readmeWords.includes('Chalkenso export: Northwind Academy') && readmeWords.includes(`by ${ownerName}.`) && readmeWords.includes('It has everything in Northwind Academy.'), readme.slice(0, 300));
  const relative = names.map((name) => name.slice(top.length));
  const unexplained = relative.filter((name) => !readme.includes(name) && !readme.includes(`${name.split('/')[0]}/`));
  check('README.txt explains every file', unexplained.length === 0, unexplained.slice(0, 5).join(', '));
  const expected = ['README.txt', 'courses.csv', 'groups.csv', 'group-learners.csv', 'history/versions.csv', 'history/publications.csv', 'feedback.csv', 'tasks.csv', 'task-notes.csv', 'team.csv'];
  const missing = expected.filter((name) => file(name) === null);
  check('the records are there', missing.length === 0, missing.join(', '));
  check('and README.txt names each of them', expected.every((name) => readme.includes(name)));

  // The lessons, as the Obsidian plugin keeps them.
  const versions = sql(`select c.title || ' – ' || coalesce(g.name, v.label) || '|' || (v.owner_group_id is not null) || '|' || (select count(*) from courses.lessons l where l.curriculum_version_id = v.id)
    from courses.curriculum_versions v join courses.courses c on c.id = v.course_id left join courses.course_groups g on g.id = v.owner_group_id
    where c.organization_id = ${quote(orgId)}`).split('\n').map((line) => line.split('|'));
  const folderOf = ([name, group]) => `Northwind Academy/${group === 'true' ? 'Groups' : 'Curriculums'}/${name.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim()}/`;
  const wrongCounts = versions.filter((version) => {
    const folder = folderOf(version);
    const notes = relative.filter((name) => name.startsWith(folder) && name.endsWith('.md') && name.slice(folder.length).indexOf('/') === -1 && !name.endsWith('/README.md'));
    return notes.length !== Number(version[2]);
  });
  check('a folder per version and group copy, a note per lesson', wrongCounts.length === 0, wrongCounts.map((version) => folderOf(version)).join(', '));
  const groupCopies = versions.filter(([, group]) => group === 'true');
  check(
    "a group's copy has the plugin's README.md",
    groupCopies.length > 0 && groupCopies.every((version) => (file(`${folderOf(version)}README.md`) ?? '').startsWith('Group curriculum for ')),
    groupCopies.map((version) => folderOf(version)).join(', ')
  );
  const note = file(`Northwind Academy/Curriculums/${courseTitle} – v1/${lessonTitle}.md`) ?? '';
  const properties = frontmatter(note) ?? {};
  check(
    'a lesson note has the plugin’s properties and the lesson’s text',
    properties.lessonId === lesson.id && properties.revision === lesson.revision + 1 && properties.status === 'published' && properties.lessonStatus === 'PUBLISHED' && properties.syncStatus === 'synced' && Boolean(properties.slug) && !('title' in properties) && note.includes(`Second text ${run}`),
    JSON.stringify(properties)
  );
  const image = owners.entries.get(`${top}Northwind Academy/Curriculums/${courseTitle} – v1/_attachments/${embed}`);
  check('its embedded image is in _attachments, byte for byte', Boolean(image) && Buffer.compare(image.data, png) === 0);

  // The version history: who published, and every published text.
  const versionsCsv = csv('history/versions.csv');
  check('history/versions.csv has every version and group copy', versionsCsv.length - 1 === versions.length, `${versionsCsv.length - 1} of ${versions.length}`);
  const publications = csv('history/publications.csv');
  const ours = publications.filter((row) => row[0] === courseTitle);
  check('history/publications.csv says when and by whom', ours.length === 2 && ours.every((row) => row[6] === ownerName && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row[5])), JSON.stringify(ours));
  const first = file(ours[0]?.[9] ?? '-') ?? '';
  check('each published text is in history/, as it was', first.includes(`First text ${run}`) && (file(ours[1]?.[9] ?? '-') ?? '').includes(`Second text ${run}`), ours.map((row) => row[9]).join(', '));
  check('every publication is listed', publications.length - 1 === Number(sql(`select count(*) from courses.lesson_publications p join courses.lessons l on l.id = p.lesson_id join courses.courses c on c.id = l.course_id where c.organization_id = ${quote(orgId)}`)));

  // Feedback, tasks, the team, the rosters.
  const feedback = csv('feedback.csv');
  check('feedback.csv has all the feedback and notes', feedback.length - 1 === Number(sql(`select count(*) from courses.curriculum_comments c join courses.curriculum_versions v on v.id = c.curriculum_version_id join courses.courses k on k.id = v.course_id where k.organization_id = ${quote(orgId)}`)), String(feedback.length - 1));
  const learnerNames = sql(`select distinct m.full_name from courses.course_group_members m join courses.course_groups g on g.id = m.group_id join courses.courses c on c.id = g.course_id where c.organization_id = ${quote(orgId)}`).split('\n').filter(Boolean);
  const feedbackText = file('feedback.csv') ?? '';
  check('learners are never named in feedback', learnerNames.every((name) => !feedbackText.includes(name)) && feedbackText.includes('A learner'), learnerNames.find((name) => feedbackText.includes(name)) ?? '');
  check('tasks.csv has every task', csv('tasks.csv').length - 1 === Number(sql(`select count(*) from public.tasks where organization_id = ${quote(orgId)}`)));
  check('team.csv has the team', (file('team.csv') ?? '').includes(env.DEMO_EMAIL) && csv('team.csv').length - 1 === Number(sql(`select count(*) from public.organization_members where organization_id = ${quote(orgId)}`)));
  check('group-learners.csv has the rosters', csv('group-learners.csv').length - 1 === Number(sql(`select count(*) from courses.course_group_members m join courses.course_groups g on g.id = m.group_id join courses.courses c on c.id = g.course_id where c.organization_id = ${quote(orgId)}`)));

  if (cloud) {
    const cloudFiles = ['learners/surveys.csv', 'learners/survey-quick-questions.csv', 'learners/lesson-question.csv', 'learners/lesson-question-notes.csv', 'learners/check-questions.csv'];
    check('the learner answers are there (cloud)', cloudFiles.every((name) => file(name) !== null && readme.includes(name)), cloudFiles.filter((name) => file(name) === null).join(', '));
    const surveys = file('learners/surveys.csv') ?? '';
    check(
      'survey answers: the name only where the learner signed it',
      csv('learners/surveys.csv').length - 1 === Number(sql(`select count(*) from courses.course_survey_responses s join courses.courses c on c.id = s.course_id where c.organization_id = ${quote(orgId)}`)) &&
        (!signedName || surveys.includes(signedName)) &&
        (!unsignedName || !surveys.includes(unsignedName)),
      `${signedName} / ${unsignedName}`
    );
    const counted = ['learners/lesson-question.csv', 'learners/lesson-question-notes.csv', 'learners/survey-quick-questions.csv'].map((name) => file(name) ?? '').join('\n');
    check('the lesson question is only counted, never named', learnerNames.every((name) => !counted.includes(name)) && csv('learners/lesson-question.csv').length > 1);
    const report = relative.find((name) => name.startsWith('reports/') && name.endsWith('.md') && name.includes(`Export check report ${run}`));
    check('term reports, as Markdown and JSON (cloud)', Boolean(report) && (file(report) ?? '').includes(`Quote ${run}`) && file(report.replace(/\.md$/, '.json')) !== null, report ?? '');
  }

  const leaks = (entries) =>
    [...secrets, ...foreign].filter((secret) => Array.from(entries.values()).some((entry) => entry.data.includes(secret)));
  const leaked = leaks(owners.entries);
  check('no secrets and nothing from another organisation', leaked.length === 0 && ![...secrets, ...foreign].some((secret) => owners.body.includes(secret)), leaked.map((secret) => secret.slice(0, 12)).join(', '));
  rmSync(owners.folder, { recursive: true, force: true });

  // ── A member limited to one group ─────────────────────────────────────────────────────────────
  step = 'member';
  const group = sql(`select g.id || '|' || g.name || '|' || c.title || '|' || v.label from courses.course_groups g join courses.courses c on c.id = g.course_id join courses.curriculum_versions v on v.id = g.curriculum_version_id
    where c.organization_id = ${quote(orgId)} and not g.feedback_driven and v.owner_group_id is null and exists (select 1 from courses.curriculum_comments k where k.group_id = g.id) order by g.name limit 1`).split('|');
  const memberId = randomUUID();
  const memberEmail = `exporter-${run}@example.com`;
  const memberPassword = `pw-${run}-export`;
  const salt = randomBytes(16).toString('hex');
  sql(`insert into public.users (id, identifier, email, name, first_name, last_name, display_username, email_verified, updated_at) values (${quote(memberId)}, ${quote(memberEmail)}, ${quote(memberEmail)}, 'Edo Exporter', 'Edo', 'Exporter', ${quote(memberEmail)}, true, now())`);
  cleanup.push(() => sql(`delete from public.users where id = ${quote(memberId)}`));
  sql(`insert into public.auth_accounts (id, account_id, provider_id, user_id, password, updated_at) values (${quote(randomUUID())}, ${quote(memberId)}, 'credential', ${quote(memberId)}, ${quote(`scrypt:${salt}:${scryptSync(memberPassword, salt, 64).toString('hex')}`)}, now())`);
  sql(`insert into public.organization_members (id, organization_id, user_id, role, access, updated_at) values (${quote(randomUUID())}, ${quote(orgId)}, ${quote(memberId)}, 'MEMBER', 'LIMITED', now())`);
  sql(`insert into public.user_grants (id, user_id, organization_id, entity_type, entity_id, permissions, updated_at) values (${quote(randomUUID())}, ${quote(memberId)}, ${quote(orgId)}, 'group', ${quote(group[0])}, '{READ,TASKS}', now())`);

  const member = await signIn(memberEmail, memberPassword);
  await member.goto(`${BASE}/admin/settings/export`);
  await member.locator('[data-testid=export-everything]:visible').first().waitFor();
  check('a member is told the export has what they can open', (await member.locator('[data-testid=export-own]:visible').count()) === 1);
  const members = await exportFrom(member, 'member');
  const mine = (name) => members.entries.get(`${top}${name}`)?.data.toString('utf8') ?? null;
  const memberNames = Array.from(members.entries.keys()).map((name) => name.slice(top.length));
  const folders = Array.from(new Set(memberNames.filter((name) => name.startsWith('Northwind Academy/')).map((name) => name.split('/').slice(0, 3).join('/'))));
  check("only the lessons their group reads", folders.length === 1 && folders[0] === `Northwind Academy/Curriculums/${group[2]} – ${group[3]}`, folders.join(', '));
  check('only their group', parseCsv(mine('groups.csv') ?? '').slice(1).map((row) => row[0]).join() === group[1], mine('groups.csv') ?? '');
  const memberFeedback = parseCsv(mine('feedback.csv') ?? '').slice(1);
  check("only their group's feedback", memberFeedback.length > 0 && memberFeedback.every((row) => row[4] === group[1]), `${memberFeedback.length} rows`);
  check('no whole courses, no team, no learner answers, no reports', parseCsv(mine('courses.csv') ?? '').length === 1 && mine('team.csv') === null && !memberNames.some((name) => name.startsWith('learners/') || name.startsWith('reports/')));
  check('README.txt says it is what they can open', (mine('README.txt') ?? '').replace(/\s+/g, ' ').includes('It has what Edo Exporter can open in Northwind Academy.'));
  check('nothing secret in theirs either', leaks(members.entries).length === 0);
  rmSync(members.folder, { recursive: true, force: true });

  if (cloud) {
    step = 'links';
    await owner.goto(`${BASE}/admin/settings/plan`);
    check('the plan page links to the export', (await owner.locator('[data-testid=export-first]:visible').first().getAttribute('href').catch(() => null)) === '/admin/settings/export');
    await owner.goto(`${BASE}/admin/settings`);
    await owner.locator('[data-testid=delete-organization]:visible').first().click();
    const dialog = owner.locator('[role=dialog]:visible');
    await dialog.waitFor();
    check('deleting the organisation offers it first', (await dialog.locator('[data-testid=export-first]').getAttribute('href')) === '/admin/settings/export');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
} catch (error) {
  console.log(`FAIL  ${step}: ${error instanceof Error ? error.message : error}`);
  failed += 1;
} finally {
  for (const undo of cleanup.reverse()) {
    try {
      undo();
    } catch (error) {
      console.log(`(cleanup: ${error instanceof Error ? error.message : error})`);
    }
  }
  await browser.close();
}

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
