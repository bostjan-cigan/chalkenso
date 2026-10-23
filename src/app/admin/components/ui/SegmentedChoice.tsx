'use client';

import styles from './SegmentedControl.module.css';

/**
 * Apple's segmented control (`SegmentedControl`) for a choice inside a form or a dialog (an amount,
 * say): radio buttons that change `value`, not links. Arrow keys move the choice, as in a radio group.
 */
export default function SegmentedChoice<T extends string | number>({
  options,
  value,
  onChange,
  label,
  testId,
}: {
  options: Array<{ value: T; label: string; testId?: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  testId?: string;
}) {
  const move = (step: number) => {
    const at = options.findIndex((option) => option.value === value);
    onChange(options[(at + step + options.length) % options.length].value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={styles.track}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1);
        else return;
        event.preventDefault();
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={option.value === value ? styles.segmentActive : styles.segment}
          onClick={() => onChange(option.value)}
          data-testid={option.testId}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
