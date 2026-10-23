'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import AdminField from '@/app/admin/components/ui/AdminField';
import AdminSelectField from '@/app/admin/components/ui/AdminSelectField';
import AdminSubmitButton from '@/app/admin/components/ui/AdminSubmitButton';
import styles from '@/app/admin/admin.module.css';

type VersionOption = {
  id: string;
  label: string;
};

interface CreateVersionFormProps {
  action: (formData: FormData) => void;
  courseId: string;
  /** Existing versions offered as "duplicate lessons from" sources. */
  versions: VersionOption[];
  pendingText?: string;
  submitLabel?: string;
}

export default function CreateVersionForm({
  action,
  courseId,
  versions,
  pendingText,
  submitLabel,
}: CreateVersionFormProps) {
  const t = useTranslations('courses.versions.create');
  const [label, setLabel] = useState('');
  const [duplicateFromVersionId, setDuplicateFromVersionId] = useState('');

  return (
    <form className={styles.formStack} action={action}>
      <input type="hidden" name="courseId" value={courseId} />

      <div className={styles.formGrid}>
        <AdminField
          id="version-label"
          name="label"
          label={t('label')}
          hint={t('labelHint')}
          placeholder="v2"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />

        <AdminSelectField
          id="version-duplicate-from"
          name="duplicateFromVersionId"
          label={t('duplicate')}
          hint={t('duplicateHint')}
          value={duplicateFromVersionId}
          onChange={(event) => setDuplicateFromVersionId(event.target.value)}
        >
          <option value="">{t('startEmpty')}</option>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {t('copyFrom', { label: version.label })}
            </option>
          ))}
        </AdminSelectField>
      </div>

      <AdminSubmitButton pendingText={pendingText ?? t('pending')}>{submitLabel ?? t('submit')}</AdminSubmitButton>
    </form>
  );
}
