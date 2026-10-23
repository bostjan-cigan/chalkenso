'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { inviteToken } from '@/lib/invite-link';
import AdminButton from '../components/ui/AdminButton';
import AdminField from '../components/ui/AdminField';
import AdminNotice from '../components/ui/AdminNotice';
import styles from '../admin.module.css';

/** Opens an invite link a colleague sent (pasted whole, or just its token). */
export default function JoinInviteForm() {
  const t = useTranslations('auth.onboarding.join');
  const router = useRouter();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={styles.loginForm}
      onSubmit={(event) => {
        event.preventDefault();
        const token = inviteToken(link);
        if (!token) {
          setError(t('invalid'));
          return;
        }
        router.push(`/invite/${token}`);
      }}
    >
      <AdminField
        id="onboarding-invite"
        label={t('label')}
        placeholder={t('placeholder')}
        autoComplete="off"
        value={link}
        onChange={(event) => {
          setLink(event.target.value);
          setError(null);
        }}
      />
      {error ? <AdminNotice>{error}</AdminNotice> : null}
      <AdminButton type="submit" tone="secondary" fullWidth>
        {t('submit')}
      </AdminButton>
    </form>
  );
}
