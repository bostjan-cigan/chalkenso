'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import AdminField from '@/app/admin/components/ui/AdminField';
import AdminSubmitButton from '@/app/admin/components/ui/AdminSubmitButton';
import AdminTextareaField from '@/app/admin/components/ui/AdminTextareaField';
import styles from '@/app/admin/admin.module.css';

interface PartnerFormProps {
  action: (formData: FormData) => void;
  initialDescription?: string;
  initialLogoUrl?: string;
  initialName?: string;
  initialWebsiteUrl?: string;
  partnerId?: string;
  pendingText?: string;
  submitLabel?: string;
}

/** A partner: its name, website, logo and a short description. */
export default function PartnerForm({
  action,
  initialDescription = '',
  initialLogoUrl = '',
  initialName = '',
  initialWebsiteUrl = '',
  partnerId,
  pendingText,
  submitLabel,
}: PartnerFormProps) {
  const t = useTranslations('courses.partners');
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);

  return (
    <form className={styles.formStack} action={action}>
      {partnerId ? <input type="hidden" name="partnerId" value={partnerId} /> : null}

      <AdminField
        id="partner-name"
        name="name"
        label={t('form.name')}
        placeholder="SmartNinja"
        defaultValue={initialName}
        required
      />

      <div className={styles.formGrid}>
        <AdminField
          id="partner-website-url"
          name="websiteUrl"
          label={t('form.website')}
          hint={t('form.websiteHint')}
          placeholder="https://"
          type="url"
          defaultValue={initialWebsiteUrl}
        />

        <AdminField
          id="partner-logo-url"
          name="logoUrl"
          label={t('form.logo')}
          hint={t('form.logoHint')}
          placeholder="https://"
          type="url"
          value={logoUrl}
          onChange={(event) => setLogoUrl(event.target.value)}
        />
      </div>

      {/^https?:\/\/\S+$/i.test(logoUrl) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" style={{ maxHeight: 48, maxWidth: 200, objectFit: 'contain', alignSelf: 'flex-start' }} />
      ) : null}

      <AdminTextareaField
        id="partner-description"
        name="description"
        label={t('form.description')}
        hint={t('form.descriptionHint')}
        placeholder={t('form.descriptionPlaceholder')}
        defaultValue={initialDescription}
      />

      <div className={styles.inlineActions}>
        <AdminSubmitButton pendingText={pendingText ?? t('saving')}>{submitLabel ?? t('save')}</AdminSubmitButton>
      </div>
    </form>
  );
}
