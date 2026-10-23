'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { FiArrowDown, FiArrowUp, FiX } from 'react-icons/fi';
import AdminButton from '../../components/ui/AdminButton';
import AdminSearchableSelectField from '../../components/ui/AdminSearchableSelectField';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

export type PartnerOption = { id: string; name: string; websiteUrl?: string | null };

interface PartnerListFieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  options: PartnerOption[];
  initialPartnerIds?: string[];
  /** Spans both columns of a `formGrid`. */
  fullWidth?: boolean;
}

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.35rem 0',
  borderTop: '1px solid var(--card-border)',
} as const;

/**
 * An ordered list of partners for a course or group: add them from the organisation's partners,
 * move them up or down, remove them. Posts `partnerId` once per partner, in order, and
 * `partnersField`, so the action knows the list was in the form (empty then means "none").
 */
export default function PartnerListField({
  id,
  label,
  hint,
  options,
  initialPartnerIds = [],
  fullWidth = false,
}: PartnerListFieldProps) {
  const t = useTranslations('courses.partners.list');
  const known = new Set(options.map((option) => option.id));
  const [partnerIds, setPartnerIds] = useState(() => initialPartnerIds.filter((partnerId) => known.has(partnerId)));
  const byId = new Map(options.map((option) => [option.id, option]));
  const available = options.filter((option) => !partnerIds.includes(option.id));

  function move(index: number, offset: number) {
    setPartnerIds((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + offset, 0, moved);
      return next;
    });
  }

  return (
    <div className={cn(styles.field, fullWidth && styles.fieldFullWidth)} data-testid={`${id}-list`}>
      <span className={styles.inputLabel}>{label}</span>
      <input type="hidden" name="partnersField" value="1" />
      {partnerIds.map((partnerId) => (
        <input key={partnerId} type="hidden" name="partnerId" value={partnerId} />
      ))}

      {partnerIds.length > 0 ? (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {partnerIds.map((partnerId, index) => (
            <li key={partnerId} style={row}>
              <span className={styles.fieldHint} style={{ minWidth: '1.25rem' }}>
                {index + 1}.
              </span>
              <span style={{ flex: 1 }}>{byId.get(partnerId)?.name}</span>
              <AdminButton
                type="button"
                tone="secondary"
                size="compact"
                aria-label={t('moveUp')}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <FiArrowUp size={14} />
              </AdminButton>
              <AdminButton
                type="button"
                tone="secondary"
                size="compact"
                aria-label={t('moveDown')}
                disabled={index === partnerIds.length - 1}
                onClick={() => move(index, 1)}
              >
                <FiArrowDown size={14} />
              </AdminButton>
              <AdminButton
                type="button"
                tone="secondary"
                size="compact"
                aria-label={t('remove', { name: byId.get(partnerId)?.name ?? t('partner') })}
                onClick={() => setPartnerIds((current) => current.filter((value) => value !== partnerId))}
              >
                <FiX size={14} />
              </AdminButton>
            </li>
          ))}
        </ol>
      ) : null}

      {options.length === 0 ? (
        <span className={styles.fieldHint}>
          {t.rich('none', { link: (chunks) => <Link href="/admin/courses/partners">{chunks}</Link> })}
        </span>
      ) : available.length > 0 ? (
        <AdminSearchableSelectField
          id={`${id}-add`}
          name=""
          label={t('addTo', { label: label.toLowerCase() })}
          hideLabel
          compact
          placeholder={partnerIds.length ? t('addAnother') : t('add')}
          searchable={options.length > 8}
          value=""
          options={available.map((option) => ({ label: option.name, value: option.id }))}
          onChange={(event) => {
            const partnerId = event.target.value;
            if (partnerId) setPartnerIds((current) => [...current, partnerId]);
          }}
        />
      ) : null}

      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </div>
  );
}
