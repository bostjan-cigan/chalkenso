'use server';

import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  getCurrentUserSession,
  moveSessionToRemainingOrganization,
  platformAdminHome,
  revokeCurrentAdminSession,
  signInWithPassword,
  switchSessionOrganization,
} from '@/lib/admin-auth';
import { setOrgNotice } from '@/lib/org-notice';
import {
  acceptInvite,
  createOrganizationForUser,
  leaveOrganization,
  signUp,
  signUpWithInvite,
} from '@/lib/organizations';
import { EDITION } from '@/lib/site';
import { prisma } from '@/lib/prisma';
import { HOUR, type Limit, visitorKey, withinLimit } from '@/lib/rate-limit';
import { serverExtensions } from '@/extensions/server';
import type { Locale } from '@/i18n/config';

function withQuery(path: string, params: Record<string, string | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

// ---------------------------------------------------------------------------------------------
// Sign-up, organisations and invites
// ---------------------------------------------------------------------------------------------

/** A form's answer: what's wrong, and on a form in steps (sign-up), the step it's about. */
export type FormState = { error: string | null; step?: number };

/**
 * Signing up, signing up from an invite and starting an organisation answer in the language of the
 * page they're sent from (it follows the visitor's pick), as do the app's other actions (`app`).
 */
async function pageWords() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('auth')]);
  return { locale: locale as Locale, t };
}

/** Sign-up attempts per visitor: enough for a school sharing one address. */
const SIGNUP_LIMIT: Limit = { name: 'signup', max: 10, windowMs: HOUR };

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { locale, t } = await pageWords();
  // A bot: the hidden field filled in, or the bot check says so (said as on signing in).
  if (formData.get('website') || (await serverExtensions.isBot())) {
    return { error: t('signInErrors.bot') };
  }
  if (!(await withinLimit(SIGNUP_LIMIT, await visitorKey()))) {
    return { error: t('accountErrors.tooManySignups') };
  }
  const result = await signUp(
    {
      // Sign-up asks for no name: they add it in Profile when they like.
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      handle: String(formData.get('handle') ?? ''),
      organizationName: String(formData.get('organization') ?? ''),
      organizationHandle: String(formData.get('organizationHandle') ?? ''),
      plan: String(formData.get('plan') ?? ''),
    },
    locale
  );
  if (!result.ok) {
    return { error: result.message, step: result.field === 'account' ? 1 : result.field ? 2 : undefined };
  }
  // Signed in by Better Auth with the password just chosen (its session starts in the new organisation).
  await revokeCurrentAdminSession();
  await signInWithPassword(String(formData.get('email') ?? '').trim().toLowerCase(), String(formData.get('password') ?? ''));
  // On to where the edition sends them next.
  redirect(serverExtensions.afterSignup(String(formData.get('plan') ?? '')));
}

export async function createOrganizationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const session = await getCurrentUserSession();
  if (!session) {
    redirect('/admin/login');
  }
  const { locale, t } = await pageWords();
  if (session.user.impersonator) {
    return { error: t('accountErrors.impersonating') };
  }
  if (platformAdminHome(session.user)) {
    return { error: t('accountErrors.platformAdmin') };
  }
  const result = await createOrganizationForUser(session.user.id, String(formData.get('organization') ?? ''), locale);
  if (!result.ok) {
    return { error: result.message };
  }
  await switchSessionOrganization(result.value.organizationId);
  redirect('/admin?welcome=1');
}

/**
 * Leaves the organisation the session works in (where the edition allows it), then carries on in the
 * oldest one left, or onboarding. `organizationId` must be that organisation, so a page left open in
 * another tab can't leave a different one.
 */
export async function leaveOrganizationAction(organizationId: string): Promise<{ error: string }> {
  const session = await getCurrentUserSession();
  if (!session) {
    redirect('/admin/login');
  }
  const t = await getTranslations('app.organizations.errors');
  if (EDITION !== 'cloud') {
    return { error: t('oneOrganization') };
  }
  if (session.user.impersonator) {
    return { error: t('impersonating') };
  }
  if (!session.user.organization || session.user.organization.id !== organizationId) {
    return { error: t('switchFirst') };
  }
  const result = await leaveOrganization(session.user.id, organizationId);
  if (!result.ok) {
    return { error: result.message };
  }
  await setOrgNotice({ kind: 'left', name: result.value.name });
  const next = await moveSessionToRemainingOrganization();
  redirect(next ? '/admin?org=notice' : '/admin/onboarding?org=notice');
}

export async function switchOrganizationAction(formData: FormData) {
  await switchSessionOrganization(String(formData.get('organizationId') ?? ''));
  redirect('/admin');
}

export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const session = await getCurrentUserSession();
  if (!session) {
    redirect(withQuery('/admin/login', { next: `/invite/${token}` }));
  }
  const result = await acceptInvite(token, session.user.id);
  if (!result.ok) {
    redirect(withQuery(`/invite/${token}`, { error: 'code' in result ? 'full' : 'gone' }));
  }
  await switchSessionOrganization(result.value.organizationId);
  redirect('/admin?joined=1');
}

export async function signUpWithInviteAction(_state: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '');
  const { locale } = await pageWords();
  const result = await signUpWithInvite(
    token,
    {
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      handle: String(formData.get('handle') ?? ''),
    },
    locale
  );
  if (!result.ok) {
    return { error: result.message };
  }
  await revokeCurrentAdminSession();
  await signInWithPassword(String(formData.get('email') ?? '').trim().toLowerCase(), String(formData.get('password') ?? ''));
  redirect('/admin?joined=1');
}

