import Link from 'next/link';
import styles from './SegmentedControl.module.css';

export type Segment = {
  key: string;
  label: string;
  count?: number | null;
  href: string;
  active: boolean;
  testId?: string;
};

/**
 * Apple's segmented control, as links: switches between the parts of one view (New, Improvements,
 * Done), not a filter. One track, equal segments, the chosen one raised. Full width on a phone.
 */
export default function SegmentedControl({ segments, label, testId }: { segments: Segment[]; label: string; testId?: string }) {
  return (
    <nav className={styles.track} aria-label={label} data-testid={testId}>
      {segments.map((segment) => (
        <Link
          key={segment.key}
          href={segment.href}
          className={segment.active ? styles.segmentActive : styles.segment}
          aria-current={segment.active ? 'page' : undefined}
          data-segment={segment.key}
          data-testid={segment.testId}
        >
          {segment.label}
          {segment.count != null ? (
            <>
              {' '}
              <span className={styles.count}>{segment.count}</span>
            </>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
