'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import { createGroupAccessLinkInlineAction } from '../actions';
import AccessExpiryPicker from './AccessExpiryPicker';
import AccessLinkModalPortal from './AccessLinkModalPortal';
import type { MemberLinkState } from './MemberLinkModal';
import styles from './MemberLinkModal.module.css';

type CreatedLink = NonNullable<MemberLinkState>;

interface GroupAccessLinkModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  defaultExpiryValue: string;
  onSaved: (link: CreatedLink) => void;
}

export default function GroupAccessLinkModal({
  open,
  onClose,
  groupId,
  defaultExpiryValue,
  onSaved,
}: GroupAccessLinkModalProps) {
  const t = useTranslations('groups');
  const titleId = useId();
  const descriptionId = useId();
  const [expiry, setExpiry] = useState(defaultExpiryValue);
  const { notice, isPending, run, setNotice } = useActionNotice({ refresh: false });

  useEffect(() => {
    if (!open) {
      return;
    }
    setExpiry(defaultExpiryValue);
    setNotice(null);
  }, [open, defaultExpiryValue, setNotice]);

  function submitCreate() {
    const formData = new FormData();
    formData.set('groupId', groupId);
    formData.set('expiresAt', expiry);

    run(() => createGroupAccessLinkInlineAction(formData), {
      fallbackError: t('links.createFailed'),
      onSuccess: (result) => {
        if ('link' in result) {
          onSaved(result.link);
          onClose();
        }
      },
    });
  }

  return (
    <AccessLinkModalPortal
      open={open}
      onClose={onClose}
      titleId={titleId}
      descriptionId={descriptionId}
    >
      <header className={styles.modalHeader}>
        <h2 id={titleId} className={styles.modalTitle}>
          {t('groupLink.modalTitle')}
        </h2>
        <p id={descriptionId} className={styles.modalDescription}>
          {t('groupLink.modalText')}
        </p>
      </header>

      <div className={styles.modalBody}>
        <ActionNotice notice={notice} />
        <AccessExpiryPicker idPrefix="group-access" value={expiry} onChange={setExpiry} />
      </div>

      <footer className={styles.modalFooter}>
        <div className={styles.actions}>
          <AdminButton type="button" tone="secondary" onClick={onClose}>
            {t('links.cancel')}
          </AdminButton>
          <AdminButton type="button" onClick={submitCreate} disabled={isPending}>
            {isPending ? t('links.creating') : t('links.create')}
          </AdminButton>
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
