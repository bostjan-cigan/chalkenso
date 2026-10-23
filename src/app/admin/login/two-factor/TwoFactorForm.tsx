'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import AdminField from '../../components/ui/AdminField';
import AdminNotice from '../../components/ui/AdminNotice';
import AdminButton from '../../components/ui/AdminButton';
import styles from '../../admin.module.css';

/** The code after the password, checked by Better Auth (its own lockout after five wrong codes). */
export default function TwoFactorForm({ next }: { next: string | null }) {
  const t = useTranslations('auth');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      setError(t('twoFactor.form.missing'));
      return;
    }
    setPending(true);
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.error) {
      setPending(false);
      if (result.error.status === 401 && /two.?factor|session|cookie/i.test(result.error.message ?? '')) {
        window.location.assign('/admin/login?error=totp-expired');
        return;
      }
      setError(t(result.error.status === 429 || /lock/i.test(result.error.code ?? '') ? 'signInErrors.totpLocked' : 'signInErrors.totpInvalid'));
      return;
    }
    window.location.assign(next ?? '/admin');
  }

  return (
    <form className={styles.loginForm} onSubmit={verify} noValidate>
      <AdminField
        id="admin-totp-code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        label={t('twoFactor.form.code')}
        placeholder="000000"
      />

      {error ? <AdminNotice>{error}</AdminNotice> : null}

      <AdminButton type="submit" fullWidth disabled={pending}>
        {pending ? t('twoFactor.form.submitting') : t('twoFactor.form.submit')}
      </AdminButton>
    </form>
  );
}
