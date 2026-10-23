'use client';

import { useEffect, useRef } from 'react';
import type { AiProposalKind } from '@prisma/client';
import { HANDOFF_STARTED_EVENT, type HandoffStartedDetail } from './events';

/** Calls `onStarted` when someone hands this target's work to their own Claude on this page (events.ts). */
export function useHandoffStarted(kind: AiProposalKind, targetId: string, onStarted: (detail: HandoffStartedDetail) => void) {
  const handler = useRef(onStarted);
  useEffect(() => {
    handler.current = onStarted;
  }, [onStarted]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<HandoffStartedDetail>).detail;
      if (detail?.kind === kind && detail.targetId === targetId) handler.current(detail);
    };
    window.addEventListener(HANDOFF_STARTED_EVENT, listener);
    return () => window.removeEventListener(HANDOFF_STARTED_EVENT, listener);
  }, [kind, targetId]);
}
