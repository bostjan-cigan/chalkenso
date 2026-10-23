'use client';

import { forwardRef, ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

type TextareaVariant = 'default' | 'markdown';

interface AdminTextareaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label: string;
  hint?: ReactNode;
  className?: string;
  textareaClassName?: string;
  fullWidth?: boolean;
  variant?: TextareaVariant;
}

const AdminTextareaField = forwardRef<HTMLTextAreaElement, AdminTextareaFieldProps>(
  function AdminTextareaField(
    {
      label,
      hint,
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
          {...props}
        />
        {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
      </label>
    );
  }
);

export default AdminTextareaField;
