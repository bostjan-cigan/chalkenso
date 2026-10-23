'use client';

import type { FormEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '../../components/ui/AdminButton';
import AdminField from '../../components/ui/AdminField';
import ActionNotice from '../../components/ui/ActionNotice';
import { useActionNotice } from '../../components/ui/useActionNotice';
import { updateProfileDetailsAction } from '../actions';
import styles from '../../admin.module.css';

/**
 * One of the person's details, in its sheet on their Profile: its fields, what saving said, and
 * Save. Only the fields inside change (`updateProfileDetailsAction`).
 */
export function ProfileDetailsForm({ children, testId }: { children: ReactNode; testId?: string }) {
  const t = useTranslations('account.profile.details');
  const { notice, isPending, run } = useActionNotice();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => updateProfileDetailsAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} className={styles.formStack} data-testid={testId}>
      <ActionNotice notice={notice} />
      {children}
      <div className={styles.inlineActions}>
        <AdminButton type="submit" disabled={isPending}>
          {isPending ? t('saving') : t('save')}
        </AdminButton>
      </div>
    </form>
  );
}

/** First and last name, side by side. */
export function ProfileNameFields({ initialFirstName, initialLastName }: { initialFirstName: string; initialLastName: string }) {
  const t = useTranslations('account.profile.details');
  return (
    <div className={styles.formGrid}>
      <AdminField
        id="profile-first-name"
        name="firstName"
        label={t('firstName')}
        placeholder={t('firstNamePlaceholder')}
        defaultValue={initialFirstName}
      />
      <AdminField
        id="profile-last-name"
        name="lastName"
        label={t('lastName')}
        placeholder={t('lastNamePlaceholder')}
        defaultValue={initialLastName}
      />
    </div>
  );
}
