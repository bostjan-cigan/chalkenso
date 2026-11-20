'use client';

import type { CSSProperties } from 'react';
import { TbFileTypePdf } from 'react-icons/tb';
import styles from '../../access.module.css';

/** The export button: its label, or while the PDF is made, how far it is (filling up behind the words). */
export default function PdfExportButton({
  label,
  working,
  percent,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  /** What it says while this export runs, e.g. "Preparing PDF…". */
  working: string;
  /** How far this button's export is; null when it isn't running. */
  percent: number | null;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className={styles.exportButton}
      style={percent === null ? undefined : ({ '--export-progress': `${percent}%` } as CSSProperties)}
      disabled={disabled}
      aria-busy={percent !== null}
      onClick={onClick}
      data-testid={testId}
    >
      <TbFileTypePdf aria-hidden size={17} />
      {percent === null ? label : `${working} ${percent}%`}
    </button>
  );
}
