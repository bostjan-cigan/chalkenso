import 'server-only';

import type { UserRole } from '@prisma/client';
import { grantsFor } from './permissions';
import { prisma } from './prisma';
import { createPublicAccessToken } from './security';

/**
 * Instructor links: one person's link to a group's learner pages (on Chalkenso or the organisation's
 * own website), so they can teach from what learners read and mark what happened in class. Their
 * marks are instructor notes under their name (`authorUserId`), never learner feedback; the link
 * answers no lesson questions or surveys and counts no reading. It carries no version (it follows the
 * group) and works only while its person may still add notes for the group, checked on every request.
 *
 * An instructor link is an `AccessLink` with `groupId` and `instructorUserId`. Anything that means
 * "the group's shared link" filters `instructorUserId: null` (the group page's link and count, minting
 * and revoking the group link, a version change).
 */

const DAY = 24 * 60 * 60 * 1000;

/** Until the group's end plus 30 days (at least a week from now), or 180 days without an end. */
export function instructorLinkExpiry(endsAt: Date | null, now = new Date()): Date {
  if (!endsAt) {
    return new Date(now.getTime() + 180 * DAY);
  }
  return new Date(Math.max(endsAt.getTime() + 30 * DAY, now.getTime() + 7 * DAY));
}

/**
 * Whose a link is, when they may still add notes for its group through it: an active account whose
 * membership and access in the group's organisation, read now, allow instructor notes there. Null
 * otherwise (the link then reads as revoked).
 *
 * Loads `crm-access` and `admin-auth` lazily: `course-access` calls this, and both lead back to it
 * through the edition's extensions, so static imports would make a cycle.
 */
export async function instructorAccess(
  user: { id: string; role: UserRole; isActive: boolean; firstName: string | null; lastName: string | null; identifier: string },
  group: { id: string; courseId: string; organizationId: string }
): Promise<{ userId: string; name: string } | null> {
  if (!user.isActive) {
    return null;
  }
  const [{ canAddInstructorNotes }, { displayName }, grants] = await Promise.all([
    import('./crm-access'),
    import('./admin-auth'),
    grantsFor(user.id, group.organizationId),
  ]);
  const allowed = canAddInstructorNotes(
    { id: user.id, role: user.role, grants, organizationId: group.organizationId },
    { courseId: group.courseId, groupIds: [group.id] }
  );
  return allowed ? { userId: user.id, name: displayName(user) } : null;
}

const LINK_SELECT = { id: true, token: true, expiresAt: true, lastAccessedAt: true } as const;

export type InstructorLink = { id: string; token: string; expiresAt: Date; lastAccessedAt: Date | null };

async function groupEnd(groupId: string) {
  return prisma.courseGroup.findUnique({ where: { id: groupId }, select: { id: true, endsAt: true } });
}

/**
 * The person's link to a group: the active one, renewed (the same address keeps working), or a new
 * one. The caller checks that they may add notes for the group.
 */
export async function ensureInstructorLink(userId: string, groupId: string): Promise<InstructorLink | null> {
  const group = await groupEnd(groupId);
  if (!group) {
    return null;
  }
  const now = new Date();
  const expiresAt = instructorLinkExpiry(group.endsAt, now);
  const active = await prisma.accessLink.findFirst({
    where: { instructorUserId: userId, groupId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: LINK_SELECT,
  });
  if (active) {
    return active.expiresAt >= expiresAt
      ? active
      : prisma.accessLink.update({ where: { id: active.id }, data: { expiresAt }, select: LINK_SELECT });
  }
  return prisma.accessLink.create({
    data: { groupId, instructorUserId: userId, expiresAt, token: createPublicAccessToken() },
    select: LINK_SELECT,
  });
}

/** A new address for the person's link (the old one stops working). The caller checks access. */
export async function resetInstructorLink(userId: string, groupId: string): Promise<InstructorLink | null> {
  const group = await groupEnd(groupId);
  if (!group) {
    return null;
  }
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    await transaction.accessLink.updateMany({
      where: { instructorUserId: userId, groupId, revokedAt: null },
      data: { revokedAt: now },
    });
    return transaction.accessLink.create({
      data: { groupId, instructorUserId: userId, expiresAt: instructorLinkExpiry(group.endsAt, now), token: createPublicAccessToken() },
      select: LINK_SELECT,
    });
  });
}

/** Revokes one instructor link of a group (for the people who manage the group). */
export async function revokeInstructorLink(groupId: string, linkId: string): Promise<boolean> {
  const result = await prisma.accessLink.updateMany({
    where: { id: linkId, groupId, instructorUserId: { not: null }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export type GroupInstructorLink = {
  id: string;
  name: string;
  userId: string;
  expiresAt: Date;
  lastAccessedAt: Date | null;
};

/** The group's active instructor links, with whose they are (for the people who manage the group). */
export async function listGroupInstructorLinks(groupId: string): Promise<GroupInstructorLink[]> {
  const { displayName } = await import('./admin-auth');
  const links = await prisma.accessLink.findMany({
    where: { groupId, instructorUserId: { not: null }, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      expiresAt: true,
      lastAccessedAt: true,
      instructorUser: { select: { id: true, firstName: true, lastName: true, identifier: true } },
    },
  });
  return links.flatMap((link) =>
    link.instructorUser
      ? [
          {
            id: link.id,
            userId: link.instructorUser.id,
            name: displayName(link.instructorUser),
            expiresAt: link.expiresAt,
            lastAccessedAt: link.lastAccessedAt,
          },
        ]
      : []
  );
}

/** The person's active link to a group, if they have one (nothing is created). */
export async function findInstructorLink(userId: string, groupId: string): Promise<InstructorLink | null> {
  return prisma.accessLink.findFirst({
    where: { instructorUserId: userId, groupId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: LINK_SELECT,
  });
}

/** `findInstructorLink` for several groups in one query, by group id (groups without one are left out). */
export async function findInstructorLinks(userId: string, groupIds: string[]): Promise<Map<string, InstructorLink>> {
  if (!groupIds.length) {
    return new Map();
  }
  const links = await prisma.accessLink.findMany({
    where: { instructorUserId: userId, groupId: { in: groupIds }, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { ...LINK_SELECT, groupId: true },
  });
  const byGroup = new Map<string, InstructorLink>();
  for (const { groupId, ...link } of links) {
    // Newest first: the first one seen is the one `findInstructorLink` would return.
    if (groupId && !byGroup.has(groupId)) byGroup.set(groupId, link);
  }
  return byGroup;
}
