'use client';

import { useTranslations } from 'next-intl';
import { createOrganizationAction, type FormState } from '../actions';
import { useFormAction } from '@/app/admin/components/useFormAction';
import AdminField from '../components/ui/AdminField';
import AdminNotice from '../components/ui/AdminNotice';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import styles from '../admin.module.css';

export default function OrganizationForm() {
  const t = useTranslations('auth');
  const { state, pending, onSubmit } = useFormAction<FormState>(createOrganizationAction, { error: null });
  return (
    <form className={styles.loginForm} onSubmit={onSubmit}>
      <AdminField
        id="onboarding-organization"
        name="organization"
        label={t('fields.organization')}
        placeholder={t('fields.organizationPlaceholder')}
        required
      />
      {state.error ? <AdminNotice>{state.error}</AdminNotice> : null}
      <AdminButton type="submit" fullWidth disabled={pending}>
        {pending ? t('organizationForm.submitting') : t('organizationForm.submit')}
      </AdminButton>
    </form>
  );
}
