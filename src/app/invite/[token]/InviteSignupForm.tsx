'use client';

import { useTranslations } from 'next-intl';
import { signUpWithInviteAction, type FormState } from '@/app/admin/actions';
import { useFormAction } from '@/app/admin/components/useFormAction';
import AdminField from '@/app/admin/components/ui/AdminField';
import AdminNotice from '@/app/admin/components/ui/AdminNotice';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import HandleField from '@/app/admin/components/HandleField';
import { useState } from 'react';
import styles from '@/app/admin/admin.module.css';

/** A new account from an invite. A password that's too short is said once they leave it, or try to send it. */
export default function InviteSignupForm({ token, minPasswordLength }: { token: string; minPasswordLength: number }) {
  const t = useTranslations('auth');
  const { state, pending, onSubmit } = useFormAction<FormState>(signUpWithInviteAction, { error: null });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [left, setLeft] = useState(false);
  const short = left && password.length > 0 && password.length < minPasswordLength;
  return (
    <form className={styles.loginForm} onSubmit={onSubmit}>
      <input type="hidden" name="token" value={token} />
      <AdminField
        id="invite-name"
        name="name"
        label={t('fields.name')}
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <HandleField id="invite-handle" name="handle" label={t('fields.handle')} from={name} />
      <AdminField id="invite-email" name="email" type="email" label={t('fields.email')} autoComplete="email" required />
      <AdminField
        id="invite-password"
        name="password"
        type="password"
        label={t('fields.password')}
        autoComplete="new-password"
        minLength={minPasswordLength}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onBlur={() => setLeft(true)}
        onInvalid={() => setLeft(true)}
        error={short ? t('signup.password.short', { min: minPasswordLength }) : null}
        required
      />
      {state.error ? <AdminNotice>{state.error}</AdminNotice> : null}
      <AdminButton type="submit" fullWidth disabled={pending}>
        {pending ? t('invite.form.submitting') : t('invite.form.submit')}
      </AdminButton>
    </form>
  );
}
