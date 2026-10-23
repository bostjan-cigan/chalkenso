import Link from 'next/link';
import { TbCheck } from 'react-icons/tb';
import type { RevisionPathView } from './path-data';
import styles from './revision-path.module.css';

/**
 * Where an improvement is, the same on its page, on the lesson it changes and in the Improvements
 * list: Feedback → Plan → Proposed changes → Published, the current step marked, and the one next
 * action; for more than one lesson (or a group's copy and the main course), each one and where it
 * is. Words and links come with the path (`loadRevisionPath`); this only draws them.
 */
export default function RevisionPathBar({
  path,
  label,
  doneLabel,
  compact = false,
  hideNext = false,
  targetsLabel,
}: {
  path: RevisionPathView;
  /** What the bar is, for screen readers ("Where this improvement is"). */
  label: string;
  /** Shown instead of a next action once everything is done. */
  doneLabel: string;
  compact?: boolean;
  /** On the lesson it's about: the next step is right there (Revise, Save), so no link to it. */
  hideNext?: boolean;
  /** What the list of lessons is, for screen readers ("The lessons it changes"). */
  targetsLabel?: string;
}) {
  return (
    <div className={compact ? `${styles.path} ${styles.compact}` : styles.path} data-testid="revision-path">
      <ol className={styles.steps} aria-label={label}>
        {path.steps.map(({ step, state, label: stepLabel, detail }) => (
          <li key={step} className={styles.step} data-state={state} data-step={step} aria-current={state === 'current' ? 'step' : undefined}>
            <span className={styles.mark} aria-hidden>
              {state === 'done' ? <TbCheck size={12} /> : null}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepLabel}>{stepLabel}</span>
              {detail && !compact ? <span className={styles.stepDetail}>{detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {hideNext ? null : path.next ? (
        path.next.href ? (
          <Link href={path.next.href} className={styles.next} data-testid="revision-path-next">
            {path.next.label}
          </Link>
        ) : (
          <span className={styles.nextBusy} data-testid="revision-path-next">
            {path.next.label}
          </span>
        )
      ) : path.finished ? (
        <span className={styles.finished}>{doneLabel}</span>
      ) : null}
      {/* More than one lesson (or a group's copy and the main course): where each one is. */}
      {!compact && path.targets.length > 1 ? (
        <ul className={styles.targets} aria-label={targetsLabel} data-testid="revision-path-targets">
          {path.targets.map((target) => (
            <li key={target.lessonId} className={styles.target} data-done={target.done || undefined}>
              <span className={styles.mark} aria-hidden>
                {target.done ? <TbCheck size={12} /> : null}
              </span>
              <span className={styles.targetText}>
                {target.href ? (
                  <Link href={target.href} className={styles.targetLabel}>
                    {target.label}
                  </Link>
                ) : (
                  <span className={styles.targetLabel}>{target.label}</span>
                )}{' '}
                <span className={styles.targetState}>{target.state}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
