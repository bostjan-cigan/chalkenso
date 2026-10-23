'use client';

import styles from './Switch.module.css';

/**
 * The app's on/off switch (outside Settings, which has Apple's larger one): the accent colour when
 * on. On touch screens its hit area grows to 44pt without the switch itself growing.
 */
export default function Switch({
  on,
  label,
  onChange,
  disabled,
  testId,
}: {
  on: boolean;
  /** What it switches, for screen readers (the row says it on screen). */
  label: string;
  onChange: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={styles.switch}
      data-testid={testId}
    />
  );
}
