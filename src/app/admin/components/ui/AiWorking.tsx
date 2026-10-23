'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { elapsed } from '@/lib/ai-draft-progress';
import styles from './AiWorking.module.css';

/** Claude's own "working" mark: an asterisk that grows and shrinks (text glyphs, never emoji). */
const FRAMES = ['·', '✢', '✳︎', '✶', '✻', '✽', '✻', '✶', '✳︎', '✢'];
const FRAME_MS = 120;

function Glyph() {
  const [frame, setFrame] = useState(4);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % FRAMES.length), FRAME_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className={styles.glyph} aria-hidden>
      {FRAMES[frame]}
    </span>
  );
}

/** The clock, once a second. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * AI at work, wherever it is: a plan, a lesson's changes, a hand-off to someone's own Claude. One
 * block for all of them, so it reads the same everywhere: what it is doing (the line shimmers, like
 * Claude's), for how long, how far when that can be told (the bar fills; otherwise it sweeps), and
 * Stop. What it has written so far goes under it (`children`). The motion stops for people who
 * asked for less of it.
 */
export default function AiWorking({
  label,
  startedAt,
  timeLabel,
  meta = [],
  share = null,
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
  /** A few words after the clock: who started it, how much is written. */
  meta?: Array<string | null | false>;
  /** How far it is, 0–1, when it can be told. */
  share?: number | null;
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
        <Glyph />
        <span className={styles.line}>
          <span className={styles.label} role="status" data-testid={stageTestId}>
            <span className={styles.shimmer}>{label}</span>
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
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share === null ? undefined : Math.round(share * 100)}
      >
        {share === null ? <span className={styles.sweep} /> : <span className={styles.fill} style={{ width: `${Math.max(4, share * 100)}%` }} />}
      </div>
    </div>
  );
}
