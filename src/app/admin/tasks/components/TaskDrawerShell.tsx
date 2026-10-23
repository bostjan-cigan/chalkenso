'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './TaskDrawer.module.css';

/**
 * Side panel the task board opens over itself, rendered through a portal on `document.body` so no
 * ancestor's stacking or overflow can trap it. Which task is open lives in the board's own URL
 * (`?task=<id>`), so the panel is server-rendered with the board, deep-links, and keeps the board's
 * scroll and lane state underneath. Closing replaces the URL, so Back does not reopen it.
 */
export default function TaskDrawerShell({
  closeHref,
  children,
}: {
  /** The board URL without `?task=` — where closing returns to. */
  closeHref: string;
  children: ReactNode;
}) {
  const t = useTranslations('tasks.page');
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const close = useCallback(() => router.replace(closeHref), [router, closeHref]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={t('drawerLabel')}>
        <button
          type="button"
          className={styles.closeButton}
          onClick={close}
          aria-label={t('closeTask')}
          title={t('close')}
        >
          ✕
        </button>
        {children}
      </aside>
    </div>,
    document.body
  );
}
