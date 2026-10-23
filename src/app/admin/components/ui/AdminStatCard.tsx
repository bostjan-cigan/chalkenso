'use client';

import AdminCard from './AdminCard';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

interface AdminStatCardProps {
  className?: string;
  label: string;
  large?: boolean;
  note?: string;
  value: string;
}

export default function AdminStatCard({
  className,
  label,
  large = false,
  note,
  value,
}: AdminStatCardProps) {
  return (
    <AdminCard
      variant="summary"
      className={cn(large && styles.statCardLarge, className)}
    >
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {note ? <p className={styles.statNote}>{note}</p> : null}
    </AdminCard>
  );
}
