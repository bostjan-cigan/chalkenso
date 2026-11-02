'use client';

import Link from 'next/link';
import { TbCheck } from 'react-icons/tb';
import styles from './improvements-view.module.css';

export type PathStop = { name: string; state: string; href?: string | null; done?: boolean; here?: boolean };

/**
 * A group's improvement that goes on to the main course, the same on both lessons: the group's copy,
 * then the main course, where each stands, the one here marked and the other a link.
 */
export default function ImprovementPath({ stops, label }: { stops: [PathStop, PathStop]; label: string }) {
  const stop = (one: PathStop) => {
    const content = (
      <>
        <span className={styles.pathMark}>{one.done ? <TbCheck aria-hidden size={14} strokeWidth={3} className={styles.pathDone} /> : <span className={styles.pathDot} data-here={one.here || undefined} />}</span>
        <span className={styles.pathName}>{one.name}</span>
        <span className={styles.pathState}>{one.state}</span>
      </>
    );
    return one.href && !one.here ? (
      <Link href={one.href} className={styles.pathStop} data-testid="path-stop">
        {content}
      </Link>
    ) : (
      <span className={styles.pathStop} data-here={one.here || undefined} aria-current={one.here ? 'step' : undefined} data-testid="path-stop">
        {content}
      </span>
    );
  };
  return (
    <ol className={styles.path} aria-label={label} data-testid="improvement-path">
      <li>{stop(stops[0])}</li>
      <li>{stop(stops[1])}</li>
    </ol>
  );
}
