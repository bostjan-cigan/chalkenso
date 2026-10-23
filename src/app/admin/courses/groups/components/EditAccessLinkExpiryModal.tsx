'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import { formatDateTimeLocalValue } from '@/lib/access-links';
import { updateAccessLinkExpiryInlineAction } from '../actions';
import AccessExpiryPicker from './AccessExpiryPicker';
import AccessLinkModalPortal from './AccessLinkModalPortal';
import type { MemberLinkState } from './MemberLinkModal';
import styles from './MemberLinkModal.module.css';

type LinkShape = NonNullable<MemberLinkState>;

type EditAccessLinkExpiryModalProps = {
  groupId: string;
  link: LinkShape;
  memberLabel?: string;
  onClose: () => void;
  onSaved: (link: LinkShape) => void;
  open: boolean;
  variant: 'group' | 'member';
};

export default function EditAccessLinkExpiryModal({
  open,
  onClose,
  groupId,
  link,
  variant,
  memberLabel,
  onSaved,
}: EditAccessLinkExpiryModalProps) {
  const t = useTranslations('groups');
  const titleId = useId();
  const descriptionId = useId();
  const [expiry, setExpiry] = useState(() => formatDateTimeLocalValue(new Date(link.expiresAt)));
  const { notice, isPending, run, setNotice } = useActionNotice({ refresh: false });

  useEffect(() => {
    if (!open) {
      return;
    }
    setExpiry(formatDateTimeLocalValue(new Date(link.expiresAt)));
    setNotice(null);
  }, [open, link.expiresAt, link.id, setNotice]);

  function submit() {
    const formData = new FormData();
    formData.set('groupId', groupId);
    formData.set('linkId', link.id);
    formData.set('expiresAt', expiry);

    run(() => updateAccessLinkExpiryInlineAction(formData), {
      fallbackError: t('editExpiry.failed'),
      onSuccess: (result) => {
        if ('link' in result) {
          onSaved(result.link);
          onClose();
        }
      },
    });
  }

  const title = variant === 'group' ? t('editExpiry.groupTitle') : t('editExpiry.memberTitle');

  const description =
    variant === 'group'
      ? t('editExpiry.groupText')
      : memberLabel
        ? t('editExpiry.memberTextNamed', { learner: memberLabel })
        : t('editExpiry.memberText');

  return (
    <AccessLinkModalPortal
      open={open}
      onClose={onClose}
      titleId={titleId}
      descriptionId={descriptionId}
    >
      <header className={styles.modalHeader}>
        <h2 id={titleId} className={styles.modalTitle}>
          {title}
        </h2>
        <p id={descriptionId} className={styles.modalDescription}>
          {description}
        </p>
      </header>

      <div className={styles.modalBody}>
        <ActionNotice notice={notice} />
        <AccessExpiryPicker
          idPrefix={`edit-access-${link.id}`}
          value={expiry}
          onChange={setExpiry}
        />
      </div>

      <footer className={styles.modalFooter}>
        <div className={styles.actions}>
          <AdminButton type="button" tone="secondary" onClick={onClose}>
            {t('links.cancel')}
          </AdminButton>
          <AdminButton type="button" onClick={submit} disabled={isPending}>
            {isPending ? t('editExpiry.saving') : t('editExpiry.save')}
          </AdminButton>
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
