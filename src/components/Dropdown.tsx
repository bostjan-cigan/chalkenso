'use client';

import { type ReactNode, useState } from 'react';
import AdminSearchableSelectField, {
  type AdminSearchableSelectOption,
} from '@/app/admin/components/ui/AdminSearchableSelectField';

/**
 * The product's dropdown for plain forms: submits like a `<select name>` (through a hidden input),
 * keeps its own value, and leaves out the search box for short lists. Never use a native
 * `<select>`: for a controlled dropdown, use `AdminSearchableSelectField` with `onValueChange`.
 */
export default function Dropdown({
  id,
  name,
  label,
  options,
  defaultValue = '',
  placeholder,
  hideLabel = false,
  labelClassName,
  className,
  compact = false,
  disabled = false,
  hint,
  onValueChange,
}: {
  id: string;
  name: string;
  label: string;
  options: AdminSearchableSelectOption[];
  defaultValue?: string;
  placeholder?: string;
  hideLabel?: boolean;
  labelClassName?: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  /** Called after the value changes (the hidden input has it from the next render). */
  onValueChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <AdminSearchableSelectField
      id={id}
      name={name}
      label={label}
      options={options}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
      placeholder={placeholder}
      searchable={options.length > 8}
      hideLabel={hideLabel}
      labelClassName={labelClassName}
      className={className}
      compact={compact}
      disabled={disabled}
      hint={hint}
    />
  );
}
