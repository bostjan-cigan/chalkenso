'use server';

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { APIError } from 'better-auth/api';
import {
  getCurrentUserSession,
  mustSetUpTwoFactor,
  requireUser,
  refuseWhileImpersonating,
  revokeCurrentAdminSession, authHeaders } from '@/lib/admin-auth';
import { auth } from '@/lib/auth';
import { HANDLE_MAX, HANDLE_MIN } from '@/lib/handle-format';
import { handleUnavailableKey, normalizeHandle, suggestHandle } from '@/lib/handles';
import { prisma } from '@/lib/prisma';
import {
  buildProfileImageKey,
  deleteObjectFromR2,
  uploadImageToR2,
} from '@/lib/r2';
import { buildTotpQrDataUrl } from '@/lib/totp-app';
import { endOwnSession, forgetRememberedBrowsers } from '@/lib/sessions';
import { PRODUCT_NAME } from '@/lib/site';

/** 5 MB cap for profile images. */
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the Profile's forms say back (`account.profile.actions`), in the page's language. */
const words = () => getTranslations('account.profile.actions');

export type ProfileDetailsActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Saves part of the person's details, from a sheet on their Profile: only the fields its form has
 * change (the Name sheet keeps the email, the Email sheet keeps the name, and so on).
 */
export async function updateProfileDetailsAction(
  formData: FormData
): Promise<ProfileDetailsActionResult> {
  const refusal = await refuseWhileImpersonating();
  if (refusal) return { ok: false, message: refusal };
  const session = await requireUser({ allowWithoutTwoFactor: true });
  const t = await words();
  const current = await prisma.user.findUnique({ where: { id: session.id }, select: { firstName: true, lastName: true } });
  const firstName = formData.has('firstName') ? String(formData.get('firstName') ?? '').trim() : (current?.firstName ?? '');
  const lastName = formData.has('lastName') ? String(formData.get('lastName') ?? '').trim() : (current?.lastName ?? '');
  const email = String(formData.get('email') ?? '').trim();

  if (formData.has('email') && email && !EMAIL_PATTERN.test(email)) {
    return { ok: false, message: t('emailInvalid') };
  }
  // Their handle (one namespace with organisations'); accounts from before handles may have none yet.
  let handle = formData.has('handle') ? normalizeHandle(String(formData.get('handle') ?? '')) : '';
  if (handle) {
    const problem = await handleUnavailableKey(handle, { userId: session.id });
    const suggested = normalizeHandle(`${firstName} ${lastName}`);
    if (problem && handle === suggested) {
      // The suggestion from their name, taken by someone else: the next free one.
      handle = await suggestHandle(`${firstName} ${lastName}`, 'me', { userId: session.id });
    } else if (problem) {
      const handleWords = await getTranslations('common.handle.problems');
      return { ok: false, message: t('handle', { problem: handleWords(problem, { min: HANDLE_MIN, max: HANDLE_MAX }) }) };
    }
  }

  try {
    await prisma.user.update({
      where: {
        id: session.id,
      },
      data: {
        ...(formData.has('email') ? { email: email || null } : {}),
        ...(formData.has('firstName') ? { firstName: firstName || null } : {}),
        ...(formData.has('lastName') ? { lastName: lastName || null } : {}),
        ...(handle ? { handle } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: t('taken') };
    }
    throw error;
  }

  revalidatePath('/admin/profile');
  revalidatePath('/admin');

  return { ok: true, message: t('detailsSaved') };
}

type Words = Awaited<ReturnType<typeof words>>;

/** Better Auth's error, in words for the form (a wrong password, a wrong code). */
function authProblem(error: unknown, fallback: string, t: Words) {
  if (error instanceof APIError) {
    const code = String((error.body as { code?: string } | undefined)?.code ?? '');
    if (code.includes('PASSWORD')) return t('checkPassword');
    if (code.includes('CODE') || code.includes('OTP') || code.includes('TOTP')) return t('codeInvalid');
    if (error.statusCode === 429) return t('tooManyCodes');
  }
  return fallback;
}

/**
 * Setting up two-factor, by Better Auth: the password first, then the authenticator's QR code and
 * the backup codes (shown once). It's on once a code from the app checks out (`confirmTotpSetupAction`).
 */
export async function beginTotpSetupAction(password: string): Promise<
  | { manualSecret: string; ok: true; qrDataUrl: string; backupCodes: string[] }
  | { message: string; ok: false }
> {
  const refusal = await refuseWhileImpersonating();
  if (refusal) return { ok: false, message: refusal };
  const session = await requireUser({ allowWithoutTwoFactor: true });
  const t = await words();
  if (session.totpEnabled) {
    return { ok: false, message: t('totpAlreadyOn') };
  }
  try {
    const result = await auth.api.enableTwoFactor({ body: { password, issuer: PRODUCT_NAME }, headers: await authHeaders() });
    if (!('totpURI' in result)) {
      return { ok: false, message: t('totpNotStarted') };
    }
    const { totpURI, backupCodes } = result;
    return {
      ok: true,
      manualSecret: new URL(totpURI).searchParams.get('secret') ?? '',
      qrDataUrl: await buildTotpQrDataUrl(totpURI),
      backupCodes,
    };
  } catch (error) {
    return { ok: false, message: authProblem(error, t('totpNotStarted'), t) };
  }
}

/** Closing the setup before the code: nothing is on (Better Auth keeps the unconfirmed secret until the next try). */
export async function cancelTotpSetupAction(): Promise<{ ok: true }> {
  return { ok: true };
}

export type TotpActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** The first code from the authenticator: two-factor is on from now (Better Auth signs this browser in again with it). */
export async function confirmTotpSetupAction(formData: FormData): Promise<TotpActionResult> {
  const refusal = await refuseWhileImpersonating();
  if (refusal) return { ok: false, message: refusal };
  await requireUser({ allowWithoutTwoFactor: true });
  const t = await words();
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, message: t('codeInvalid') };
  }
  try {
    await auth.api.verifyTOTP({ body: { code }, headers: await authHeaders() });
  } catch (error) {
    return { ok: false, message: authProblem(error, t('codeInvalid'), t) };
  }
  revalidatePath('/admin/profile');
  revalidatePath('/admin');
  return { ok: true, message: t('totpOn') };
}

