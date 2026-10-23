'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { signInError } from '@/lib/sign-in-messages';
import AdminCheckbox from './ui/AdminCheckbox';
import AdminField from './ui/AdminField';
import AdminNotice from './ui/AdminNotice';
import AdminButton from './ui/AdminButton';
import styles from '../admin.module.css';

interface AdminLoginMockProps {
  /** Already in the visitor's language (the page translates the address's `?error=`). */
  errorMessage?: string;
  /** Where to go after signing in (e.g. back to an invite); already checked to be this site's. */
  next?: string;
}

/**
 * Signing in, through Better Auth (its limits per address, and our lock, apply): an email, or the
 * username older accounts have. With two-factor on, the code is asked next.
 */
export default function AdminLoginMock({ errorMessage, next }: AdminLoginMockProps) {
  const t = useTranslations('auth');
  const [error, setError] = useState<string | null>(errorMessage ?? null);
  const [pending, setPending] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get('identifier') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const rememberMe = form.get('remember') === 'on';
    if (!identifier || !password) {
      setError(t('signInErrors.missing'));
      return;
    }
    setPending(true);
    const result = identifier.includes('@')
      ? await authClient.signIn.email({ email: identifier, password, rememberMe })
      : await authClient.signIn.username({ username: identifier, password, rememberMe });
    if (result.error) {
      setPending(false);
      setError(t(`signInErrors.${signInError(result.error)}`));
      return;
    }
    if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      window.location.assign(`/admin/login/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`);
      return;
    }
    // A full load: every page and the sidebar start from the new session.
    window.location.assign(next ?? '/admin');
  }

  return (
    <form className={styles.loginForm} onSubmit={signIn} noValidate>
      <AdminField
        id="admin-identifier"
        name="identifier"
        type="text"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="username"
        label={t('fields.email')}
        placeholder={t('login.form.identifierPlaceholder')}
        required
      />

      <AdminField
        id="admin-password"
        name="password"
        type="password"
        autoComplete="current-password"
        label={t('fields.password')}
        placeholder={t('login.form.passwordPlaceholder')}
        required
      />

      {/* Off: the session ends when the browser closes, or after two hours without activity. */}
      <AdminCheckbox id="admin-remember" name="remember" label={t('login.form.remember')} hint={t('login.form.rememberHint')} />

      {error ? (
        <div data-testid="sign-in-error">
          <AdminNotice>{error}</AdminNotice>
        </div>
      ) : null}

      <AdminButton type="submit" fullWidth disabled={pending}>
        {pending ? t('login.form.submitting') : t('login.form.submit')}
      </AdminButton>
    </form>
  );
}
