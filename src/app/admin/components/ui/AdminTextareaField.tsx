'use client';

import { forwardRef, TextareaHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

type TextareaVariant = 'default' | 'markdown';

interface AdminTextareaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label: string;
  /** What's wrong with the value, under the field. A field says nothing else. */
  error?: string | null;
  className?: string;
  textareaClassName?: string;
  fullWidth?: boolean;
  variant?: TextareaVariant;
}

const AdminTextareaField = forwardRef<HTMLTextAreaElement, AdminTextareaFieldProps>(
  function AdminTextareaField(
    {
      label,
      error,
      className,
      textareaClassName,
      fullWidth = false,
      variant = 'default',
      id,
      ...props
    },
    ref
  ) {
    return (
      <label
        className={cn(styles.field, fullWidth && styles.fieldFullWidth, className)}
        htmlFor={id}
      >
        <span className={styles.inputLabel}>{label}</span>
        <textarea
          ref={ref}
          id={id}
          className={cn(
            styles.textArea,
            variant === 'markdown' && styles.textAreaMarkdown,
            textareaClassName
          )}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error ? <span className={styles.fieldError} role="alert">{error}</span> : null}
      </label>
    );
  }
);

export default AdminTextareaField;
