'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { elapsed } from '@/lib/ai-draft-progress';
import styles from './AiWorking.module.css';

/** The one thing that moves while AI works (a still ring for people who asked for less motion). */
export function AiSpinner() {
  return <span className={styles.spinner} aria-hidden />;
}

/** The clock, once a second. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * AI at work, wherever it is: a plan, a lesson's changes, a hand-off to someone's own Claude. One
 * block for all of them, so it reads the same everywhere: what it is doing, for how long, and Stop.
 * What it has written so far, or how far it is, goes under it (`children`). One thing moves at a
 * time: the spinner here, or (`still`) the one on the row being written below.
 */
export default function AiWorking({
  label,
  startedAt,
  timeLabel,
  meta = [],
  still = false,
  detail,
  actions,
  children,
  testId,
  stageTestId,
}: {
  /** What it is doing, in a few words: "Claude is writing changes…". */
  label: string;
  startedAt: string;
  /** The clock for screen readers ("0:42 so far"). */
  timeLabel: (time: string) => string;
  /** A few words after the clock: who started it. */
  meta?: Array<string | null | false>;
  /** Something in `children` shows the motion instead. */
  still?: boolean;
  /** A quiet line under it: who started it, where it happens, what the person can do meanwhile. */
  detail?: ReactNode;
  /** Stop, and anything else that belongs to the work (Open Claude again). */
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
  stageTestId?: string;
}) {
  const time = elapsed(startedAt, useNow());
  return (
    <div className={styles.box} data-testid={testId}>
      <div className={styles.head}>
        {still ? null : <AiSpinner />}
        <span className={styles.line}>
          <span className={styles.label} role="status" data-testid={stageTestId}>
            {label}
          </span>{' '}
          <span className={styles.time}>
            <span aria-label={timeLabel(time)}>{time}</span>
            {meta.filter(Boolean).map((words) => ` · ${words}`)}
          </span>
        </span>
        {actions ? <span className={styles.actions}>{actions}</span> : null}
      </div>
      {detail ? <p className={styles.detail}>{detail}</p> : null}
      {children}
    </div>
  );
}
