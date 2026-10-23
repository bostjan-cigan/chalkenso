'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import AdminButton from '../../components/ui/AdminButton';
import AdminMenu from '../../components/ui/AdminMenu';
import { deleteVersionAction } from '../versions/actions';
import ConfirmDialog from './ConfirmDialog';

interface VersionDeleteButtonProps {
  courseId: string;
  versionId: string;
  versionLabel: string;
  /** In the row's "⋯" menu instead of a red button. */
  inMenu?: boolean;
}

/**
 * Danger button + confirm dialog for deleting a draft version and its lessons.
 * The action redirects on completion, so a plain transition is enough.
 */
export default function VersionDeleteButton({
  courseId,
  versionId,
  versionLabel,
  inMenu = false,
}: VersionDeleteButtonProps) {
  const t = useTranslations('courses.versions');
  const [open, setOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    startDelete(() => {
      void deleteVersionAction(formData);
    });
  }

  return (
    <>
      {inMenu ? (
        <AdminMenu
          label={t('moreFor', { label: versionLabel })}
          items={[{ label: t('deleteMenu'), danger: true, onSelect: () => setOpen(true), disabled: isDeleting }]}
        />
      ) : (
        <AdminButton type="button" tone="dangerText" size="compact" disabled={isDeleting} onClick={() => setOpen(true)}>
          {t('deleteShort')}
        </AdminButton>
      )}

      <ConfirmDialog
        open={open}
        tone="danger"
        title={t('deleteTitle')}
        description={t('deleteNamedDescription', { label: versionLabel })}
        confirmLabel={t('delete')}
        pending={isDeleting}
        onConfirm={handleDelete}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
