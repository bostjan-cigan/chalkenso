'use client';

import { useEffect, useRef } from 'react';
import { HIDDEN_POLL_MS, POLL_MS } from '@/lib/ai-draft-progress';

/**
 * Follows drafts being written (`/admin/api/drafts/<id>/progress`), about once a second and less
 * often from another tab, each ask waiting for the one before. `onNext` gets what each is now (null:
 * used, discarded, or no longer the person's to see). A failed ask is only asked again.
 */
export function useDraftProgress<T>(ids: string[], onNext: (id: string, next: T | null) => void) {
  const latest = useRef(onNext);
  latest.current = onNext;
  const key = ids.join(',');
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timer = 0;
    let asking = false;
    const ask = async () => {
      if (asking) return;
      asking = true;
      window.clearTimeout(timer);
      for (const id of key.split(',')) {
        try {
          const response = await fetch(`/admin/api/drafts/${id}/progress`, { signal: controller.signal, cache: 'no-store' });
          if (controller.signal.aborted) return;
          if (response.status === 404) latest.current(id, null);
          else if (response.ok) latest.current(id, ((await response.json()) as { draft: T | null }).draft);
        } catch {
          // Asked again in a moment.
        }
        if (controller.signal.aborted) return;
      }
      asking = false;
      timer = window.setTimeout(ask, document.visibilityState === 'visible' ? POLL_MS : HIDDEN_POLL_MS);
    };
    // Back on the page: at once, not at the next slow ask.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    timer = window.setTimeout(ask, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);
}
