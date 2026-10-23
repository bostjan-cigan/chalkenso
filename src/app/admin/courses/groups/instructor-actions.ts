'use server';

import { OrgRole, Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { serverExtensions } from '@/extensions/server';
import { canOnCourse, getCrmViewer, loadGroupRef } from '@/lib/crm-access';
import { addGroupInstructor, removeGroupInstructor, withdrawGroupInvite } from '@/lib/group-instructors';
import { createInviteWithinSeats } from '@/lib/organizations';
import { absoluteUrl } from '@/lib/site';
import { displayName, getCurrentUserSession } from '@/lib/admin-auth';
import { emailInvite, inviteEmailProblem } from '@/lib/invite-mail';
import { prisma } from '@/lib/prisma';

/**
 * Who teaches a group (src/lib/group-instructors.ts). Each action checks access itself: assigning and
 * removing instructors is group management (WRITE on its course), like the group's settings.
 */

type Result = { ok: boolean; message?: string };

async function manager(groupId: unknown) {
  const viewer = await getCrmViewer();
  const group = viewer && typeof groupId === 'string' && groupId ? await loadGroupRef(groupId) : null;
  return viewer?.organizationId && group && canOnCourse(viewer, group.courseId, [Permission.WRITE])
    ? { viewer, group, organizationId: viewer.organizationId }
    : null;
}

function changed(group: { id: string; courseId: string }) {
  revalidatePath('/admin/courses/groups');
  revalidatePath(`/admin/courses/groups/${group.id}`);
  // Learner pages show the group's instructors: the organisation's website refreshes them.
  serverExtensions.onCourseUpdated([group.courseId]);
}

/** Adds someone to the group's instructors, with the access they need there. */
export async function addGroupInstructorAction(groupId: string, userId: string): Promise<Result> {
  const [allowed, t] = await Promise.all([manager(groupId), getTranslations('groups.instructorActions')]);
  if (!allowed) {
    return { ok: false, message: t('chooseNotAllowed') };
  }
  if (typeof userId !== 'string' || !userId) {
    return { ok: false, message: t('pickSomeone') };
  }
  const result = await addGroupInstructor({
    organizationId: allowed.organizationId,
    group: allowed.group,
    userId,
    actorId: allowed.viewer.id,
  });
  if (!result.ok) {
    return { ok: false, message: t(result.reason) };
  }
  changed(allowed.group);
  return { ok: true, message: result.access.kind === 'grant' ? t('addedWithAccess') : t('added') };
}

/** Takes someone off the group's instructors (their access stays). */
export async function removeGroupInstructorAction(groupId: string, userId: string): Promise<Result> {
  const [allowed, t] = await Promise.all([manager(groupId), getTranslations('groups.instructorActions')]);
  if (!allowed) {
    return { ok: false, message: t('chooseNotAllowed') };
  }
  if (typeof userId !== 'string' || !(await removeGroupInstructor(allowed.group.id, userId))) {
    return { ok: false, message: t('noLongerTeaches') };
  }
  changed(allowed.group);
  return { ok: true, message: t('removed') };
}

/**
 * An invite link for a guest instructor of this group: they join the team with notes on the group
 * (a guest instructor) and become one of its instructors. Someone already on the team keeps their
 * access and becomes an instructor, with what they need there. The email goes out in the sender's
 * language (`emailInvite`): the person invited usually has no account yet, so no language of their own.
 */
export async function inviteGuestInstructorAction(
  groupId: string,
  name: string,
  /** Email it to them as well (empty: just the link). */
  email = ''
): Promise<Result & { link?: string }> {
  const [allowed, t] = await Promise.all([manager(groupId), getTranslations('groups.instructorActions')]);
  if (!allowed) {
    return { ok: false, message: t('inviteNotAllowed') };
  }
  const label = typeof name === 'string' ? name.trim() : '';
  if (!label) {
    return { ok: false, message: t('sayWho') };
  }
  const emailTo = typeof email === 'string' ? email.trim() : '';
  if (emailTo && inviteEmailProblem(emailTo)) {
    return { ok: false, message: t('emailInvalid') };
  }
  // A guest instructor takes a seat too, from the moment the invite exists.
  const created = await createInviteWithinSeats({
    organizationId: allowed.organizationId,
    createdById: allowed.viewer.id,
    label,
    role: OrgRole.MEMBER,
    access: {
      kind: 'limited',
      preset: { scope: 'groups', courseIds: [], groupIds: [allowed.group.id], lessons: 'notes', feedback: false },
    },
    teachesGroupId: allowed.group.id,
  });
  if (!created.ok) {
    return { ok: false, message: created.message };
  }
  const token = created.value;
  const link = absoluteUrl(`/invite/${token}`);
  let emailed = false;
  if (emailTo) {
    const [group, session] = await Promise.all([
      prisma.courseGroup.findUnique({ where: { id: allowed.group.id }, select: { name: true, course: { select: { title: true } } } }),
      getCurrentUserSession(),
    ]);
    emailed = await emailInvite({
      token,
      to: emailTo,
      organizationName: session?.user.organization?.name ?? '',
      inviterName: session ? displayName(session.user) : t('yourTeam'),
      link,
      teaches: group ? { group: group.name, course: group.course.title } : null,
    });
  }
  revalidatePath(`/admin/courses/groups/${allowed.group.id}`);
  revalidatePath('/admin/team');
  return {
    ok: true,
    message: emailTo ? (emailed ? t('emailed', { email: emailTo }) : t('emailFailed')) : t('linkReady'),
    link,
  };
}

/** Withdraws an unused invite sent from this group's page. */
export async function withdrawGuestInviteAction(groupId: string, inviteId: string): Promise<Result> {
  const [allowed, t] = await Promise.all([manager(groupId), getTranslations('groups.instructorActions')]);
  if (!allowed) {
    return { ok: false, message: t('inviteNotAllowed') };
  }
  if (typeof inviteId !== 'string' || !(await withdrawGroupInvite(allowed.organizationId, allowed.group.id, inviteId))) {
    return { ok: false, message: t('inviteGone') };
  }
  revalidatePath(`/admin/courses/groups/${allowed.group.id}`);
  revalidatePath('/admin/team');
  return { ok: true, message: t('withdrawn') };
}
