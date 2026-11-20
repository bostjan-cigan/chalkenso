'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How far a PDF export is, in percent. The steps that can be counted (lessons and images loaded)
 * say where it is; in between, and while the PDF itself is laid out (which reports nothing), it
 * creeps towards the next step's start without reaching it, so there is always something moving.
 */
export function useExportProgress() {
  const [percent, setPercent] = useState<number | null>(null);
  const ceiling = useRef(0);

  useEffect(() => {
    if (percent === null) return;
    const timer = window.setInterval(() => {
      setPercent((now) => (now === null ? now : Math.min(ceiling.current, now + Math.max(0.2, (ceiling.current - now) * 0.04))));
    }, 250);
    return () => window.clearInterval(timer);
  }, [percent === null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** At least `reached` now, creeping no further than `next`. */
  const step = useCallback((reached: number, next: number) => {
    ceiling.current = next;
    setPercent((now) => Math.max(now ?? 0, reached));
  }, []);
  const stop = useCallback(() => setPercent(null), []);

  return { percent: percent === null ? null : Math.floor(percent), step, stop };
}

export type ExportStep = (reached: number, next: number) => void;
