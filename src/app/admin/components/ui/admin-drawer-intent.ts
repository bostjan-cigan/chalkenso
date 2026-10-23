'use client';

import { useSyncExternalStore, type MouseEvent } from 'react';

/**
 * The drawer a click *asked* for, before the server has answered.
 *
 * Which record a drawer shows lives in the list's URL, so opening and closing are both server
 * round trips — on a cold serverless function that is long enough that a click looks ignored.
 * A card records its intent here the moment it is clicked, and the shell closing records `null`,
 * so the panel can appear (as a skeleton) or disappear immediately while the navigation runs.
 *
 * `undefined` means no intent: the URL alone decides. Module scope is enough because only one
 * drawer host is mounted at a time.
 */
let intent: string | null | undefined;

const listeners = new Set<() => void>();

/** `id` to open that record, `null` to close, `undefined` to hand control back to the URL. */
export function setDrawerIntent(next: string | null | undefined) {
  if (intent === next) {
    return;
  }
  intent = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return intent;
}

/** Server render has no clicks behind it, so it always sees "no intent". */
function getServerSnapshot() {
  return undefined;
}

export function useDrawerIntent() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Record a card click's intent, unless the browser is going to handle it itself (middle click,
 * cmd/ctrl/shift/alt for a new tab or window) — no drawer opens in this tab then.
 */
export function noteDrawerIntentFromClick(
  event: MouseEvent<HTMLAnchorElement>,
  drawerKey: string
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  setDrawerIntent(drawerKey);
}
