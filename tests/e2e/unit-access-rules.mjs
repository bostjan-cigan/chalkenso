// Unit tests for the access rules (src/lib/access-rules.ts): which grant covers what, what a
// membership grants (owners and admins always everything; a LIMITED member exactly their rows, none
// meaning nothing), and the Team page presets. No server needed; esbuild compiles the module.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({
  entryPoints: [path.join(root, 'src/lib/access-rules.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
});
const rules = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
const { can, grantsFromMembership, presetToGrants, grantsToPreset, courseGrantIds, groupGrantIds, guestReadsGroupVersion, FULL_ACCESS_GRANTS } = rules;

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const ORG = 'org-a';
const OTHER = 'org-b';
const READ = ['READ'];
const EDIT = ['READ', 'WRITE', 'DELETE'];
const user = (grants) => ({ role: 'USER', grants });
const core = (courseId, versionId = `core-${courseId}`) => ({ type: 'curriculum_version', versionId, courseId, ownerGroupId: null });
const copy = (courseId, groupId) => ({ type: 'curriculum_version', versionId: `copy-${groupId}`, courseId, ownerGroupId: groupId });
const course = (courseId) => ({ type: 'course', courseId });
const group = (groupId, courseId) => ({ type: 'group', groupId, courseId });
const section = (name) => ({ type: 'admin_section', section: name });
const row = (entityType, entityId, permissions, organizationId = ORG) => ({ organizationId, entityType, entityId, permissions });

// ── What a grant covers ──
const webdev = user([{ entityType: 'course', entityId: 'webdev', permissions: [...EDIT, 'TASKS'] }]);
check('course grant: its core versions', can(webdev, core('webdev'), ['WRITE']));
check('course grant: its groups’ copies', can(webdev, copy('webdev', 'evening'), ['WRITE']));
check('course grant: the course and its groups', can(webdev, course('webdev'), ['TASKS']) && can(webdev, group('evening', 'webdev'), READ));
check('course grant: not another course', !can(webdev, core('python'), READ) && !can(webdev, group('g2', 'python'), READ));
check('course grant: no admin sections', !can(webdev, section('courses'), READ));

const every = user([{ entityType: 'course', entityId: '*', permissions: READ }]);
check('course:* covers every course, read only', can(every, core('anything'), READ) && !can(every, core('anything'), ['WRITE']));
check('course:* opens no admin section', !can(every, section('courses'), READ) && !can(every, section('tasks'), READ));

const instructor = user([
  { entityType: 'group', entityId: 'summer', permissions: ['READ', 'TASKS'] },
  { entityType: 'curriculum_version', entityId: 'core-webdev', permissions: READ },
]);
check('group grant: the group', can(instructor, group('summer', 'webdev'), ['READ', 'TASKS']));
check('group grant: not other groups or the course', !can(instructor, group('spring', 'webdev'), READ) && !can(instructor, course('webdev'), READ));
check('derived read: the assigned core version, read only', can(instructor, core('webdev'), READ) && !can(instructor, core('webdev'), ['WRITE']));
check('derived read never opens course data (feedback, tasks)', !can(instructor, course('webdev'), READ));
const copyTeacher = user([{ entityType: 'group', entityId: 'evening', permissions: EDIT }]);
check('group grant: edits its own copy, not core', can(copyTeacher, copy('webdev', 'evening'), ['WRITE']) && !can(copyTeacher, core('webdev'), READ));

const full = user(FULL_ACCESS_GRANTS);
check('full access: everything', can(full, core('x'), [...EDIT, 'TASKS']) && can(full, section('tasks'), ['WRITE']) && can(full, group('g', 'x'), ['TASKS']));
check('super admin: everything', can({ role: 'SUPERADMIN', grants: [] }, course('x'), ['DELETE']));
check('nothing granted: nothing', !can(user([]), core('x'), READ));

