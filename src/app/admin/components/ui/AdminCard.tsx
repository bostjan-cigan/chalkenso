'use client';

import { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

type CardElement = 'article' | 'div' | 'section';
type CardVariant = 'section' | 'compact' | 'summary' | 'panel' | 'selected';

interface AdminCardProps {
  children: ReactNode;
  as?: CardElement;
  variant?: CardVariant;
  className?: string;
}

export default function AdminCard({
  children,
  as = 'article',
  variant = 'section',
  className,
}: AdminCardProps) {
  const Component = as;

  const variantClass =
    variant === 'compact'
      ? styles.cardCompact
      : variant === 'summary'
        ? styles.cardSummary
        : variant === 'panel'
          ? styles.cardPanel
          : variant === 'selected'
            ? styles.cardSelected
            : styles.cardSection;

  return <Component className={cn(styles.card, variantClass, className)}>{children}</Component>;
}
