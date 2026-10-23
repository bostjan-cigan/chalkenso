'use client';

import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import AdminNotice from './AdminNotice';
import type { ActionNoticeState } from './useActionNotice';
import styles from '../../admin.module.css';

interface ActionNoticeProps {
  notice: ActionNoticeState;
  className?: string;
}

/** Renders the inline notice produced by `useActionNotice` (icon conveys success/error). */
export default function ActionNotice({ notice, className }: ActionNoticeProps) {
  if (!notice) {
    return null;
  }

  return (
    <AdminNotice
      className={className ?? styles.statusNotice}
      variant="banner"
      icon={
        notice.tone === 'error' ? (
          <FiAlertTriangle size={18} />
        ) : (
          <FiCheckCircle size={18} />
        )
      }
    >
      {notice.message}
    </AdminNotice>
  );
}
