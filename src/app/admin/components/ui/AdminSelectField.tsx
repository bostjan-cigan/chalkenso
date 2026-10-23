'use client';

import {
  Children,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '@/utils/cn';
import AdminSearchableSelectField, {
  type AdminSearchableSelectOption,
} from './AdminSearchableSelectField';

interface AdminSelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label: string;
  hint?: ReactNode;
  className?: string;
  /** Reserved for API compatibility; searchable control uses shared field styling. */
  selectClassName?: string;
  fullWidth?: boolean;
  children: ReactNode;
}

function extractText(node: ReactNode): string {
  if (node == null || node === false) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return '';
}

function optionsFromChildren(children: ReactNode): AdminSearchableSelectOption[] {
  return Children.toArray(children)
    .filter(isValidElement)
    .filter((el): el is ReactElement<{ value?: string; children?: ReactNode }> => el.type === 'option')
    .map((el) => ({
      value: String(el.props.value ?? ''),
      label: extractText(el.props.children).trim() || String(el.props.value ?? ''),
    }));
}

/**
 * Searchable dropdown with the same `<option>` children API as a native `<select>`,
 * styled like other admin fields.
 */
export default function AdminSelectField({
  label,
  hint,
  className,
  selectClassName: _selectClassName,
  fullWidth = false,
  id,
  children,
  onChange,
  value,
  name,
  required,
  disabled,
}: AdminSelectFieldProps) {
  const options = optionsFromChildren(children);

  return (
    <AdminSearchableSelectField
      className={cn(className)}
      disabled={disabled}
      fullWidth={fullWidth}
      hint={hint}
      id={id ?? 'admin-select'}
      label={label}
      name={name ?? ''}
      onChange={onChange}
      options={options}
      required={required}
      value={value === undefined || value === null ? '' : String(value)}
    />
  );
}
