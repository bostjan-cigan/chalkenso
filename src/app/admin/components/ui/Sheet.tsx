'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { TbChevronRight } from 'react-icons/tb';
import AccessLinkModalPortal from '@/app/admin/courses/groups/components/AccessLinkModalPortal';
import modalStyles from '@/app/admin/courses/groups/components/MemberLinkModal.module.css';
import AdminButton from './AdminButton';
import styles from './Sheet.module.css';

/**
 * Apple's sheet: what's used now and then (a preview link, a version's name, a new version) opens
 * from a row or a button instead of folding out on the page. A title, Done to close it, and the
 * content. Every section on a page stays open and looks the same; set-up lives here.
 */
export function Sheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const t = useTranslations('app.ui');
  const titleId = useId();
  return (
    <AccessLinkModalPortal open={open} onClose={onClose} titleId={titleId} wide>
      <div className={`${modalStyles.modalHeader} ${styles.header}`}>
        <h2 id={titleId} className={modalStyles.modalTitle}>
          {title}
        </h2>
        <button type="button" className={styles.done} onClick={onClose} data-autofocus>
          {t('done')}
        </button>
      </div>
      <div className={modalStyles.modalBody}>{children}</div>
    </AccessLinkModalPortal>
  );
}

/**
 * Rows that open sheets, as one inset grouped list: on its own (under a section), or with a short
 * heading above it and a line under it, the way a settings page groups them.
 */
export function SheetRows({ title, footer, children, testId }: { title?: string; footer?: ReactNode; children: ReactNode; testId?: string }) {
  const list = (
    <ul className={styles.rows} data-testid={testId}>
      {children}
    </ul>
  );
  if (!title && !footer) {
    return list;
  }
  return (
    <section className={styles.group}>
      {title ? <h2 className={styles.groupTitle}>{title}</h2> : null}
      {list}
      {footer ? <p className={styles.groupFooter}>{footer}</p> : null}
    </section>
  );
}

/** A row that holds its control (a switch) instead of opening a sheet. */
export function SheetControlRow({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <li>
      <div className={`${styles.row} ${styles.controlRow}`} data-testid={testId}>
        <span className={styles.label}>{label}</span>
        {children}
      </div>
    </li>
  );
}

/** A row that only shows its value (set somewhere else, as a group's own copy of the lessons): nothing to press. */
export function SheetInfoRow({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <li>
      <div className={`${styles.row} ${styles.controlRow}`} data-testid={testId}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
      </div>
    </li>
  );
}

/**
 * A row that does something: its words in blue (Give this group its own copy), or in quiet red for
 * what can't be undone (Delete group), which asks first in the caller's dialog. No ›.
 */
export function SheetActionRow({
  label,
  onClick,
  destructive = false,
  disabled,
  testId,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <li>
      <button
        type="button"
        className={`${styles.row} ${destructive ? styles.destructiveRow : styles.actionRow}`}
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
      >
        <span className={styles.label}>{label}</span>
      </button>
    </li>
  );
}

/** A row with its value and › that opens a dialog of its own (two-factor's steps) instead of a sheet. */
export function SheetOpenRow({ label, value, onClick, disabled, testId }: { label: string; value?: ReactNode; onClick: () => void; disabled?: boolean; testId?: string }) {
  return (
    <li>
      <button type="button" className={styles.row} aria-haspopup="dialog" onClick={onClick} disabled={disabled} data-testid={testId}>
        <span className={styles.label}>{label}</span>
        {value != null ? <span className={styles.value}>{value}</span> : null}
        <TbChevronRight aria-hidden size={18} className={styles.chevron} />
      </button>
    </li>
  );
}

/** A row with its name, a short value (the version's name, how many links) and ›; opens its sheet. */
export function SheetRow({ label, value, title, children, testId }: { label: string; value?: ReactNode; title?: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" className={styles.row} aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid={testId}>
        <span className={styles.label}>{label}</span>
        {value != null ? <span className={styles.value}>{value}</span> : null}
        <TbChevronRight aria-hidden size={18} className={styles.chevron} />
      </button>
      <Sheet title={title ?? label} open={open} onClose={() => setOpen(false)}>
        {children}
      </Sheet>
    </li>
  );
}

/** A section's own action (New version) that opens a sheet with its form. */
export function SheetButton({ label, title, children, testId }: { label: ReactNode; title: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AdminButton type="button" size="compact" aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid={testId}>
        {label}
      </AdminButton>
      <Sheet title={title} open={open} onClose={() => setOpen(false)}>
        {children}
      </Sheet>
    </>
  );
}
