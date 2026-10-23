'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export type ActionNoticeTone = 'success' | 'error';

export type ActionNoticeState = {
  tone: ActionNoticeTone;
  message: string;
} | null;

/** Minimal shape every inline server action returns. */
export type ActionResult = {
  ok: boolean;
  message?: string;
};

type RunOptions<T> = {
  onSuccess?: (result: T) => void;
  onError?: (result: T) => void;
  /** Re-fetch server components after a successful action (default true). */
  refresh?: boolean;
  /** Notice shown if the action throws unexpectedly. */
  fallbackError?: string;
};

/**
 * Standard client-side handling for server actions that return `{ ok, message }`:
 * runs the action in a transition, surfaces its message as an inline notice, and
 * refreshes server components on success. Replaces the `?status=`/`?error=` URL pattern.
 */
export function useActionNotice(defaults?: { refresh?: boolean }) {
  const router = useRouter();
  const t = useTranslations('app.ui');
  const [notice, setNotice] = useState<ActionNoticeState>(null);
  const [isPending, startTransition] = useTransition();

  const run = useCallback(
    <T extends ActionResult>(action: () => Promise<T>, options?: RunOptions<T>) => {
      startTransition(() => {
        action()
          .then((result) => {
            setNotice(
              result.message
                ? { tone: result.ok ? 'success' : 'error', message: result.message }
                : null
            );

            if (result.ok) {
              options?.onSuccess?.(result);
              if (options?.refresh ?? defaults?.refresh ?? true) {
                router.refresh();
              }
            } else {
              options?.onError?.(result);
            }
          })
          .catch(() => {
            setNotice({
              tone: 'error',
              message: options?.fallbackError ?? t('failed'),
            });
          });
      });
    },
    [router, defaults?.refresh, t]
  );

  return { notice, isPending, run, setNotice, clearNotice: () => setNotice(null) };
}
