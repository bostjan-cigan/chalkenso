'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import AdminField from '@/app/admin/components/ui/AdminField';
import AdminSelectField from '@/app/admin/components/ui/AdminSelectField';
import AdminSubmitButton from '@/app/admin/components/ui/AdminSubmitButton';
import { useSheetForm } from '@/app/admin/components/ui/Sheet';
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

/** Tells the form whether it is being sent: only a component inside a form can know. */
function Sending({ onChange }: { onChange: (pending: boolean) => void }) {
  const { pending } = useFormStatus();
  useEffect(() => onChange(pending), [pending, onChange]);
  return null;
}

/** In the New version sheet, Create is the sheet's: the new version opens once it's made. */
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
  const [sending, setSending] = useState(false);
  const sheet = useSheetForm({ label: sending ? (pendingText ?? t('pending')) : (submitLabel ?? t('submit')), pending: sending });

  return (
    <form id={sheet.formId} className={styles.formStack} action={action}>
      <input type="hidden" name="courseId" value={courseId} />
      <Sending onChange={setSending} />

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

      {sheet.inSheet ? null : <AdminSubmitButton pendingText={pendingText ?? t('pending')}>{submitLabel ?? t('submit')}</AdminSubmitButton>}
    </form>
  );
}
