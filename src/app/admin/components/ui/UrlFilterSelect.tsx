'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AdminSearchableSelectField from './AdminSearchableSelectField';

/**
 * A filter kept in the URL (`?group=`…): picking an option changes that one parameter and leaves the
 * rest (the tab, what is shown). The first option is "everything" (an empty value).
 */
export default function UrlFilterSelect({
  id,
  label,
  param,
  value,
  options,
  reset = [],
}: {
  id: string;
  label: string;
  param: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  /** Parameters that stop making sense once this one changes (e.g. `lesson`). */
  reset?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <AdminSearchableSelectField
      id={id}
      label={label}
      hideLabel
      compact
      style={{ minWidth: 220 }}
      searchable={options.length > 8}
      value={value}
      options={options}
      onValueChange={(next) => {
        const query = new URLSearchParams(params.toString());
        if (next) query.set(param, next);
        else query.delete(param);
        for (const key of reset) query.delete(key);
        router.push(`${pathname}${query.size ? `?${query.toString()}` : ''}`);
      }}
    />
  );
}
