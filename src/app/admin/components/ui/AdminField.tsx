'use client';

import { InputHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

interface AdminFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  /** What's wrong with the value, under the field. A field says nothing else. */
  error?: string | null;
  className?: string;
  inputClassName?: string;
  fullWidth?: boolean;
}

export default function AdminField({
  label,
  error,
  className,
  inputClassName,
  fullWidth = false,
  id,
  ...props
}: AdminFieldProps) {
  return (
    <label className={cn(styles.field, fullWidth && styles.fieldFullWidth, className)} htmlFor={id}>
      <span className={styles.inputLabel}>{label}</span>
      <input id={id} className={cn(styles.textInput, inputClassName)} aria-invalid={error ? true : undefined} {...props} />
      {error ? <span className={styles.fieldError} role="alert">{error}</span> : null}
    </label>
  );
}
