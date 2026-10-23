'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useTransition } from 'react';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import { Sheet } from '@/app/admin/components/ui/Sheet';
import { markHowItWorksDoneAction } from './actions';
import type { HowItWorksAction } from './data';
import styles from './how-it-works.module.css';

/**
 * How Chalkenso works in a sheet, opened from Getting started (only when the person asks: it never
 * opens by itself). At the end: Mark as done, and the one action, which marks it done too.
 */
export default function HowItWorksSheet({
  open,
  onClose,
  action,
  children,
}: {
  open: boolean;
  onClose: () => void;
  action: HowItWorksAction;
  children: ReactNode;
}) {
  const t = useTranslations('app.howItWorks');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const finish = (then?: string) =>
    startTransition(async () => {
      await markHowItWorksDoneAction();
      onClose();
      if (then) router.push(then);
      else router.refresh();
    });

  return (
    <Sheet title={t('title')} open={open} onClose={onClose}>
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        {children}
        <div className={styles.footer}>
          <AdminButton type="button" tone="plain" disabled={pending} onClick={() => finish()} data-testid="how-it-works-sheet-done">
            {t('markDone')}
          </AdminButton>
          <AdminButton type="button" disabled={pending} onClick={() => finish(action.href)} data-testid="how-it-works-action">
            {t(`action.${action.kind}`)}
          </AdminButton>
        </div>
      </div>
    </Sheet>
  );
}