// ── What a membership grants ──
const rows = [row('course', 'webdev', READ), row('course', 'python', EDIT, OTHER)];
const isFull = (grants) => grants.length === 1 && grants[0].entityType === 'all';
check('owner: full access, whatever rows they have', isFull(grantsFromMembership({ role: 'OWNER', access: 'LIMITED' }, rows, ORG)));
check('admin: full access', isFull(grantsFromMembership({ role: 'ADMIN', access: 'LIMITED' }, rows, ORG)));
check('FULL member: full access', isFull(grantsFromMembership({ role: 'MEMBER', access: 'FULL' }, rows, ORG)));
const limited = grantsFromMembership({ role: 'MEMBER', access: 'LIMITED' }, rows, ORG);
check('LIMITED member: only this organisation’s rows', limited.length === 1 && limited[0].entityId === 'webdev');
check('LIMITED member with no rows: nothing (never full)', grantsFromMembership({ role: 'MEMBER', access: 'LIMITED' }, [], ORG).length === 0);
check('LIMITED member: rows of other organisations never count', grantsFromMembership({ role: 'MEMBER', access: 'LIMITED' }, [row('course', 'python', EDIT, OTHER)], ORG).length === 0);
check('legacy rows without an organisation never count', grantsFromMembership({ role: 'MEMBER', access: 'LIMITED' }, [row('all', '*', EDIT, null)], ORG).length === 0);
check('not a member: nothing', grantsFromMembership(null, rows, ORG).length === 0);
const withReads = grantsFromMembership({ role: 'MEMBER', access: 'LIMITED' }, [row('group', 'summer', READ)], ORG, ['core-webdev', 'core-webdev']);
check('derived reads added once, read only', withReads.length === 2 && withReads[1].entityType === 'curriculum_version' && withReads[1].permissions.join() === 'READ');

// ── Presets ──
let roundTrips = 0;
for (const scope of ['all-courses', 'courses', 'groups']) {
  for (const lessons of ['edit', 'view']) {
    for (const feedback of [true, false]) {
      const preset = { scope, courseIds: scope === 'courses' ? ['c1', 'c2'] : [], groupIds: scope === 'groups' ? ['g1'] : [], lessons, feedback };
      const back = grantsToPreset(presetToGrants(preset));
      if (JSON.stringify(back) === JSON.stringify(preset)) roundTrips += 1;
      else console.log('   mismatch', JSON.stringify(preset), JSON.stringify(back));
    }
  }
}
check('every preset round-trips (12)', roundTrips === 12, String(roundTrips));
check('view only = READ; feedback adds TASKS', presetToGrants({ scope: 'courses', courseIds: ['c'], groupIds: [], lessons: 'view', feedback: true })[0].permissions.join() === 'READ,TASKS');
check('no rows → none', grantsToPreset([]) === 'none');
check('mixed kinds → custom', grantsToPreset([{ entityType: 'course', entityId: 'c', permissions: READ }, { entityType: 'group', entityId: 'g', permissions: READ }]) === 'custom');
check('odd permissions → custom', grantsToPreset([{ entityType: 'course', entityId: 'c', permissions: ['READ', 'WRITE'] }]) === 'custom');
check('admin sections → custom', grantsToPreset([{ entityType: 'admin_section', entityId: 'courses', permissions: READ }]) === 'custom');
check('duplicate ids are dropped', presetToGrants({ scope: 'groups', courseIds: [], groupIds: ['g', 'g'], lessons: 'view', feedback: false }).length === 1);

