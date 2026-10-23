'use client';

import { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import AdminButton from './AdminButton';

interface AdminSubmitButtonProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  pendingText?: ReactNode;
  /** `dangerText`: a destructive step as quiet red words (it follows a page that asked first). */
  tone?: 'primary' | 'secondary' | 'dangerText';
  /** For tests: the button's `data-testid`. */
  testId?: string;
}

export default function AdminSubmitButton({
  children,
  className,
  disabled = false,
  fullWidth = false,
  pendingText,
  tone = 'primary',
  testId,
}: AdminSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <AdminButton
      type="submit"
      tone={tone}
      className={className}
      disabled={pending || disabled}
      fullWidth={fullWidth}
      data-testid={testId}
    >
      {pending ? pendingText ?? children : children}
    </AdminButton>
  );
}
