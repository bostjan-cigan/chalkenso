'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FiCheck } from 'react-icons/fi';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import { bulkCreateMemberAccessLinksInlineAction } from '../actions';
import AccessExpiryPicker from './AccessExpiryPicker';
import AccessLinkModalPortal from './AccessLinkModalPortal';
import styles from './MemberLinkModal.module.css';

interface BulkMemberLinksModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  memberCount: number;
  defaultExpiryValue: string;
  onDone: () => void;
}

export default function BulkMemberLinksModal({
  open,
  onClose,
  groupId,
  memberCount,
  defaultExpiryValue,
  onDone,
}: BulkMemberLinksModalProps) {
  const t = useTranslations('groups');
  const titleId = useId();
  const descriptionId = useId();
  const [expiry, setExpiry] = useState(defaultExpiryValue);
  const [success, setSuccess] = useState<number | null>(null);
  const { notice, isPending, run, setNotice } = useActionNotice({ refresh: false });

  useEffect(() => {
    if (!open) {
      return;
    }
    setExpiry(defaultExpiryValue);
    setNotice(null);
    setSuccess(null);
  }, [open, defaultExpiryValue, setNotice]);

  const dismiss = useCallback(() => {
    setSuccess(null);
    onClose();
  }, [onClose]);

  const submit = () => {
    const formData = new FormData();
    formData.set('groupId', groupId);
    formData.set('expiresAt', expiry);

    run(() => bulkCreateMemberAccessLinksInlineAction(formData), {
      fallbackError: t('bulkLinks.failed'),
      onSuccess: (result) => {
        if ('created' in result) {
          setSuccess(result.created);
          onDone();
        }
      },
    });
  };

  return (
    <AccessLinkModalPortal
      open={open}
      onClose={dismiss}
      titleId={titleId}
      descriptionId={descriptionId}
    >
      <header className={styles.modalHeader}>
        <h2 id={titleId} className={styles.modalTitle}>
          {success != null ? t('bulkLinks.doneTitle') : t('bulkLinks.title')}
        </h2>
        <p id={descriptionId} className={styles.modalDescription}>
          {success != null ? t('bulkLinks.doneText', { count: success }) : t('bulkLinks.text', { count: memberCount })}
        </p>
      </header>

      {success == null ? (
        <>
          <div className={styles.modalBody}>
            <ActionNotice notice={notice} />
            <AccessExpiryPicker idPrefix="bulk-member" value={expiry} onChange={setExpiry} />
          </div>
          <footer className={styles.modalFooter}>
            <div className={styles.actions}>
              <AdminButton type="button" tone="secondary" onClick={dismiss}>
                {t('links.cancel')}
              </AdminButton>
              <AdminButton type="button" onClick={submit} disabled={isPending || memberCount === 0}>
                {isPending ? t('links.creating') : t('bulkLinks.create')}
              </AdminButton>
            </div>
          </footer>
        </>
      ) : (
        <>
          {notice ? (
            <div className={styles.modalBody}>
              <ActionNotice notice={notice} />
            </div>
          ) : null}
          <footer className={styles.modalFooter}>
            <div className={styles.actions}>
              <AdminButton type="button" onClick={dismiss}>
                <FiCheck size={15} />
                {t('bulkLinks.close')}
              </AdminButton>
            </div>
          </footer>
        </>
      )}
    </AccessLinkModalPortal>
  );
}
