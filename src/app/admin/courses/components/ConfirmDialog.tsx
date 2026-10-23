'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AccessLinkModalPortal from '@/app/admin/courses/groups/components/AccessLinkModalPortal';
import modalStyles from '@/app/admin/courses/groups/components/MemberLinkModal.module.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** More than a sentence (details of what it acts on), under the description. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` renders a destructive (red) confirm button. */
  tone?: 'primary' | 'danger';
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Small confirmation modal reusing the shared access-link modal shell and styles. As in a system
 * alert, the safe answer is the default: Cancel has the focus when the action is destructive (Return
 * cancels), the action itself otherwise. Used all over the app, so its own words are the frame's
 * (`app.dialog`), which every section's provider gives.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  pending = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useTranslations('app.dialog');
  const titleId = useId();
  const descriptionId = useId();

  return (
    <AccessLinkModalPortal
      open={open}
      onClose={onClose}
      titleId={titleId}
      descriptionId={descriptionId}
    >
      <header className={modalStyles.modalHeader}>
        <h2 id={titleId} className={modalStyles.modalTitle}>
          {title}
        </h2>
        <p id={descriptionId} className={modalStyles.modalDescription}>
          {description}
        </p>
      </header>

      {children ? <div className={modalStyles.modalBody}>{children}</div> : null}

      <footer className={modalStyles.modalFooter}>
        <div className={modalStyles.actions}>
          <AdminButton type="button" tone="secondary" onClick={onClose} disabled={pending} data-autofocus={tone === 'danger' ? '' : undefined}>
            {cancelLabel ?? t('cancel')}
          </AdminButton>
          <AdminButton type="button" tone={tone} onClick={onConfirm} disabled={pending} data-autofocus={tone === 'danger' ? undefined : ''}>
            {pending ? t('working') : confirmLabel}
          </AdminButton>
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
