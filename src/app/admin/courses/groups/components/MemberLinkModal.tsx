'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import { createMemberAccessLinkInlineAction } from '../actions';
import AccessExpiryPicker from './AccessExpiryPicker';
import AccessLinkModalPortal from './AccessLinkModalPortal';
import styles from './MemberLinkModal.module.css';

export type MemberLinkState = {
  expiresAt: string;
  id: string;
  lastAccessedAt: string | null;
  token: string;
} | null;

type CreatedLink = NonNullable<MemberLinkState>;

interface MemberLinkModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  memberId: string;
  memberLabel: string;
  defaultExpiryValue: string;
  onSaved: (link: CreatedLink) => void;
}

/** Create flow only — when the member has no active link yet. */
export default function MemberLinkModal({
  open,
  onClose,
  groupId,
  memberId,
  memberLabel,
  defaultExpiryValue,
  onSaved,
}: MemberLinkModalProps) {
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
  }, [open, defaultExpiryValue, memberId, setNotice]);

  function submitCreate() {
    const formData = new FormData();
    formData.set('groupId', groupId);
    formData.set('memberId', memberId);
    formData.set('expiresAt', expiry);

    run(() => createMemberAccessLinkInlineAction(formData), {
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
          {t('members.linkModalTitle')}
        </h2>
        <p id={descriptionId} className={styles.modalDescription}>
          {memberLabel}
        </p>
      </header>

      <div className={styles.modalBody}>
        <ActionNotice notice={notice} />
        <AccessExpiryPicker
          idPrefix={`member-${memberId}`}
          value={expiry}
          onChange={setExpiry}
        />
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
