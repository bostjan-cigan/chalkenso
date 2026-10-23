'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import AdminDrawerSkeleton from './AdminDrawerSkeleton';
import { setDrawerIntent, useDrawerIntent } from './admin-drawer-intent';
import styles from './AdminDrawer.module.css';

/**
 * Side panel a list opens over itself, rendered through a portal on `document.body` so no
 * ancestor's stacking or overflow can trap it. Which record is open lives in the list's own URL
 * (`?task=<id>`, `?user=<id>`), so the panel is server-rendered with the list, deep-links, and
 * keeps the list's scroll and filter state underneath. Closing replaces the URL, so Back does not
 * reopen it.
 *
 * Both of those are server round trips, so the panel does not wait for them: a clicked card
 * records its intent (see `admin-drawer-intent`) and the panel opens at once on a skeleton, and
 * closing hides the panel before the replace lands. The shell must therefore be rendered on every
 * request, open or not — pass `openKey` for what the URL says and `children` for the record the
 * server rendered (`null` when nothing is open).
 */
export default function AdminDrawerShell({
  openKey,
  closeHref,
  ariaLabel,
  closeLabel: ownCloseLabel,
  skeleton,
  children,
}: {
  /** The record the server actually rendered below, or `null` when nothing is open. */
  openKey: string | null;
  /** The list URL without the open-record param — where closing returns to. */
  closeHref: string;
  ariaLabel: string;
  /** "Close" by default. */
  closeLabel?: string;
  /** Shown until the server's copy of the open record arrives. */
  skeleton?: ReactNode;
  /** The server-rendered detail for `openKey`, or `null` when nothing is open. */
  children: ReactNode;
}) {
  const t = useTranslations('app.ui');
  const closeLabel = ownCloseLabel ?? t('close');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const intent = useDrawerIntent();

  useEffect(() => setMounted(true), []);

  // The URL is the truth: an intent only covers the gap until the navigation it started lands, so
  // drop it the moment the URL settles. Keyed on the URL rather than on `openKey`, because a stale
  // link (`?user=<deleted>`) answers with no record at all — that has to close the panel, not leave
  // it spinning on a skeleton forever.
  const urlKey = `${pathname}?${searchParams.toString()}`;
  useEffect(() => {
    setDrawerIntent(undefined);
  }, [urlKey]);

  const close = useCallback(() => {
    // Hide first — the replace below is a round trip, and a panel that lingers reads as stuck.
    setDrawerIntent(null);
    router.replace(closeHref);
  }, [router, closeHref]);

  const visibleKey = intent === undefined ? openKey : intent;
  const open = visibleKey !== null;
  // Only the record actually asked for: clicking a second card while the first is open must show
  // the skeleton, not the record still sitting in `children`.
  const ready = visibleKey === openKey && children != null;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!mounted || !open) {
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
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-busy={ready ? undefined : true}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={close}
          aria-label={closeLabel}
          title={closeLabel}
        >
          ✕
        </button>
        {ready ? children : (skeleton ?? <AdminDrawerSkeleton label={ariaLabel} />)}
      </aside>
    </div>,
    document.body
  );
}
