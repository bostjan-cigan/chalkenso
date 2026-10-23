'use client';

import type { ReactNode } from 'react';
import { TbCheck, TbChevronRight } from 'react-icons/tb';
import { excerpt } from '@/lib/improvement-label';
import type { ViewFeedback } from './data';
import styles from './improvements-view.module.css';

/**
 * The pieces of the Improve view's column, the lesson's to-do beside it: one tick for every choice
 * (the feedback to fix with AI, the changes to keep), cards for feedback, rows for changes and for
 * other work, each opening what it is.
 */

/** A round tick, filled when on: the column's one control for choosing. */
export function Tick({ on, label, onToggle, disabled, testId }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" className={styles.tick} aria-pressed={on} aria-label={label} title={label} disabled={disabled} onClick={onToggle} data-testid={testId}>
      {on ? <TbCheck aria-hidden size={14} strokeWidth={3} /> : null}
    </button>
  );
}

/** The tick's look inside a row that is itself the button ("Fix with AI ✓"). */
export function TickMark({ on }: { on: boolean }) {
  return (
    <span className={styles.tick} data-on={on || undefined} aria-hidden>
      {on ? <TbCheck size={14} strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * A piece of feedback: the passage it quotes, two lines of what was said and who said it, with
 * its tick (fix it with AI) when it can be chosen here. The card opens it whole.
 */
export function FeedbackCard({
  feedback,
  used,
  selected,
  where,
  tickLabel,
  onTick,
  onOpen,
  disabled,
}: {
  feedback: ViewFeedback;
  used: boolean;
  selected: boolean;
  /** What it's about when it quotes nothing here ("The whole lesson", "On another lesson"). */
  where: string;
  tickLabel: string;
  /** Without it the card shows no tick (it isn't decided here). */
  onTick?: () => void;
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <li className={styles.card} data-selected={selected || undefined} data-used={used || undefined} data-testid="feedback-card">
      {onTick ? <Tick on={used} label={tickLabel} onToggle={onTick} disabled={disabled} testId="card-tick" /> : null}
      <button type="button" className={styles.cardBody} onClick={onOpen} aria-current={selected ? 'true' : undefined}>
        <span className={styles.cardPassage}>{feedback.passage && !feedback.lessonHref ? `“${excerpt(feedback.passage, 80)}”` : where}</span>
        <span className={styles.cardText}>{feedback.body}</span>
        <span className={styles.who}>{feedback.who}</span>
      </button>
    </li>
  );
}

/**
 * One change, numbered as its pin in the lesson: its tick (keep it), its kind and section, and ›
 * to open it side by side. A change with nothing left to decide shows why instead of a tick.
 */
export function ChangeRow({
  number,
  label,
  state,
  keep,
  current,
  keepLabel,
  openLabel,
  onToggle,
  onOpen,
}: {
  number: number;
  label: string;
  /** Why there's nothing to decide (already in the lesson, gone from it), or that it conflicts. */
  state?: string | null;
  /** Kept or skipped; null: nothing to decide. */
  keep: boolean | null;
  /** The change being read in the lesson. */
  current: boolean;
  keepLabel: string;
  openLabel: string;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <li className={styles.changeRow} data-current={current || undefined} data-skipped={keep === false || undefined} data-testid="change-row">
      {keep !== null ? <Tick on={keep} label={keepLabel} onToggle={onToggle} testId="change-keep" /> : <span className={styles.tickSpace} aria-hidden />}
      <button type="button" className={styles.changeOpen} onClick={onOpen} aria-label={openLabel}>
        <span className={styles.changeText}>
          <span className={styles.changeLabel}>
            {number} · {label}
          </span>
          {state ? <span className={styles.who}>{state}</span> : null}
        </span>
        <TbChevronRight aria-hidden size={16} className={styles.chevron} />
      </button>
    </li>
  );
}

/** A row that opens other work (an earlier improvement, a revision, a finished one): its name, a line under it, its state, ›. */
export function NavRow({ title, sub, state, onOpen, testId }: { title: string; sub?: string; state?: ReactNode; onOpen: () => void; testId?: string }) {
  return (
    <li>
      <button type="button" className={styles.navRow} onClick={onOpen} data-testid={testId}>
        <span className={styles.navText}>
          <span className={styles.rowTitle}>{title}</span>
          {sub ? <span className={styles.rowState}>{sub}</span> : null}
          {state}
        </span>
        <TbChevronRight aria-hidden size={16} className={styles.chevron} />
      </button>
    </li>
  );
}
