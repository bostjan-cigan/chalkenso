'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { TbInfoCircle } from 'react-icons/tb';
import styles from './settings-ui.module.css';

/**
 * ⓘ: what a setting does, on demand instead of in a paragraph. Opens on hover, focus or a tap, and
 * closes on Escape, a tap elsewhere, or leaving it. Text only: actions belong in rows.
 */
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={styles.info}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        type="button"
        className={styles.infoButton}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          setPinned(!pinned);
          setOpen(!pinned);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned) setOpen(false);
        }}
      >
        <TbInfoCircle aria-hidden size={17} />
      </button>
      {open ? (
        <span id={id} role="tooltip" className={styles.infoPop}>
          {children}
        </span>
      ) : null}
    </span>
  );
}
