'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';
import { settingsStyles } from '@/app/admin/settings/ui/SettingsList';
import { deletePartnerAction } from '../actions';

/**
 * Settings' red text button (a partner is in Settings) + confirm dialog; the action redirects to the
 * partner list when done.
 */
export default function PartnerDeleteButton({ partnerId, partnerName }: { partnerId: string; partnerName: string }) {
  const t = useTranslations('courses.partners.delete');
  const [open, setOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set('partnerId', partnerId);
    startDelete(() => {
      void deletePartnerAction(formData);
    });
  }

  return (
    <>
      <button
        type="button"
        className={settingsStyles.actionDanger}
        style={{ marginLeft: '-0.4rem' }}
        disabled={isDeleting}
        onClick={() => setOpen(true)}
        data-testid="partner-delete"
      >
        {t('button')}
      </button>

      <ConfirmDialog
        open={open}
        tone="danger"
        title={t('title')}
        description={t('description', { name: partnerName })}
        confirmLabel={t('button')}
        pending={isDeleting}
        onConfirm={handleDelete}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
