'use server';

import { OrgRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { displayName, requireOrgAdmin } from '@/lib/admin-auth';
import { emailInvite, inviteEmailProblem } from '@/lib/invite-mail';
import { parseAccessInput, presetProblem, setMemberAccess } from '@/lib/member-access';
import { changeMemberRole, createInviteWithinSeats, removeMember, revokeInvite, signOutMember } from '@/lib/organizations';
import { absoluteUrl } from '@/lib/site';

/** What the Team page's forms say back, in the page's language (`account.team.actions`). */
export type TeamActionState = { error: string | null; message: string | null; link?: string | null };

const words = () => getTranslations('account.team.actions');

function parseRole(value: FormDataEntryValue | null): OrgRole | null {
  const text = String(value ?? '');
  return text === OrgRole.OWNER || text === OrgRole.ADMIN || text === OrgRole.MEMBER ? text : null;
}

export async function createInviteAction(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const user = await requireOrgAdmin();
  const t = await words();
  const role = parseRole(formData.get('role')) ?? OrgRole.MEMBER;
  // A member's access (owners and admins always join with everything).
  const access = role === OrgRole.MEMBER ? parseAccessInput(String(formData.get('access') ?? '')) : null;
  if (access?.kind === 'limited') {
    const problem = await presetProblem(user.organization.id, access.preset);
    if (problem) {
      return { error: problem, message: null };
    }
  }
  // Emailed to them, or a link to copy and send yourself.
  const emailTo = formData.get('delivery') === 'email' ? String(formData.get('email') ?? '').trim() : '';
  if (formData.get('delivery') === 'email') {
    if (inviteEmailProblem(emailTo)) {
      return { error: t('emailMissing'), message: null };
    }
  }
  // An invite holds a seat until it is used (the edition's limit, e.g. a plan's), checked as it's made.
  const created = await createInviteWithinSeats({
    organizationId: user.organization.id,
    createdById: user.id,
    label: String(formData.get('label') ?? ''),
    role,
    access,
  });
  if (!created.ok) {
    return { error: created.message, message: null };
  }
  const token = created.value;
  const link = absoluteUrl(`/invite/${token}`);
  const emailed = emailTo
    ? await emailInvite({ token, to: emailTo, organizationName: user.organization.name, inviterName: displayName(user), link })
    : false;
  revalidatePath('/admin/team');
  return {
    error: null,
    message: emailTo ? (emailed ? t('emailed', { email: emailTo }) : t('emailFailed')) : t('linkCreated'),
    link,
  };
}

export async function revokeInviteAction(formData: FormData) {
  const user = await requireOrgAdmin();
  await revokeInvite(user.organization.id, String(formData.get('inviteId') ?? ''));
  revalidatePath('/admin/team');
}

export async function changeRoleAction(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const user = await requireOrgAdmin();
  const t = await words();
  const role = parseRole(formData.get('role'));
  if (!role) {
    return { error: t('chooseRole'), message: null };
  }
  const result = await changeMemberRole(user, user.organization.id, String(formData.get('memberId') ?? ''), role);
  revalidatePath('/admin/team');
  return result.ok ? { error: null, message: t('roleUpdated') } : { error: result.message, message: null };
}

export async function removeMemberAction(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const user = await requireOrgAdmin();
  const result = await removeMember(user, user.organization.id, String(formData.get('memberId') ?? ''));
  revalidatePath('/admin/team');
  return result.ok ? { error: null, message: (await words())('removed') } : { error: result.message, message: null };
}

/**
 * "Sign out" under a member's ⋯: their sessions here end, and they sign in again to open this
 * organisation. People with your role or below; never yourself.
 */
export async function signOutMemberAction(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const user = await requireOrgAdmin();
  const result = await signOutMember(user, user.organization.id, String(formData.get('memberId') ?? ''));
  revalidatePath('/admin/team');
  return result.ok
    ? { error: null, message: (await words())('signedOut') }
    : { error: result.message, message: null };
}

/** A member's access: everything, or limited to chosen courses or groups (members only). */
export async function setMemberAccessAction(memberId: string, input: string): Promise<TeamActionState> {
  const user = await requireOrgAdmin();
  const t = await words();
  const access = parseAccessInput(input);
  if (!access) {
    return { error: t('chooseAccess'), message: null };
  }
  const result = await setMemberAccess(user.id, user.organization.id, memberId, access);
  revalidatePath('/admin/team');
  return result.ok ? { error: null, message: t('accessSaved') } : { error: result.message, message: null };
}
