'use client';

import { ReactNode } from 'react';
import AdminCard from './AdminCard';
import styles from '../../admin.module.css';

interface AdminSectionCardProps {
  /** The card's heading: no label above it, no sentence under it. */
  title: string;
  /** Beside the title, on the right (e.g. "All groups"). */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export default function AdminSectionCard({ title, action, children, className }: AdminSectionCardProps) {
  return (
    <AdminCard variant="section" className={className}>
      {title || action ? (
        <div className={styles.cardHeader}>
          {title ? <h2 className={styles.cardHeaderTitle}>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </AdminCard>
  );
}
