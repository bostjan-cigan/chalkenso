'use client';

import { cn } from '@/utils/cn';
import styles from './LoadingFillCircle.module.css';

interface LoadingFillCircleProps {
  ariaLabel?: string;
  centered?: boolean;
  className?: string;
}

export default function LoadingFillCircle({
  ariaLabel = 'Loading content',
  centered = false,
  className,
}: LoadingFillCircleProps) {
  return (
    <div
      className={cn(styles.root, centered && styles.centered, className)}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <span className={styles.spinner} aria-hidden="true" />
    </div>
  );
}
