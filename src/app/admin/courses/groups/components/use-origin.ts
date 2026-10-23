'use client';

import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/** This site's origin in the browser, '' while rendering on the server (so hydration matches). */
export function useOrigin() {
  return useSyncExternalStore(noSubscription, () => window.location.origin, () => '');
}
