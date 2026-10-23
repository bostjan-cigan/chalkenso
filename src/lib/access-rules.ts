import type { MemberAccess, OrgRole, Permission, UserRole } from '@prisma/client';
import {
  ALL_COURSES_ENTITY_ID,
  ALL_GRANT_ENTITY_ID,
  GRANT_ENTITY_TYPES,
  isGrantableAdminSection,
  type AdminSectionKey,
} from './grant-scopes';

/**
 * The access rules themselves, with no database or server imports (so they can be unit-tested):
 * which grant covers which resource, what a membership grants, and the presets owners and admins
 * pick on the Team page. `permissions.ts` loads the rows and re-exports all of this.
 */

/** Permission values without importing the Prisma runtime. */
export const PERMISSION = {
  READ: 'READ',
  WRITE: 'WRITE',
  DELETE: 'DELETE',
  TASKS: 'TASKS',
  NOTES: 'NOTES',
} as const satisfies Record<Permission, Permission>;

const ALL_PERMISSIONS: Permission[] = [PERMISSION.READ, PERMISSION.WRITE, PERMISSION.DELETE, PERMISSION.TASKS, PERMISSION.NOTES];

export type Grant = {
  entityType: string;
  entityId: string;
  permissions: Permission[];
};

/**
 * Who is acting and what they may do. Loaded per request (never cached on a token), so a change to a
 * member's access applies to every one of their tokens and sessions immediately.
 */
export type Principal = {
  userId: string;
  role: UserRole;
  grants: Grant[];
};

/**
 * What a request wants to touch. Curriculum versions are about lesson text; `course` and `group` are
 * about everything else of a course or group (its learners' feedback, tasks, insights, rosters).
 */
export type PermissionResource =
  | { type: typeof GRANT_ENTITY_TYPES.CONTENT }
  | {
      type: typeof GRANT_ENTITY_TYPES.CURRICULUM_VERSION;
      versionId: string;
      courseId: string;
      /** Set for a group curriculum: the group that owns it. */
      ownerGroupId: string | null;
    }
  | { type: typeof GRANT_ENTITY_TYPES.COURSE; courseId: string }
  | { type: typeof GRANT_ENTITY_TYPES.GROUP; groupId: string; courseId: string }
  | { type: typeof GRANT_ENTITY_TYPES.ADMIN_SECTION; section: AdminSectionKey };

/** Everything in an organisation: owners, admins and FULL members. */
export const FULL_ACCESS_GRANTS: Grant[] = [
  { entityType: GRANT_ENTITY_TYPES.ALL, entityId: ALL_GRANT_ENTITY_ID, permissions: ALL_PERMISSIONS },
];

export function isSuperAdmin(principal: { role: UserRole }): boolean {
  return principal.role === 'SUPERADMIN';
}

function courseOf(resource: PermissionResource): string | null {
  return resource.type === GRANT_ENTITY_TYPES.CURRICULUM_VERSION ||
    resource.type === GRANT_ENTITY_TYPES.COURSE ||
    resource.type === GRANT_ENTITY_TYPES.GROUP
    ? resource.courseId
    : null;
}

/**
 * Whether a grant applies to a resource:
 * - `all` covers everything (except admin sections that are not grantable yet);
 * - `course` (one course, or `*` for every course) covers its versions (core and group copies), the
 *   course itself and its groups;
 * - `group` covers that group and its own curriculum copy (reading the version a group is assigned
 *   comes from a separate, derived `curriculum_version` grant);
 * - `content` / `curriculum_version` / `admin_section` cover exactly their entity.
 */
export function grantCovers(grant: Grant, resource: PermissionResource): boolean {
  if (resource.type === GRANT_ENTITY_TYPES.ADMIN_SECTION && !isGrantableAdminSection(resource.section)) {
    return false;
  }

  switch (grant.entityType) {
    case GRANT_ENTITY_TYPES.ALL:
      return true;
    case GRANT_ENTITY_TYPES.CONTENT:
      return resource.type === GRANT_ENTITY_TYPES.CONTENT;
    case GRANT_ENTITY_TYPES.COURSE: {
      const courseId = courseOf(resource);
      return courseId !== null && (grant.entityId === ALL_COURSES_ENTITY_ID || grant.entityId === courseId);
    }
    case GRANT_ENTITY_TYPES.GROUP:
      return (
        (resource.type === GRANT_ENTITY_TYPES.CURRICULUM_VERSION && resource.ownerGroupId === grant.entityId) ||
        (resource.type === GRANT_ENTITY_TYPES.GROUP && resource.groupId === grant.entityId)
      );
    case GRANT_ENTITY_TYPES.CURRICULUM_VERSION:
      return resource.type === GRANT_ENTITY_TYPES.CURRICULUM_VERSION && resource.versionId === grant.entityId;
    case GRANT_ENTITY_TYPES.ADMIN_SECTION:
      return resource.type === GRANT_ENTITY_TYPES.ADMIN_SECTION && resource.section === grant.entityId;
    default:
      return false;
  }
}

