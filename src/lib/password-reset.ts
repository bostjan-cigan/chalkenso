import 'server-only';

import { getTranslations } from 'next-intl/server';
import { auth, makeResetLinkFor } from './auth';
import { MIN_PASSWORD_LENGTH } from './organizations';
import { prisma } from './prisma';

/**
 * Resetting a password, by Better Auth: "Forgot your password?" asks its endpoint for a link (once,
 * an hour; the email itself is in src/lib/auth.ts); the platform admin can make one to send by hand. Setting
 * the new password ends every session of the account. Asking says the same whether the email has
 * an account or not.
 */

/** A reset link the platform admin sends by hand (for someone who can't get the email); null without an email. */
export async function makeResetLink(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ? makeResetLinkFor(user.email) : null;
}

/** The account a reset link is for, while it still works (Better Auth's token, read without using it). */
async function resetTokenAccount(token: string) {
  if (!token) {
    return null;
  }
  const row = await (await auth.$context).internalAdapter.findVerificationValue(`reset-password:${token}`);
  if (!row || row.expiresAt <= new Date()) {
    return null;
  }
  return prisma.user.findUnique({ where: { id: row.value }, select: { id: true, isActive: true, email: true, identifier: true } });
}

export type ResetCheck = { ok: true; email: string } | { ok: false };

/** Whether a reset link still works (for the page that sets the password, which says whose it is). */
export async function checkResetToken(token: string): Promise<ResetCheck> {
  const user = await resetTokenAccount(token);
  return user?.isActive ? { ok: true, email: user.email ?? user.identifier } : { ok: false };
}

/**
 * Sets the new password from a reset link, through Better Auth: once, and every session ends with it.
 * What went wrong is said in the language of the page that sent it.
 */
export async function resetPassword(
  token: string,
  password: string
): Promise<{ ok: true; user: { id: string; knownBrowsersVersion: number } } | { ok: false; message: string }> {
  const t = await getTranslations('auth.resetPassword.errors');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: t('tooShort', { min: MIN_PASSWORD_LENGTH }) };
  }
  const account = await resetTokenAccount(token);
  const gone = { ok: false as const, message: t('gone') };
  if (!account?.isActive) {
    return gone;
  }
  try {
    await auth.api.resetPassword({ body: { token, newPassword: password } });
  } catch {
    return gone;
  }
  // After Better Auth's own `onPasswordReset`, which moved the remembered browsers on.
  const user = await prisma.user.findUnique({ where: { id: account.id }, select: { id: true, knownBrowsersVersion: true } });
  return user ? { ok: true, user } : gone;
}
