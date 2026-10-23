'use client';

import { ReactNode } from 'react';
import AdminBadge from './AdminBadge';
import AdminCard from './AdminCard';
import styles from '../../admin.module.css';

interface AdminSectionCardProps {
  kicker: string;
  title: string;
  icon?: ReactNode;
  /** Renders inline to the right of the kicker badge (e.g. header action button). */
  kickerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function AdminSectionCard({
  kicker,
  title,
  icon,
  kickerAction,
  children,
  className,
}: AdminSectionCardProps) {
  return (
    <AdminCard variant="section" className={className}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderText}>
          {kickerAction ? (
            <div className={styles.cardHeaderKickerRow}>
              <AdminBadge variant="kicker">{kicker}</AdminBadge>
              {kickerAction}
            </div>
          ) : (
            <AdminBadge variant="kicker">{kicker}</AdminBadge>
          )}
          {title ? <h2 className={styles.cardHeaderTitle}>{title}</h2> : null}
        </div>
        {icon ? <div className={styles.cardHeaderIcon}>{icon}</div> : null}
      </div>
      {children}
    </AdminCard>
  );
}