/**
 * Everything the principal may do on `resource`: every permission for a super admin, otherwise the
 * union of the permissions of every grant that covers it.
 */
export function grantedPermissions(principal: Pick<Principal, 'role' | 'grants'>, resource: PermissionResource): Set<Permission> {
  if (isSuperAdmin(principal)) {
    return new Set(ALL_PERMISSIONS);
  }
  const permissions = new Set<Permission>();
  for (const grant of principal.grants) {
    if (grantCovers(grant, resource)) {
      grant.permissions.forEach((permission) => permissions.add(permission));
    }
  }
  return permissions;
}

/** True when the principal holds every `required` permission on `resource`. */
export function can(principal: Pick<Principal, 'role' | 'grants'>, resource: PermissionResource, required: Permission[]): boolean {
  const granted = grantedPermissions(principal, resource);
  return required.every((permission) => granted.has(permission));
}

export type GrantRow = { organizationId: string | null; entityType: string; entityId: string; permissions: Permission[] };
export type MembershipAccess = { role: OrgRole; access: MemberAccess };

/** A member whose grant rows decide what they see (owners and admins never are). */
export function isLimitedMembership(membership: MembershipAccess | null): boolean {
  return membership?.role === 'MEMBER' && membership.access === 'LIMITED';
}

/**
 * What someone may do in one organisation:
 * - not a member there: nothing;
 * - owner, admin or FULL member: everything;
 * - LIMITED member: exactly their rows for that organisation (none means nothing), plus READ on the
 *   versions their groups are assigned (`derivedVersionReads`), so instructors can read the lessons
 *   their group uses. Rows of other organisations never count.
 */
export function grantsFromMembership(
  membership: MembershipAccess | null,
  rows: GrantRow[],
  organizationId: string,
  derivedVersionReads: string[] = []
): Grant[] {
  if (!membership) {
    return [];
  }
  if (!isLimitedMembership(membership)) {
    return FULL_ACCESS_GRANTS;
  }
  const own: Grant[] = rows
    .filter((row) => row.organizationId === organizationId)
    .map((row) => ({ entityType: row.entityType, entityId: row.entityId, permissions: row.permissions }));
  const reads: Grant[] = Array.from(new Set(derivedVersionReads)).map((versionId) => ({
    entityType: GRANT_ENTITY_TYPES.CURRICULUM_VERSION,
    entityId: versionId,
    permissions: [PERMISSION.READ],
  }));
  return [...own, ...reads];
}

/**
 * Whether a guest instructor may read a version in the team preview: NOTES on a group that reads it
 * now (`group.curriculumVersionId`: its own copy, or the version it is assigned). NOTES gives no READ,
 * so this opens the preview's lessons and the group's instructor notes, never the version's other
 * pages, its feedback, or anything else of the group.
 */
export function guestReadsGroupVersion(
  principal: Pick<Principal, 'role' | 'grants'>,
  group: { id: string; courseId: string; curriculumVersionId: string | null },
  version: { id: string; courseId: string }
): boolean {
  return (
    group.curriculumVersionId === version.id &&
    group.courseId === version.courseId &&
    can(principal, { type: GRANT_ENTITY_TYPES.GROUP, groupId: group.id, courseId: group.courseId }, [PERMISSION.NOTES])
  );
}

/** Groups granted directly (not through a course) with every `permissions`. */
export function groupGrantIds(grants: Grant[], permissions: Permission[] = [PERMISSION.READ]): string[] {
  return grants
    .filter((grant) => grant.entityType === GRANT_ENTITY_TYPES.GROUP && permissions.every((p) => grant.permissions.includes(p)))
    .map((grant) => grant.entityId);
}

