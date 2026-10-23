import 'server-only';

import { cache } from 'react';
import { Permission } from '@prisma/client';
import { serverExtensions } from '@/extensions/server';
import { getCurrentUserSession, isOrgAdmin } from '@/lib/admin-auth';
import { accessScope, courseScopeWhere, groupScopeWhere } from '@/lib/crm-access';
import { canAccessSection } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { personalKey, rememberedKeys } from '@/lib/remembered';
import { howItWorksKey, NEW_FOR_DAYS } from '../how-it-works/data';

/**
 * Getting started: the steps to a first improved course, in one checklist behind a ring in the corner
 * of every page (it never opens by itself). Each step ticks itself when it's done (a course, a lesson, a
 * group, a colleague, their name, a booked call); any open step can be ticked by hand, and ticked
 * again to bring it back. Hidden, or with every step done, it's gone; Home can bring a hidden one back.
 * Optional steps (connecting an Obsidian vault) come after the others and don't count: ticking one by
 * hand says "not for me". Kept per person and organisation, like Getting started's Hide and How it
 * works' "done" always were.
 */

/** The steps one can tick by hand ("Create your account" is always done). */
export const TICKABLE = ['how', 'profile', 'course', 'lesson', 'group', 'invite', 'call', 'obsidian'] as const;
export type TickableStep = (typeof TICKABLE)[number];
export type GettingStartedStepId = 'account' | TickableStep;

export type GettingStartedStep = {
  id: GettingStartedStepId;
  done: boolean;
  /** Done by what happened (a course exists, a call is booked): a tick by hand can't undo it. */
  auto: boolean;
  /** Where the step is done (null: it opens here, How it works and the call). */
  href: string | null;
  /** Not one of the steps that count: listed after them, for those it suits. */
  optional?: boolean;
};

/** Getting started's call, as the edition offers and words it (`gettingStartedCall`). */
export type GettingStartedCall = { title: string; text: string; photoUrl: string; bookedAt: string | null };

export type GettingStarted = {
  steps: GettingStartedStep[];
  call: GettingStartedCall | null;
  /** They hid it: Home offers it back while steps are left. */
  hidden: boolean;
  /** They've opened it once: the note pointing at it is no longer needed. */
  opened: boolean;
};

/** Hidden: the same key Getting started's Hide on Home used, so whoever hid that doesn't see this. */
export const hiddenKey = (userId: string) => personalKey('getting-started', userId);
export const openedKey = (userId: string) => personalKey('getting-started-opened', userId);
/** A step ticked by hand; How it works keeps the "done" it always had. */
export const tickKey = (id: TickableStep, userId: string) => (id === 'how' ? howItWorksKey(userId) : personalKey(`getting-started-${id}`, userId));

/**
 * This request's checklist for the signed-in member, or null when there's nothing to show: no
 * organisation, logged in as them (a platform admin), or every step done. Once per request (the frame
 * and Home both ask).
 */
export const loadGettingStarted = cache(async (): Promise<GettingStarted | null> => {
  const viewer = (await getCurrentUserSession())?.user;
  if (!viewer?.organization || viewer.impersonator) return null;
  const organizationId = viewer.organization.id;
  // Whoever can create courses sets the organisation up: theirs are the course, lesson and group steps.
  const setsUp = canAccessSection(viewer, 'courses', [Permission.WRITE]);
  const courseWhere = courseScopeWhere(accessScope(viewer, 'courses'));
  const groupWhere = groupScopeWhere(accessScope(viewer, 'groups'));
  const [remembered, membership, call, synced, counts] = await Promise.all([
    rememberedKeys(organizationId, [hiddenKey(viewer.id), openedKey(viewer.id), ...TICKABLE.map((id) => tickKey(id, viewer.id))]),
    prisma.organizationMember.findFirst({ where: { userId: viewer.id, organizationId }, select: { createdAt: true } }),
    serverExtensions.gettingStartedCall(viewer),
    // The Obsidian plugin has synced with one of their tokens here.
    prisma.apiToken.count({
      where: { ownerId: viewer.id, organizationId, scopes: { has: 'sync' }, revokedAt: null, lastUsedAt: { not: null } },
    }),
    setsUp
      ? Promise.all([
          prisma.course.count({ where: courseWhere }),
          prisma.lesson.count({ where: { course: courseWhere } }),
          prisma.courseGroup.count({ where: groupWhere }),
          prisma.organizationMember.count({ where: { organizationId } }),
          prisma.course.findFirst({ where: courseWhere, orderBy: { createdAt: 'asc' }, select: { id: true } }),
        ])
      : null,
  ]);
  const ticked = (id: TickableStep) => remembered.has(tickKey(id, viewer.id));
  const step = (id: TickableStep, happened: boolean, href: string | null): GettingStartedStep => ({
    id,
    done: happened || ticked(id),
    auto: happened,
    href,
  });

  const steps: GettingStartedStep[] = [{ id: 'account', done: true, auto: true, href: null }];
  // How it works is for people new to the organisation, as its card on Home was.
  if (membership && Date.now() - membership.createdAt.getTime() < NEW_FOR_DAYS * 86_400_000) steps.push(step('how', false, null));
  steps.push(step('profile', Boolean(viewer.firstName), '/admin/profile'));
  if (counts) {
    const [courseCount, lessonCount, groupCount, memberCount, firstCourse] = counts;
    steps.push(step('course', courseCount > 0, '/admin/courses/new'));
    steps.push(step('lesson', lessonCount > 0, firstCourse ? `/admin/courses/${firstCourse.id}` : '/admin/courses/new'));
    steps.push(step('group', groupCount > 0, '/admin/courses/groups/new'));
    if (isOrgAdmin(viewer)) steps.push(step('invite', memberCount > 1, '/admin/team'));
  }
  if (call) steps.push(step('call', Boolean(call.bookedAt), null));
  steps.push({ ...step('obsidian', synced > 0, '/admin/api-tokens'), optional: true });

  if (steps.every((entry) => entry.done || entry.optional)) return null;
  return { steps, call, hidden: remembered.has(hiddenKey(viewer.id)), opened: remembered.has(openedKey(viewer.id)) };
});