// ── Guest instructors (NOTES) ──
const guestPreset = { scope: 'groups', courseIds: [], groupIds: ['g1'], lessons: 'notes', feedback: false };
const guestRows = presetToGrants(guestPreset);
check('guest instructor preset = NOTES only, on the groups', guestRows.length === 1 && guestRows[0].entityType === 'group' && guestRows[0].permissions.join() === 'NOTES');
check('guest instructor preset round-trips', JSON.stringify(grantsToPreset(guestRows)) === JSON.stringify(guestPreset));
check('guest instructor never carries feedback', presetToGrants({ ...guestPreset, feedback: true })[0].permissions.join() === 'NOTES');
check('NOTES on a course → custom (guests are for groups only)', grantsToPreset([{ entityType: 'course', entityId: 'c', permissions: ['NOTES'] }]) === 'custom');
const guest = user([{ entityType: 'group', entityId: 'evening', permissions: ['NOTES'] }]);
check('guest: notes on their group', can(guest, group('evening', 'webdev'), ['NOTES']));
check('guest: no READ on their group (no roster, links, feedback, tasks)', !can(guest, group('evening', 'webdev'), READ));
check('guest: nothing on other groups, the course or its versions', !can(guest, group('summer', 'webdev'), ['NOTES']) && !can(guest, course('webdev'), ['NOTES']) && !can(guest, core('webdev'), READ));
check('guest: their group is not a READ group', groupGrantIds(guest.grants).length === 0 && JSON.stringify(groupGrantIds(guest.grants, ['NOTES'])) === '["evening"]');
check('full access includes NOTES', can(full, group('g', 'x'), ['NOTES']));

// ── A guest instructor's team preview: the version their group reads, nothing else ──
const reads = (groupId, courseId, curriculumVersionId) => ({ id: groupId, courseId, curriculumVersionId });
const version = (id, courseId = 'webdev') => ({ id, courseId });
check('guest preview: the core version their group is assigned', guestReadsGroupVersion(guest, reads('evening', 'webdev', 'core-webdev'), version('core-webdev')));
check('guest preview: their group’s own copy', guestReadsGroupVersion(guest, reads('evening', 'webdev', 'copy-evening'), version('copy-evening')));
check('guest preview: not a version their group doesn’t read now', !guestReadsGroupVersion(guest, reads('evening', 'webdev', 'copy-evening'), version('core-webdev')));
check('guest preview: not a group that reads no version', !guestReadsGroupVersion(guest, reads('evening', 'webdev', null), version('core-webdev')));
check('guest preview: not through another group', !guestReadsGroupVersion(guest, reads('summer', 'webdev', 'core-webdev'), version('core-webdev')));
check('guest preview: not across courses', !guestReadsGroupVersion(guest, reads('evening', 'webdev', 'core-webdev'), version('core-webdev', 'python')));
check('guest preview: needs NOTES (READ on the group alone is the ordinary preview)', !guestReadsGroupVersion(user([{ entityType: 'group', entityId: 'evening', permissions: READ }]), reads('evening', 'webdev', 'core-webdev'), version('core-webdev')));
check('guest preview opens no READ: not the version, its course or other versions', !can(guest, core('webdev'), READ) && !can(guest, course('webdev'), ['NOTES']) && !can(guest, copy('webdev', 'summer'), ['NOTES']));
const guestElsewhere = user(grantsFromMembership({ role: 'MEMBER', access: 'LIMITED' }, [row('group', 'evening', ['NOTES'], OTHER)], ORG));
check('guest preview: a guest grant of another organisation never counts', !guestReadsGroupVersion(guestElsewhere, reads('evening', 'webdev', 'core-webdev'), version('core-webdev')));

// ── Helpers ──
check('courseGrantIds: * for every course', courseGrantIds([{ entityType: 'course', entityId: '*', permissions: READ }]) === '*');
check('courseGrantIds: by permission', JSON.stringify(courseGrantIds(webdev.grants, ['TASKS'])) === '["webdev"]' && courseGrantIds(webdev.grants, ['WRITE']).length === 1 && JSON.stringify(courseGrantIds(every.grants, ['WRITE'])) === '[]');
check('groupGrantIds: by permission', JSON.stringify(groupGrantIds(instructor.grants, ['TASKS'])) === '["summer"]' && groupGrantIds(instructor.grants, ['WRITE']).length === 0);

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
