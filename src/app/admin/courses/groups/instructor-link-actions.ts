'use server';

import { Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { refuseWhileImpersonating } from '@/lib/admin-auth';
import { canAddInstructorNotes, canOnCourse, getCrmViewer, loadGroupRef } from '@/lib/crm-access';
import { ensureInstructorLink, resetInstructorLink, revokeInstructorLink, type InstructorLink } from '@/lib/instructor-links';

/**
 * Instructor links from the app (src/lib/instructor-links.ts). Each action checks access itself:
 * your own link needs the right to add instructor notes for the group; revoking someone else's is
 * group management (WRITE on its course).
 */

export type InstructorLinkResult =
  | { ok: true; link: { token: string; expiresAt: string } }
  | { ok: false; message: string };

function view(link: InstructorLink) {
  return { token: link.token, expiresAt: link.expiresAt.toISOString() };
}

/** The viewer and the group, when they may add instructor notes for it. */
async function noteTaker(groupId: unknown) {
  const viewer = await getCrmViewer();
  const group = viewer && typeof groupId === 'string' && groupId ? await loadGroupRef(groupId) : null;
  return viewer && group && canAddInstructorNotes(viewer, { courseId: group.courseId, groupIds: [group.id] })
    ? { viewer, group }
    : null;
}

/** Your link to the group's learner pages: made on first use, renewed after. */
export async function getInstructorLinkAction(groupId: string): Promise<InstructorLinkResult> {
  // A link is a credential of the person it belongs to, like their sync tokens.
  const refused = await refuseWhileImpersonating();
  if (refused) {
    return { ok: false, message: refused };
  }
  const [allowed, t] = await Promise.all([noteTaker(groupId), getTranslations('groups.instructorLinkActions')]);
  if (!allowed) {
    return { ok: false, message: t('noNotes') };
  }
  const link = await ensureInstructorLink(allowed.viewer.id, allowed.group.id);
  return link ? { ok: true, link: view(link) } : { ok: false, message: t('groupGone') };
}

/** A new address for your link; the old one stops working. */
export async function resetInstructorLinkAction(groupId: string): Promise<InstructorLinkResult> {
  const refused = await refuseWhileImpersonating();
  if (refused) {
    return { ok: false, message: refused };
  }
  const [allowed, t] = await Promise.all([noteTaker(groupId), getTranslations('groups.instructorLinkActions')]);
  if (!allowed) {
    return { ok: false, message: t('noNotes') };
  }
  const link = await resetInstructorLink(allowed.viewer.id, allowed.group.id);
  return link
    ? { ok: true, link: view(link) }
    : { ok: false, message: t('groupGone') };
}

/** Revokes an instructor's link to the group (people who manage the group). */
export async function revokeInstructorLinkAction(groupId: string, linkId: string): Promise<{ ok: boolean; message?: string }> {
  const [viewer, t] = await Promise.all([getCrmViewer(), getTranslations('groups.instructorLinkActions')]);
  const group = viewer && typeof groupId === 'string' && groupId ? await loadGroupRef(groupId) : null;
  if (!viewer || !group || !canOnCourse(viewer, group.courseId, [Permission.WRITE])) {
    return { ok: false, message: t('revokeNotAllowed') };
  }
  if (typeof linkId !== 'string' || !(await revokeInstructorLink(group.id, linkId))) {
    return { ok: false, message: t('alreadyGone') };
  }
  revalidatePath(`/admin/courses/groups/${group.id}`);
  return { ok: true, message: t('revoked') };
}
