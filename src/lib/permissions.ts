import 'server-only';

import { Permission, type UserRole } from '@prisma/client';
import {
  can,
  courseGrantIds,
  grantedPermissions,
  grantsFromMembership,
  groupGrantIds,
  isLimitedMembership,
  isSuperAdmin,
  type Grant,
  type GrantRow,
  type MembershipAccess,
  type Principal,
} from './access-rules';
import { ADMIN_SECTIONS, GRANT_ENTITY_TYPES, type AdminSectionKey } from './grant-scopes';
import { withoutOrgScope } from './org-context';
import { prisma } from './prisma';

export {
  ADMIN_SECTIONS,
  ALL_COURSES_ENTITY_ID,
  ALL_GRANT_ENTITY_ID,
  CONTENT_GRANT_ENTITY_ID,
  GRANT_ENTITY_TYPES,
  type AdminSectionKey,
  type GrantEntityType,
} from './grant-scopes';
export {
  can,
  courseGrantIds,
  FULL_ACCESS_GRANTS,
  grantCovers,
  grantedPermissions,
  grantsFromMembership,
  groupGrantIds,
  guestReadsGroupVersion,
  isLimitedMembership,
  isSuperAdmin,
  type Grant,
  type GrantRow,
  type MembershipAccess,
  type PermissionResource,
  type Principal,
} from './access-rules';

const ALL_PERMISSIONS = Object.values(Permission);

/**
 * The versions a limited member's groups are assigned (core or the group's own copy), so instructors
 * can read the lessons their group uses. Runs outside the organisation scope (it is called while the
 * session itself is being built) with the organisation filtered explicitly.
 */
async function groupReadVersionIds(groupIds: string[], organizationId: string): Promise<string[]> {
  if (!groupIds.length) {
    return [];
  }
  const groups = await withoutOrgScope(() =>
    prisma.courseGroup.findMany({
      where: { id: { in: groupIds }, course: { organizationId } },
      select: { curriculumVersionId: true },
    })
  );
  return groups.map((group) => group.curriculumVersionId).filter((id): id is string => Boolean(id));
}

/**
 * What someone may do in one organisation, from their membership there and their grant rows (see
 * `grantsFromMembership`). One rule for sessions, sync tokens and the Claude connector; only the
 * active organisation's membership and rows ever count.
 */
export async function resolveGrants(membership: MembershipAccess | null, rows: GrantRow[], organizationId: string): Promise<Grant[]> {
  if (!isLimitedMembership(membership)) {
    return grantsFromMembership(membership, rows, organizationId);
  }
  const own = rows.filter((row) => row.organizationId === organizationId);
  const derived = await groupReadVersionIds(groupGrantIds(own), organizationId);
  return grantsFromMembership(membership, own, organizationId, derived);
}

/** `resolveGrants` for one person in one organisation, read now (never cached on a token). */
export async function grantsFor(userId: string, organizationId: string): Promise<Grant[]> {
  return (await membershipGrants(userId, organizationId)).grants;
}

/** Whether the person is in the organisation, and their grants there: one round trip, read now. */
export async function membershipGrants(userId: string, organizationId: string): Promise<{ member: boolean; grants: Grant[] }> {
  const [membership, rows] = await withoutOrgScope(() =>
    Promise.all([
      prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { role: true, access: true },
      }),
      prisma.userGrant.findMany({
        where: { userId, organizationId },
        select: { organizationId: true, entityType: true, entityId: true, permissions: true },
      }),
    ])
  );
  return { member: Boolean(membership), grants: await resolveGrants(membership, rows, organizationId) };
}

/** Whether the principal may use `section` of the admin with every `required` permission. */
export function canAccessSection(
  principal: { role: UserRole; grants: Grant[] },
  section: AdminSectionKey,
  required: Permission[] = [Permission.READ]
): boolean {
  return can(principal, { type: GRANT_ENTITY_TYPES.ADMIN_SECTION, section }, required);
}

/** Every admin section the principal can open (READ), in registry order. */
export function readableAdminSections(
  principal: Pick<Principal, 'role' | 'grants'>
): AdminSectionKey[] {
  return (Object.keys(ADMIN_SECTIONS) as AdminSectionKey[]).filter((section) =>
    canAccessSection(principal, section)
  );
}

/** Orders permissions canonically (READ, WRITE, DELETE, TASKS) for stable API output. */
export function sortPermissions(permissions: Iterable<Permission>): Permission[] {
  const set = new Set(permissions);

  return ALL_PERMISSIONS.filter((permission) => set.has(permission));
}

export type AccessibleCurriculumVersion = {
  id: string;
  /** `core` for the shared curriculum, `group` for a feedback-driven group's own copy. */
  kind: 'core' | 'group';
  label: string;
  version: number;
  status: string;
  course: { id: string; title: string; slug: string };
  group: { id: string; name: string } | null;
  baseVersion: { id: string; label: string } | null;
  permissions: Permission[];
};

/**
 * Every curriculum version the principal holds at least one permission on, with the effective
 * permissions: core versions sorted by course title then newest first, followed by the group
 * curricula. Closed (archived) group curricula are left out — they no longer sync.
 */
export async function listAccessibleCurriculumVersions(
  principal: Principal
): Promise<AccessibleCurriculumVersion[]> {
  const idsOfType = (entityType: string) =>
    principal.grants
      .filter((grant) => grant.entityType === entityType)
      .map((grant) => grant.entityId);

  const courses = courseGrantIds(principal.grants, []);
  const coversEverything =
    isSuperAdmin(principal) || idsOfType(GRANT_ENTITY_TYPES.ALL).length > 0 || courses === '*';

  const versions = await prisma.curriculumVersion.findMany({
    where: {
      archivedAt: null,
      ...(coversEverything
        ? {}
        : {
            OR: [
              // A course covers its core versions and its groups' copies.
              { courseId: { in: courses } },
              { id: { in: idsOfType(GRANT_ENTITY_TYPES.CURRICULUM_VERSION) } },
              { ownerGroupId: { in: idsOfType(GRANT_ENTITY_TYPES.GROUP) } },
            ],
          }),
    },
    orderBy: [{ course: { title: 'asc' } }, { version: 'desc' }],
    select: {
      id: true,
      label: true,
      version: true,
      status: true,
      courseId: true,
      ownerGroupId: true,
      course: { select: { id: true, title: true, slug: true } },
      ownerGroup: { select: { id: true, name: true } },
      baseVersion: { select: { id: true, label: true } },
    },
  });

  return versions
    .map(({ courseId, ownerGroupId, ownerGroup, ...version }) => ({
      ...version,
      kind: ownerGroupId ? ('group' as const) : ('core' as const),
      group: ownerGroup,
      permissions: sortPermissions(
        grantedPermissions(principal, {
          type: GRANT_ENTITY_TYPES.CURRICULUM_VERSION,
          versionId: version.id,
          courseId,
          ownerGroupId,
        })
      ),
    }))
    .filter((version) => version.permissions.length > 0)
    // Core first (negative ordinals would otherwise interleave), then group curricula.
    .sort((a, b) => Number(a.kind === 'group') - Number(b.kind === 'group'));
}