/** Courses granted with every `permissions`: `'*'` for every course, else the ids (maybe none). */
export function courseGrantIds(grants: Grant[], permissions: Permission[] = [PERMISSION.READ]): '*' | string[] {
  const matching = grants.filter(
    (grant) => grant.entityType === GRANT_ENTITY_TYPES.COURSE && permissions.every((p) => grant.permissions.includes(p))
  );
  return matching.some((grant) => grant.entityId === ALL_COURSES_ENTITY_ID) ? '*' : matching.map((grant) => grant.entityId);
}

// ── Presets: what owners and admins choose on the Team page ─────────────────────────────────────

/** A limited member's access as the Team page shows it. */
export type AccessPreset = {
  scope: 'all-courses' | 'courses' | 'groups';
  courseIds: string[];
  groupIds: string[];
  /**
   * Lessons: edit (and publish) or only read them; `notes` is a guest instructor (chosen groups only):
   * their instructor link and notes, nothing else.
   */
  lessons: 'edit' | 'view' | 'notes';
  /** Feedback and tasks: work on them, or only read them (always false for a guest instructor). */
  feedback: boolean;
};

export function presetPermissions(lessons: AccessPreset['lessons'], feedback: boolean): Permission[] {
  if (lessons === 'notes') {
    return [PERMISSION.NOTES];
  }
  const base: Permission[] = lessons === 'edit' ? [PERMISSION.READ, PERMISSION.WRITE, PERMISSION.DELETE] : [PERMISSION.READ];
  return feedback ? [...base, PERMISSION.TASKS] : base;
}

/** The grant rows for a preset: one kind of row, all with the same permissions. */
export function presetToGrants(preset: AccessPreset): Grant[] {
  const permissions = presetPermissions(preset.lessons, preset.lessons !== 'notes' && preset.feedback);
  if (preset.scope === 'all-courses') {
    return [{ entityType: GRANT_ENTITY_TYPES.COURSE, entityId: ALL_COURSES_ENTITY_ID, permissions }];
  }
  const ids = Array.from(new Set(preset.scope === 'courses' ? preset.courseIds : preset.groupIds));
  const entityType = preset.scope === 'courses' ? GRANT_ENTITY_TYPES.COURSE : GRANT_ENTITY_TYPES.GROUP;
  return ids.map((entityId) => ({ entityType, entityId, permissions: [...permissions] }));
}

const sameSet = (a: Permission[], b: Permission[]) => a.length === b.length && a.every((p) => b.includes(p));

/**
 * The preset stored rows came from, or `none` (no rows: sees nothing) or `custom` (rows no preset
 * makes, e.g. set up by hand). Pass stored rows, not effective grants.
 */
export function grantsToPreset(rows: Grant[]): AccessPreset | 'none' | 'custom' {
  if (rows.length === 0) {
    return 'none';
  }
  const entityType = rows[0].entityType;
  const permissions = rows[0].permissions;
  if (
    (entityType !== GRANT_ENTITY_TYPES.COURSE && entityType !== GRANT_ENTITY_TYPES.GROUP) ||
    rows.some((row) => row.entityType !== entityType || !sameSet(row.permissions, permissions))
  ) {
    return 'custom';
  }
  const lessons: AccessPreset['lessons'] = permissions.includes(PERMISSION.WRITE)
    ? 'edit'
    : permissions.includes(PERMISSION.NOTES)
      ? 'notes'
      : 'view';
  const feedback = lessons !== 'notes' && permissions.includes(PERMISSION.TASKS);
  if (!sameSet(permissions, presetPermissions(lessons, feedback)) || (lessons === 'notes' && entityType !== GRANT_ENTITY_TYPES.GROUP)) {
    return 'custom';
  }
  const ids = rows.map((row) => row.entityId);
  if (entityType === GRANT_ENTITY_TYPES.COURSE && ids.includes(ALL_COURSES_ENTITY_ID)) {
    return ids.length === 1 ? { scope: 'all-courses', courseIds: [], groupIds: [], lessons, feedback } : 'custom';
  }
  return entityType === GRANT_ENTITY_TYPES.COURSE
    ? { scope: 'courses', courseIds: ids, groupIds: [], lessons, feedback }
    : { scope: 'groups', courseIds: [], groupIds: ids, lessons, feedback };
}
