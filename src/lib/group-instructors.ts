import 'server-only';

import { Permission, type MemberAccess, type OrgRole } from '@prisma/client';
import { grantsFromMembership, grantsToPreset, presetPermissions, type Grant } from './access-rules';
import { displayName } from './admin-auth';
import { canAddInstructorNotes } from './crm-access';
import { GRANT_ENTITY_TYPES } from './grant-scopes';
import { prisma, type DbClient } from './prisma';

/**
 * Who teaches a group: team members of any role (guest instructors too), all equal, in the order they
 * were added. Learners see their names (first and last only, never a sign-in name or email). Assigning
 * someone gives them what they need to add notes for the group when they lack it
 * (`accessForAssignment`); removing them leaves their access alone (the Team page changes access).
 */

export type GroupInstructor = {
  userId: string;
  /** How the team sees them. */
  name: string;
  /** How learners see them: first and last name, or null when they have none (then they aren't listed). */
  publicName: string | null;
};

const USER_SELECT = { id: true, firstName: true, lastName: true, identifier: true } as const;

function publicName(user: { firstName: string | null; lastName: string | null }) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;
}

function toInstructor(user: { id: string; firstName: string | null; lastName: string | null; identifier: string }): GroupInstructor {
  return { userId: user.id, name: displayName(user), publicName: publicName(user) };
}

/** A group's instructors, in the order they were added. */
export async function listGroupInstructors(groupId: string): Promise<GroupInstructor[]> {
  const rows = await prisma.courseGroupInstructor.findMany({
    where: { groupId },
    orderBy: { createdAt: 'asc' },
    select: { user: { select: USER_SELECT } },
  });
  return rows.map((row) => toInstructor(row.user));
}

/** Instructors of several groups at once (the groups list), by group id. */
export async function instructorsByGroup(groupIds: string[]): Promise<Map<string, GroupInstructor[]>> {
  const byGroup = new Map<string, GroupInstructor[]>();
  if (!groupIds.length) {
    return byGroup;
  }
  const rows = await prisma.courseGroupInstructor.findMany({
    where: { groupId: { in: groupIds } },
    orderBy: { createdAt: 'asc' },
    select: { groupId: true, user: { select: USER_SELECT } },
  });
  for (const row of rows) {
    byGroup.set(row.groupId, [...(byGroup.get(row.groupId) ?? []), toInstructor(row.user)]);
  }
  return byGroup;
}

/** The names learners see for a group's instructors (people without a name are left out). */
export async function publicInstructorNames(groupId: string | null): Promise<string[]> {
  if (!groupId) {
    return [];
  }
  return (await listGroupInstructors(groupId)).flatMap((instructor) => (instructor.publicName ? [instructor.publicName] : []));
}

/** The groups someone teaches, by id. */
export async function groupIdsTaughtBy(userId: string): Promise<string[]> {
  const rows = await prisma.courseGroupInstructor.findMany({ where: { userId }, select: { groupId: true } });
  return rows.map((row) => row.groupId);
}

/**
 * What assigning someone to teach a group gives them: nothing when they can already add notes there
 * (owners, admins, full members, limited members with feedback work on it); otherwise a grant on the
 * group. A limited member with a preset gets the group at that level; someone with no rows or custom
 * rows gets notes only (a guest instructor); someone who reads the group but can't add notes gets
 * NOTES added to their row there.
 */
export type AssignmentAccess = { kind: 'none' } | { kind: 'grant'; permissions: Permission[] };

type Candidate = {
  userId: string;
  role: OrgRole;
  access: MemberAccess;
  rows: Array<{ organizationId: string | null; entityType: string; entityId: string; permissions: Permission[] }>;
};

function assignmentAccess(candidate: Candidate, organizationId: string, group: { id: string; courseId: string }): AssignmentAccess {
  const grants = grantsFromMembership({ role: candidate.role, access: candidate.access }, candidate.rows, organizationId);
  const viewer = { id: candidate.userId, role: 'USER' as const, grants, organizationId };
  if (canAddInstructorNotes(viewer, { courseId: group.courseId, groupIds: [group.id] })) {
    return { kind: 'none' };
  }
  const own = candidate.rows.filter((row) => row.organizationId === organizationId);
  const existing = own.find((row) => row.entityType === GRANT_ENTITY_TYPES.GROUP && row.entityId === group.id);
  if (existing) {
    return { kind: 'grant', permissions: Array.from(new Set([...existing.permissions, Permission.NOTES])) };
  }
  const preset = grantsToPreset(own as Grant[]);
  return {
    kind: 'grant',
    permissions: typeof preset === 'object' ? presetPermissions(preset.lessons, preset.feedback) : [Permission.NOTES],
  };
}

