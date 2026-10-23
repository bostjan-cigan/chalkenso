'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import AdminButton from '../components/ui/AdminButton';
import AdminField from '../components/ui/AdminField';
import AdminNotice from '../components/ui/AdminNotice';
import styles from '../admin.module.css';

/**
 * "Forgot your password?", through Better Auth's endpoint: its limits per address and the edition's
 * bot check, where it has one (its captcha plugin), apply. The same answer whether the email has an
 * account.
 */
export default function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword.form');
  // What Better Auth's captcha plugin's refusal says (the bot check took the request for a bot's): as on signing in.
  const tErrors = useTranslations('auth.signInErrors');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim().toLowerCase();
    if (!email) {
      setError(t('missing'));
      return;
    }
    setPending(true);
    const result = await authClient.requestPasswordReset({ email, redirectTo: '/admin/reset-password' });
    setPending(false);
    if (result.error) {
      setError(
        result.error.code === 'VERIFICATION_FAILED'
          ? tErrors('bot')
          : result.error.status === 429
            ? t('tooMany')
            : t('failed')
      );
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p className={styles.fieldHint} style={{ margin: 0 }} data-testid="reset-sent">
        {t('sent')}
      </p>
    );
  }
  return (
    <form className={styles.loginForm} onSubmit={send} noValidate>
      <AdminField id="forgot-email" name="email" type="email" label={t('email')} autoComplete="email" required />
      {error ? <AdminNotice>{error}</AdminNotice> : null}
      <AdminButton type="submit" fullWidth disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </AdminButton>
    </form>
  );
}
