'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TbChevronRight, TbDeviceLaptop, TbDeviceMobile, TbDeviceTablet } from 'react-icons/tb';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import type { DeviceKind } from '@/lib/session-device';
import { endSessionAction, signOutEverywhereAction } from '../actions';
import styles from './SessionsList.module.css';

export type SessionRow = {
  id: string;
  kind: DeviceKind;
  /** "Safari on iPhone". */
  device: string;
  /** "Ljubljana, Slovenia", when the host said. */
  place: string | null;
  /** "Now", "3 h ago". */
  lastActive: string;
  /** "Active now", "Active 3 h ago". */
  active: string;
  /** "16 Oct 2026". */
  signedInOn: string;
  /** "Until the browser closes", "Up to 30 days (Keep me signed in)". */
  stays: string;
  current: boolean;
};

const GLYPHS: Record<DeviceKind, typeof TbDeviceLaptop> = {
  computer: TbDeviceLaptop,
  phone: TbDeviceMobile,
  tablet: TbDeviceTablet,
};

function RowContent({ row }: { row: SessionRow }) {
  const t = useTranslations('account.profile.sessions');
  const Glyph = GLYPHS[row.kind];
  return (
    <>
      <span className={styles.glyph} aria-hidden="true">
        <Glyph size={22} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>
          {row.device}
          {row.current ? <span className={styles.current}>{t('thisBrowser')}</span> : null}
        </span>
        <span className={styles.detail}>{[row.place, row.active].filter(Boolean).join(' · ')}</span>
      </span>
    </>
  );
}

/**
 * The person's open sessions, this browser first, like a device list: any other one opens its
 * details, where Sign out ends it. "Sign out of all devices" ends every one, this one too. While a
 * platform admin is logged in as them it only lists them.
 */
export default function SessionsList({ rows, policy, readOnly }: { rows: SessionRow[]; policy: string; readOnly: string | null }) {
  const t = useTranslations('account.profile.sessions');
  const { notice, isPending, run } = useActionNotice();
  // The session shown, or 'all' of them.
  const [asking, setAsking] = useState<SessionRow | 'all' | null>(null);
  const shown = asking && asking !== 'all' ? asking : null;

  const confirm = () => {
    const target = asking;
    if (!target) return;
    // Everywhere: the sign-in page opens next; only a refusal comes back.
    run(() => (target === 'all' ? signOutEverywhereAction() : endSessionAction(target.id)), {
      onSuccess: () => setAsking(null),
      onError: () => setAsking(null),
    });
  };

  return (
    <div data-testid="sessions">
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.id} data-testid="session-row" data-current={row.current ? 'true' : undefined}>
            {row.current || readOnly ? (
              <div className={styles.row}>
                <RowContent row={row} />
              </div>
            ) : (
              <button type="button" className={`${styles.row} ${styles.rowButton}`} aria-haspopup="dialog" onClick={() => setAsking(row)}>
                <RowContent row={row} />
                <TbChevronRight className={styles.chevron} size={18} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <ActionNotice notice={notice} />
        {readOnly ? <p className={styles.note}>{readOnly}</p> : null}
        {!readOnly ? (
          <AdminButton type="button" tone="dangerText" onClick={() => setAsking('all')} disabled={isPending}>
            {t('signOutAll')}
          </AdminButton>
        ) : null}
        <p className={styles.note}>{policy}</p>
      </div>
      <ConfirmDialog
        open={asking !== null}
        tone="danger"
        title={asking === 'all' ? t('signOutAllTitle') : (shown?.device ?? '')}
        description={asking === 'all' ? t('signOutAllDescription') : t('signOutDescription')}
        confirmLabel={asking === 'all' ? t('signOutAllConfirm') : t('signOut')}
        cancelLabel={t('cancel')}
        pending={isPending}
        onConfirm={confirm}
        onClose={() => setAsking(null)}
      >
        {shown ? (
          <dl className={styles.facts} data-testid="session-details">
            <dt>{t('facts.where')}</dt>
            <dd>{shown.place ?? t('facts.unknown')}</dd>
            <dt>{t('facts.lastActive')}</dt>
            <dd>{shown.lastActive}</dd>
            <dt>{t('facts.signedIn')}</dt>
            <dd>{shown.signedInOn}</dd>
            <dt>{t('facts.stays')}</dt>
            <dd>{shown.stays}</dd>
          </dl>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