async function loadCandidates(
  organizationId: string,
  userIds?: string[],
  db: DbClient = prisma
): Promise<Array<Candidate & { name: string }>> {
  const members = await db.organizationMember.findMany({
    where: { organizationId, ...(userIds ? { userId: { in: userIds } } : {}), user: { isActive: true } },
    select: {
      userId: true,
      role: true,
      access: true,
      user: {
        select: {
          ...USER_SELECT,
          grants: {
            where: { organizationId },
            select: { organizationId: true, entityType: true, entityId: true, permissions: true },
          },
        },
      },
    },
  });
  return members.map((member) => ({
    userId: member.userId,
    role: member.role,
    access: member.access,
    rows: member.user.grants,
    name: displayName(member.user),
  }));
}

export type AssignableInstructor = { userId: string; name: string; access: AssignmentAccess };

/** The team members who could teach a group (not yet teaching it), with what assigning them gives. */
export async function listAssignableInstructors(
  organizationId: string,
  group: { id: string; courseId: string }
): Promise<AssignableInstructor[]> {
  const [candidates, current] = await Promise.all([loadCandidates(organizationId), groupInstructorIds(group.id)]);
  return candidates
    .filter((candidate) => !current.has(candidate.userId))
    .map((candidate) => ({ userId: candidate.userId, name: candidate.name, access: assignmentAccess(candidate, organizationId, group) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function groupInstructorIds(groupId: string) {
  const rows = await prisma.courseGroupInstructor.findMany({ where: { groupId }, select: { userId: true } });
  return new Set(rows.map((row) => row.userId));
}

type AssignInput = {
  organizationId: string;
  group: { id: string; courseId: string };
  userId: string;
  actorId: string | null;
};
/** A refusal's `reason` is its message's key in `groups.instructors` (the group page translates it). */
type AssignResult = { ok: true; access: AssignmentAccess } | { ok: false; reason: 'notOnTeam'; message: string };

/**
 * Assigns someone to teach a group, with the grant they need there (one transaction). The caller
 * checks that the actor may manage the group. Fails when they aren't on the organisation's team.
 */
export async function addGroupInstructor(input: AssignInput): Promise<AssignResult> {
  return prisma.$transaction((transaction) => assignGroupInstructor(transaction, input));
}

/**
 * `addGroupInstructor` inside an open transaction (claiming an invite from a group's page, where the
 * membership was made a moment ago in the same transaction).
 */
export async function assignGroupInstructor(db: DbClient, input: AssignInput): Promise<AssignResult> {
  const [candidate] = await loadCandidates(input.organizationId, [input.userId], db);
  if (!candidate) {
    return { ok: false, reason: 'notOnTeam', message: 'They aren’t on this team.' };
  }
  const access = assignmentAccess(candidate, input.organizationId, input.group);
  await db.courseGroupInstructor.upsert({
    where: { groupId_userId: { groupId: input.group.id, userId: input.userId } },
    create: { groupId: input.group.id, userId: input.userId, createdById: input.actorId },
    update: {},
  });
  if (access.kind === 'grant') {
    const row = await db.userGrant.findFirst({
      where: {
        userId: input.userId,
        organizationId: input.organizationId,
        entityType: GRANT_ENTITY_TYPES.GROUP,
        entityId: input.group.id,
      },
      select: { id: true },
    });
    if (row) {
      await db.userGrant.update({ where: { id: row.id }, data: { permissions: access.permissions } });
    } else {
      await db.userGrant.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId,
          entityType: GRANT_ENTITY_TYPES.GROUP,
          entityId: input.group.id,
          permissions: access.permissions,
          createdById: input.actorId,
        },
      });
    }
  }
  return { ok: true, access };
}

/** Takes someone off a group's instructors; their access stays as it is. */
export async function removeGroupInstructor(groupId: string, userId: string): Promise<boolean> {
  const result = await prisma.courseGroupInstructor.deleteMany({ where: { groupId, userId } });
  return result.count > 0;
}

export type PendingGroupInvite = { id: string; label: string; expiresAt: Date };

/** Invites sent from a group's page that nobody has used yet (newest first). */
export async function listPendingGroupInvites(organizationId: string, groupId: string): Promise<PendingGroupInvite[]> {
  return prisma.userInvite.findMany({
    where: { organizationId, teachesGroupId: groupId, claimedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, expiresAt: true },
  });
}

/** Withdraws an unused invite sent from this group's page (never another invite of the team). */
export async function withdrawGroupInvite(organizationId: string, groupId: string, inviteId: string): Promise<boolean> {
  const result = await prisma.userInvite.updateMany({
    where: { id: inviteId, organizationId, teachesGroupId: groupId, claimedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}
