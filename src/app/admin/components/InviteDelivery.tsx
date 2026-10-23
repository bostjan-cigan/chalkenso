'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import AdminField from './ui/AdminField';
import styles from '../admin.module.css';

const choice = (selected: boolean): CSSProperties => ({
  padding: '0.45rem 0.8rem',
  borderRadius: 10,
  border: selected ? '2px solid rgb(var(--accent-color))' : '1px solid var(--line-strong)',
  background: selected ? 'rgba(var(--accent-color), 0.08)' : 'var(--card-bg)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
});

/**
 * How an invite reaches them: a link to copy and send yourself, or an email from us (with the link
 * shown too). The form posts `delivery` (hidden, by its owner) and, for email, `email`.
 */
export default function InviteDelivery({
  idPrefix,
  delivery,
  onChange,
}: {
  idPrefix: string;
  delivery: 'link' | 'email';
  onChange: (next: 'link' | 'email') => void;
}) {
  const t = useTranslations('app.invite');
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <InviteDeliveryChoice idPrefix={idPrefix} delivery={delivery} onChange={onChange} />
      {delivery === 'email' ? (
        <AdminField id={`${idPrefix}-email`} name="email" type="email" label={t('theirEmail')} autoComplete="off" required />
      ) : null}
    </div>
  );
}

function InviteDeliveryChoice({
  idPrefix,
  delivery,
  onChange,
}: {
  idPrefix: string;
  delivery: 'link' | 'email';
  onChange: (next: 'link' | 'email') => void;
}) {
  const t = useTranslations('app.invite');
  return (
    <>
      <span className={styles.inputLabel}>{t('sendIt')}</span>
      <div role="radiogroup" aria-label={t('sendIt')} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {(
          [
            ['link', t('justLink')],
            ['email', t('email')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={delivery === value}
            data-testid={`${idPrefix}-delivery-${value}`}
            style={choice(delivery === value)}
            onClick={() => onChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

/** The same choice where the email is state (a panel that calls its action directly, not a form). */
export function InviteDeliveryControlled({
  idPrefix,
  delivery,
  onChange,
  email,
  onEmail,
}: {
  idPrefix: string;
  delivery: 'link' | 'email';
  onChange: (next: 'link' | 'email') => void;
  email: string;
  onEmail: (next: string) => void;
}) {
  const t = useTranslations('app.invite');
  return (
    <div style={{ display: 'grid', gap: '0.5rem', maxWidth: 420 }}>
      <InviteDeliveryChoice idPrefix={idPrefix} delivery={delivery} onChange={onChange} />
      {delivery === 'email' ? (
        <AdminField
          id={`${idPrefix}-email`}
          type="email"
          label={t('theirEmail')}
          autoComplete="off"
          value={email}
          onChange={(event) => onEmail(event.target.value)}
        />
      ) : null}
    </div>
  );
}
