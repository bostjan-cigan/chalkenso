'use client';

import { useTranslations } from 'next-intl';
import { resetPasswordAction, type PasswordFormState } from '../password-actions';
import { useFormAction } from '../components/useFormAction';
import AdminButton from '../components/ui/AdminButton';
import AdminField from '../components/ui/AdminField';
import AdminNotice from '../components/ui/AdminNotice';
import styles from '../admin.module.css';

export default function ResetPasswordForm({ token, minPasswordLength }: { token: string; minPasswordLength: number }) {
  const t = useTranslations('auth');
  const { state, pending, onSubmit } = useFormAction<PasswordFormState>(resetPasswordAction, { error: null });
  return (
    <form className={styles.loginForm} onSubmit={onSubmit}>
      <input type="hidden" name="token" value={token} />
      <AdminField
        id="reset-password"
        name="password"
        type="password"
        label={t('resetPassword.form.password')}
        autoComplete="new-password"
        minLength={minPasswordLength}
        hint={t('fields.passwordHint', { min: minPasswordLength })}
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