/** Turning two-factor off: the password, as Better Auth asks. */
export async function disableTotpAction(formData: FormData): Promise<TotpActionResult> {
  const refusal = await refuseWhileImpersonating();
  if (refusal) return { ok: false, message: refusal };
  const session = await requireUser({ allowWithoutTwoFactor: true });
  const t = await words();
  if (!session.totpEnabled) {
    return { ok: true, message: t('totpAlreadyOff') };
  }
  try {
    await auth.api.disableTwoFactor({ body: { password: String(formData.get('password') ?? '') }, headers: await authHeaders() });
  } catch (error) {
    return { ok: false, message: authProblem(error, t('checkPassword'), t) };
  }
  revalidatePath('/admin/profile');
  revalidatePath('/admin');
  return { ok: true, message: t('totpOff') };
}

export type ProfileImageActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function updateProfileImageAction(
  formData: FormData
): Promise<ProfileImageActionResult> {
  const session = await requireUser({ allowWithoutTwoFactor: true });
  const t = await words();
  const file = formData.get('profileImage');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: t('photoMissing') };
  }

  if (!file.type.startsWith('image/')) {
    return { ok: false, message: t('photoNotImage') };
  }

  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    return { ok: false, message: t('photoTooLarge', { max: MAX_PROFILE_IMAGE_BYTES / 1024 / 1024 }) };
  }

  const existing = await prisma.user.findUnique({
    where: {
      id: session.id,
    },
    select: {
      profileImageKey: true,
    },
  });

  const key = buildProfileImageKey(session.id, randomUUID(), file.name);

  try {
    await uploadImageToR2(file, key);
  } catch {
    return { ok: false, message: t('photoUploadFailed') };
  }

  await prisma.user.update({
    where: {
      id: session.id,
    },
    data: {
      profileImageKey: key,
    },
  });

  // Best-effort cleanup of the replaced object.
  if (existing?.profileImageKey && existing.profileImageKey !== key) {
    await deleteObjectFromR2(existing.profileImageKey).catch(() => undefined);
  }

  revalidatePath('/admin/profile');
  revalidatePath('/admin');

  return { ok: true, message: t('photoUpdated') };
}

export async function removeProfileImageAction(): Promise<ProfileImageActionResult> {
  const session = await requireUser({ allowWithoutTwoFactor: true });

  const existing = await prisma.user.findUnique({
    where: {
      id: session.id,
    },
    select: {
      profileImageKey: true,
    },
  });

  if (!existing?.profileImageKey) {
    return { ok: true, message: (await words())('photoNone') };
  }

  await prisma.user.update({
    where: {
      id: session.id,
    },
    data: {
      profileImageKey: null,
    },
  });

  await deleteObjectFromR2(existing.profileImageKey).catch(() => undefined);

  revalidatePath('/admin/profile');
  revalidatePath('/admin');

  return { ok: true, message: (await words())('photoRemoved') };
}

/** "Where you're signed in": signs one of your other sessions out (this one signs out from the menu). */
export async function endSessionAction(sessionId: string): Promise<ProfileDetailsActionResult> {
  const refusal = await refuseWhileImpersonating();
  if (refusal) return { ok: false, message: refusal };
  const session = await getCurrentUserSession();
  const t = await words();
  if (!session) {
    return { ok: false, message: t('sessionEnded') };
  }
  const ended = await endOwnSession(session.sessionId, String(sessionId));
  revalidatePath('/admin/profile');
  return ended ? { ok: true, message: t('signedOut') } : { ok: false, message: t('alreadyEnded') };
}

/**
 * "Sign out of all devices": every session of yours ends through Better Auth, this one too, and no
 * browser is remembered any more. Then the sign-in page, saying so; only a refusal comes back.
 */
export async function signOutEverywhereAction(): Promise<ProfileDetailsActionResult> {
  const refusal = await refuseWhileImpersonating();
  if (refusal) return { ok: false, message: refusal };
  const session = await getCurrentUserSession();
  if (!session) {
    return { ok: false, message: (await words())('sessionEnded') };
  }
  const requestHeaders = await authHeaders();
  await auth.api.revokeSessions({ headers: requestHeaders });
  await forgetRememberedBrowsers(session.user.id);
  // This browser's cookie goes too (its session already has).
  await revokeCurrentAdminSession();
  redirect('/admin/login?everywhere=1');
}
