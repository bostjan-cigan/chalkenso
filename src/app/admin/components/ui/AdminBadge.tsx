'use client';

import { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

type BadgeVariant = 'accent' | 'warning' | 'muted' | 'kicker' | 'inactive';

interface AdminBadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export default function AdminBadge({
  children,
  variant = 'accent',
  className,
}: AdminBadgeProps) {
  const variantClass =
    variant === 'warning'
      ? styles.badgeWarning
      : variant === 'muted'
        ? styles.badgeMuted
        : variant === 'kicker'
          ? styles.kicker
          : variant === 'inactive'
            ? styles.badgeInactive
            : styles.badgeAccent;

  return <span className={cn(styles.badge, variantClass, className)}>{children}</span>;
}
