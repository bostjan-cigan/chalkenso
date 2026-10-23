'use client';

import { type InputHTMLAttributes, type ReactNode } from 'react';
import { FiCheck } from 'react-icons/fi';
import { cn } from '@/utils/cn';
import styles from './AdminCheckbox.module.css';

interface AdminCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/**
 * Admin checkbox matching the field styling (like AdminSelectField). Wraps a visually hidden native
 * checkbox, so it behaves like `<input type="checkbox">` in forms and for keyboard/screen readers.
 */
export default function AdminCheckbox({ label, hint, className, disabled, ...inputProps }: AdminCheckboxProps) {
  return (
    <label className={cn(styles.root, disabled && styles.rootDisabled, className)}>
      <input type="checkbox" className={styles.input} disabled={disabled} {...inputProps} />
      <span className={styles.box} aria-hidden="true">
        <FiCheck className={styles.check} size={14} strokeWidth={3} />
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
    </label>
  );
}
