'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import AdminSelectField from '../../components/ui/AdminSelectField';

export type CurriculumFilterOption = { value: string; label: string; count: number };

/**
 * Narrows the board to one curriculum. The choice lives in the URL (`?curriculum=<laneId>`) rather
 * than in component state, so it survives a refresh and can be linked to from a group's page.
 */
export default function TaskCurriculumFilter({
  kind,
  value,
  options,
}: {
  kind: string;
  /** Selected lane id, or '' for all curricula. */
  value: string;
  options: CurriculumFilterOption[];
}) {
  const t = useTranslations('tasks.filter');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <AdminSelectField
      id="task-curriculum-filter"
      label={t('label')}
      value={value}
      disabled={isPending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => {
          router.push(
            next
              ? `/admin/tasks?kind=${kind}&curriculum=${encodeURIComponent(next)}`
              : `/admin/tasks?kind=${kind}`
          );
        });
      }}
    >
      <option value="">{t('all')}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {t('option', { label: option.label, count: option.count })}
        </option>
      ))}
    </AdminSelectField>
  );
}
