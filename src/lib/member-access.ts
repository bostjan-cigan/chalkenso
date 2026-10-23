import 'server-only';

import { MemberAccess, OrgRole, Permission, type Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { grantsToPreset, presetToGrants, type AccessPreset, type Grant } from './access-rules';
import type { AccessOptions, AccessView } from './access-describe';

export { describeAccess, type AccessOptions, type AccessView } from './access-describe';
import { GRANT_ENTITY_TYPES } from './grant-scopes';
import { prisma, type TransactionClient } from './prisma';

/**
 * Members' access as owners and admins set it on the Team page: everything, or limited by a preset
 * (chosen courses or groups, edit or view lessons, work on feedback or only read it), stored as the
 * member's `UserGrant` rows in that organisation (see `access-rules.ts`). Every query here names the
 * organisation explicitly: grants, memberships and invites aren't scoped by the database client, and
 * invites are claimed outside any organisation's scope.
 */

export type { AccessInput } from './access-describe';
import type { AccessInput } from './access-describe';


const MAX_IDS = 200;

const stringIds = (value: unknown) =>
  Array.isArray(value) ? Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))).slice(0, MAX_IDS) : [];

/** The editor's JSON (`{ kind, preset }`), or null when it isn't one. */
export function parseAccessInput(raw: unknown): AccessInput | null {
  const input = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!input || typeof input !== 'object') return null;
  const { kind, preset } = input as { kind?: unknown; preset?: Record<string, unknown> };
  if (kind === 'full') return { kind: 'full' };
  if (kind !== 'limited' || !preset || typeof preset !== 'object') return null;
  const scope = preset.scope;
  if (scope !== 'all-courses' && scope !== 'courses' && scope !== 'groups') return null;
  return {
    kind: 'limited',
    preset: {
      scope,
      courseIds: scope === 'courses' ? stringIds(preset.courseIds) : [],
      groupIds: scope === 'groups' ? stringIds(preset.groupIds) : [],
      // A guest instructor (notes only) is for chosen groups only.
      lessons: preset.lessons === 'notes' && scope === 'groups' ? 'notes' : preset.lessons === 'view' ? 'view' : 'edit',
      feedback: preset.lessons !== 'notes' && preset.feedback !== false,
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The organisation's courses and groups, for the access editor. */
export async function listAccessOptions(organizationId: string): Promise<AccessOptions> {
  const [courses, groups] = await Promise.all([
    prisma.course.findMany({ where: { organizationId }, orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    prisma.courseGroup.findMany({
      where: { course: { organizationId } },
      orderBy: [{ course: { title: 'asc' } }, { name: 'asc' }],
      select: { id: true, name: true, courseId: true, course: { select: { title: true } } },
    }),
  ]);
  return {
    courses,
    groups: groups.map((group) => ({ id: group.id, name: group.name, courseId: group.courseId, courseTitle: group.course.title })),
  };
}

/** What the Team page's access saving says when it can't (`account.team.errors`), in the page's language. */
const errorWords = () => getTranslations('account.team.errors');

/** Why a preset can't be saved (no courses or groups picked, or one isn't this organisation's). */
export async function presetProblem(organizationId: string, preset: AccessPreset): Promise<string | null> {
  if (preset.scope === 'courses') {
    if (!preset.courseIds.length) return (await errorWords())('pickCourse');
    const found = await prisma.course.count({ where: { id: { in: preset.courseIds }, organizationId } });
    return found === preset.courseIds.length ? null : (await errorWords())('foreignCourses');
  }
  if (preset.scope === 'groups') {
    if (!preset.groupIds.length) return (await errorWords())('pickGroup');
    const found = await prisma.courseGroup.count({ where: { id: { in: preset.groupIds }, course: { organizationId } } });
    return found === preset.groupIds.length ? null : (await errorWords())('foreignGroups');
  }
  return null;
}

/** A membership's access as the Team page shows it (owners and admins: always full). */
export function memberAccessView(role: OrgRole, access: MemberAccess, rows: Grant[]): AccessView {
  if (role !== OrgRole.MEMBER || access === MemberAccess.FULL) return { kind: 'full' };
  return { kind: 'limited', preset: grantsToPreset(rows) };
}

/** An invite's access (stored rows in its JSON). */
export function inviteAccessView(invite: { orgRole: OrgRole; access: MemberAccess; grants: Prisma.JsonValue }): AccessView {
  return memberAccessView(invite.orgRole, invite.access, parseGrantRows(invite.grants));
}

function parseGrantRows(json: Prisma.JsonValue): Grant[] {
  if (!Array.isArray(json)) return [];
  const permissions = new Set<string>(Object.values(Permission));
  return json.flatMap((entry) => {
    const row = entry as { entityType?: unknown; entityId?: unknown; permissions?: unknown };
    if (
      (row.entityType !== GRANT_ENTITY_TYPES.COURSE && row.entityType !== GRANT_ENTITY_TYPES.GROUP) ||
      typeof row.entityId !== 'string' ||
      !Array.isArray(row.permissions)
    ) {
      return [];
    }
    const valid = row.permissions.filter((permission): permission is Permission => typeof permission === 'string' && permissions.has(permission));
    return valid.length ? [{ entityType: row.entityType, entityId: row.entityId, permissions: valid }] : [];
  });
}

/** Each member's access view, by user id (one query for every member's rows). */
export async function getMemberAccessViews(
  organizationId: string,
  members: Array<{ userId: string; role: OrgRole; access: MemberAccess }>
): Promise<Map<string, AccessView>> {
  const rows = await prisma.userGrant.findMany({
    where: { organizationId, userId: { in: members.map((member) => member.userId) } },
    select: { userId: true, entityType: true, entityId: true, permissions: true },
  });
  return new Map(
    members.map((member) => [
      member.userId,
      memberAccessView(
        member.role,
        member.access,
        rows.filter((row) => row.userId === member.userId)
      ),
    ])
  );
}

// ── Saving access ───────────────────────────────────────────────────────────────────────────────

type Result = { ok: true } | { ok: false; message: string };

/** Sets a member's access in one go: the flag and exactly the preset's rows (members only). */
export async function setMemberAccess(actorId: string, organizationId: string, memberId: string, input: AccessInput): Promise<Result> {
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, userId: true, role: true },
  });
  if (!member) return { ok: false, message: (await errorWords())('notOnTeam') };
  if (member.role !== OrgRole.MEMBER) return { ok: false, message: (await errorWords())('alwaysFull') };
  if (input.kind === 'limited') {
    const problem = await presetProblem(organizationId, input.preset);
    if (problem) return { ok: false, message: problem };
  }
  const grants = input.kind === 'limited' ? presetToGrants(input.preset) : [];
  await prisma.$transaction([
    prisma.organizationMember.update({
      where: { id: member.id },
      data: { access: input.kind === 'limited' ? MemberAccess.LIMITED : MemberAccess.FULL },
    }),
    prisma.userGrant.deleteMany({ where: { userId: member.userId, organizationId } }),
    prisma.userGrant.createMany({
      data: grants.map((grant) => ({
        userId: member.userId,
        organizationId,
        entityType: grant.entityType,
        entityId: grant.entityId,
        permissions: grant.permissions,
        createdById: actorId,
      })),
    }),
  ]);
  return { ok: true };
}

/** What an invite stores for its access (members only; everyone else joins with full access). */
export function inviteAccessData(role: OrgRole, input: AccessInput | null): { access: MemberAccess; grants: Prisma.InputJsonValue } {
  if (role !== OrgRole.MEMBER || !input || input.kind === 'full') {
    return { access: MemberAccess.FULL, grants: [] };
  }
  return { access: MemberAccess.LIMITED, grants: presetToGrants(input.preset) as unknown as Prisma.InputJsonValue };
}

/**
 * Gives a new member the access their invite carries (inside the claim's transaction, outside any
 * organisation's scope). Courses or groups deleted since the invite are dropped; if none are left
 * the member is LIMITED with nothing, never full.
 */
export async function applyInviteAccess(
  tx: TransactionClient,
  invite: { orgRole: OrgRole; access: MemberAccess; grants: Prisma.JsonValue; createdById: string | null },
  userId: string,
  organizationId: string
) {
  if (invite.orgRole !== OrgRole.MEMBER || invite.access !== MemberAccess.LIMITED) return;
  const rows = parseGrantRows(invite.grants);
  const courseIds = rows.filter((row) => row.entityType === GRANT_ENTITY_TYPES.COURSE).map((row) => row.entityId);
  const groupIds = rows.filter((row) => row.entityType === GRANT_ENTITY_TYPES.GROUP).map((row) => row.entityId);
  const [courses, groups] = await Promise.all([
    tx.course.findMany({ where: { id: { in: courseIds }, organizationId }, select: { id: true } }),
    tx.courseGroup.findMany({ where: { id: { in: groupIds }, course: { organizationId } }, select: { id: true } }),
  ]);
  const known = new Set([...courses.map((course) => course.id), ...groups.map((group) => group.id)]);
  // `course:*` (every course) is not a course row.
  const valid = rows.filter((row) => row.entityId === '*' ? row.entityType === GRANT_ENTITY_TYPES.COURSE : known.has(row.entityId));
  await tx.organizationMember.update({
    where: { organizationId_userId: { organizationId, userId } },
    data: { access: MemberAccess.LIMITED },
  });
  await tx.userGrant.deleteMany({ where: { userId, organizationId } });
  if (valid.length) {
    await tx.userGrant.createMany({
      data: valid.map((row) => ({
        userId,
        organizationId,
        entityType: row.entityType,
        entityId: row.entityId,
        permissions: row.permissions,
        createdById: invite.createdById,
      })),
    });
  }
}
