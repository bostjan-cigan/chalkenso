import type { ReactNode } from 'react';
import styles from './settings-ui.module.css';

/**
 * Settings as inset grouped lists, like Apple's: a short heading (with ⓘ for the explanation),
 * rows with their name on the left and value or control on the right, and at most a line under the
 * group. No paragraphs: what something does goes behind ⓘ (`InfoTip`).
 */
export function SettingsGroup({
  title,
  info,
  footer,
  children,
  testId,
}: {
  title?: string;
  /** ⓘ next to the heading. */
  info?: ReactNode;
  /** One short line under the group. */
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={styles.group} data-testid={testId}>
      {title || info ? (
        <h2 className={styles.groupHead}>
          {title}
          {info}
        </h2>
      ) : null}
      <div className={styles.groupBody}>{children}</div>
      {footer ? <p className={styles.groupFoot}>{footer}</p> : null}
    </section>
  );
}

/** One row: its name (and a short detail under it) on the left, its value or controls on the right. */
export function SettingsRow({
  label,
  detail,
  info,
  children,
  testId,
}: {
  label: ReactNode;
  detail?: ReactNode;
  info?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={styles.row} data-testid={testId}>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>
          {label}
          {info}
        </span>
        {detail ? <span className={styles.rowDetail}>{detail}</span> : null}
      </span>
      {children ? <span className={styles.rowEnd}>{children}</span> : null}
    </div>
  );
}

/** A full-width part of a group that isn't a row: a usage bar, a form. */
export function SettingsBlock({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={styles.block} data-testid={testId}>
      {children}
    </div>
  );
}

/** "Active", "Not active": a word with a dot (green when on, amber for a warning). */
export function SettingsStatus({ on, warning = false, children }: { on: boolean; warning?: boolean; children: ReactNode }) {
  return (
    <span className={styles.status} data-on={on} data-tone={warning ? 'warning' : undefined}>
      {children}
    </span>
  );
}

/**
 * How much of an allowance is used: the percentage, the money ("$12.40 of $80.00"), a bar that
 * turns amber from 80% and red when it's all used, and a line under it (`detail`).
 */
export function UsageBar({ label, percent, money, detail }: { label: string; percent: number; money: string; detail?: string }) {
  const shown = Math.max(0, Math.min(100, Math.round(percent)));
  const level = shown >= 100 ? 'full' : shown >= 80 ? 'high' : 'normal';
  return (
    <div className={styles.usage}>
      <div className={styles.usageTop}>
        <span className={styles.usagePercent}>{shown}%</span>
        <span className={styles.usageMoney}>{money}</span>
      </div>
      <div className={styles.bar} data-level={level} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
        <div className={styles.barFill} style={{ width: `${shown}%` }} />
      </div>
      {detail ? <span className={styles.usageDetail}>{detail}</span> : null}
    </div>
  );
}

export { styles as settingsStyles };
