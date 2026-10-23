'use client';

import { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

interface AdminFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  hint?: ReactNode;
  className?: string;
  inputClassName?: string;
  fullWidth?: boolean;
}

export default function AdminField({
  label,
  hint,
  className,
  inputClassName,
  fullWidth = false,
  id,
  ...props
}: AdminFieldProps) {
  return (
    <label className={cn(styles.field, fullWidth && styles.fieldFullWidth, className)} htmlFor={id}>
      <span className={styles.inputLabel}>{label}</span>
      <input id={id} className={cn(styles.textInput, inputClassName)} {...props} />
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}
