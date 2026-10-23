'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { resetPassword } from '@/lib/password-reset';
import { cookies } from 'next/headers';
import { rememberBrowser } from '@/lib/sign-in-lockout';

export type PasswordFormState = { error: string | null; sent?: boolean };

/** Sets the new password from a reset link, then on to signing in with it. Answers in the page's language. */
export async function resetPasswordAction(_state: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('confirm') ?? '')) {
    return { error: (await getTranslations('auth.resetPassword.errors'))('mismatch') };
  }
  const result = await resetPassword(String(formData.get('token') ?? ''), password);
  if (!result.ok) {
    return { error: result.message };
  }
  // Getting the link here proves the email is theirs: this browser counts as theirs, so guessing
  // elsewhere can't lock them out while they sign in with the new password.
  const cookieStore = await cookies();
  rememberBrowser({ get: (name) => cookieStore.get(name)?.value, set: (name, value, options) => cookieStore.set(name, value, options) }, result.user);
  redirect('/admin/login?reset=1');
}
