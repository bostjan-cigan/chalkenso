'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent } from 'react';
import AdminButton from '../../components/ui/AdminButton';
import ActionNotice from '../../components/ui/ActionNotice';
import { useActionNotice } from '../../components/ui/useActionNotice';
import { renameVersionAction } from '../versions/actions';
import styles from '../../admin.module.css';

interface VersionRenameFormProps {
  courseId: string;
  versionId: string;
  label: string;
}

/** Rename control for the Version settings section. */
export default function VersionRenameForm({
  courseId,
  versionId,
  label,
}: VersionRenameFormProps) {
  const t = useTranslations('courses.versions');
  const { notice, isPending, run } = useActionNotice();

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => renameVersionAction(formData));
  }

  return (
    <div className={styles.profileImageStack}>
      <ActionNotice notice={notice} />
      <form onSubmit={handleRename} className={styles.versionRenameForm}>
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="versionId" value={versionId} />
        <input
          className={`${styles.textInput} ${styles.versionRenameInput}`}
          name="label"
          defaultValue={label}
          aria-label={t('renameLabel')}
        />
        <AdminButton type="submit" size="compact" disabled={isPending}>
          {isPending ? t('saving') : t('rename')}
        </AdminButton>
      </form>
    </div>
  );
}
