'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { resetPasswordAction, type PasswordFormState } from '../password-actions';
import { useFormAction } from '../components/useFormAction';
import AdminButton from '../components/ui/AdminButton';
import AdminField from '../components/ui/AdminField';
import AdminNotice from '../components/ui/AdminNotice';
import styles from '../admin.module.css';

/**
 * The new password for the account the link is for: its email first, read only (password managers
 * save the new password under it). Too short is said once they leave the field, or try to send it.
 */
export default function ResetPasswordForm({
  token,
  email,
  minPasswordLength,
}: {
  token: string;
  email: string;
  minPasswordLength: number;
}) {
  const t = useTranslations('auth');
  const { state, pending, onSubmit } = useFormAction<PasswordFormState>(resetPasswordAction, { error: null });
  const [password, setPassword] = useState('');
  const [left, setLeft] = useState(false);
  const short = left && password.length > 0 && password.length < minPasswordLength;
  return (
    <form className={styles.loginForm} onSubmit={onSubmit}>
      <input type="hidden" name="token" value={token} />
      <AdminField id="reset-email" type="email" label={t('fields.email')} autoComplete="username" value={email} readOnly />
      <AdminField
        id="reset-password"
        name="password"
        type="password"
        label={t('resetPassword.form.password')}
        autoComplete="new-password"
        minLength={minPasswordLength}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onBlur={() => setLeft(true)}
        onInvalid={() => setLeft(true)}
        error={short ? t('signup.password.short', { min: minPasswordLength }) : null}
        required
      />
      <AdminField id="reset-confirm" name="confirm" type="password" label={t('resetPassword.form.confirm')} autoComplete="new-password" required />
      {state.error ? <AdminNotice>{state.error}</AdminNotice> : null}
      <AdminButton type="submit" fullWidth disabled={pending}>
        {pending ? t('resetPassword.form.submitting') : t('resetPassword.form.submit')}
      </AdminButton>
    </form>
  );
}
