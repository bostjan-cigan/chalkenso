'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { hideGettingStartedAction } from './actions';
import styles from '@/app/admin/admin.module.css';

/** On Home while Getting started is hidden and has steps left: a quiet line that brings it back. */
export default function ShowGettingStarted() {
  const t = useTranslations('app.gettingStarted');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <p className={styles.fieldHint} style={{ margin: 0 }} data-testid="getting-started-hidden">
      {t('hidden')}{' '}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await hideGettingStartedAction(false);
            router.refresh();
          })
        }
        style={{ padding: 0, border: 0, background: 'none', color: 'var(--accent-color-hex)', font: 'inherit', fontWeight: 600, cursor: 'pointer' }}
        data-testid="getting-started-show"
      >
        {t('show')}
      </button>
    </p>
  );
}
