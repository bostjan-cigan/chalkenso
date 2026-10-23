'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { TbChevronRight } from 'react-icons/tb';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';
import AccessLinkModalPortal from '@/app/admin/courses/groups/components/AccessLinkModalPortal';
import modalStyles from '@/app/admin/courses/groups/components/MemberLinkModal.module.css';
import AdminButton from './AdminButton';
import styles from './Sheet.module.css';

/** A sheet's form: its button (Save, Send, Create invite link) is the header's, on the right. */
export type SheetForm = {
  /** The `<form>`'s id: the header's button submits it. */
  id: string;
  /** The button's words, and its words while it works ("Saving…"). */
  label: string;
  pending?: boolean;
  disabled?: boolean;
  testId?: string;
};

const SheetContext = createContext<{ setForm: (form: SheetForm | null) => void; close: () => void } | null>(null);

/**
 * For a form shown in a sheet (`SheetRow`, `SheetButton`): its button goes in the sheet's header, so
 * the form leaves its own out (`inSheet`) and closes the sheet once it has saved (`close`). Null when
 * there is nothing left to send (an invite link made): the header says Done again. Outside a sheet
 * it does nothing, and the form keeps its own button.
 */
export function useSheetForm(form: Omit<SheetForm, 'id'> | null) {
  const sheet = useContext(SheetContext);
  const id = useId();
  const setForm = sheet?.setForm;
  const shown = form !== null;
  const label = form?.label ?? '';
  const pending = form?.pending ?? false;
  const disabled = form?.disabled ?? false;
  const testId = form?.testId;
  useEffect(() => {
    setForm?.(shown ? { id, label, pending, disabled, testId } : null);
  }, [setForm, shown, id, label, pending, disabled, testId]);
  useEffect(() => () => setForm?.(null), [setForm]);
  return { formId: id, inSheet: sheet !== null, close: sheet?.close ?? (() => {}) };
}

/** What the sheet's fields hold: changed since they were first touched means there is something to lose. */
function fieldValues(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('input, textarea, select, [aria-checked]'), (element) => {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') return String(element.checked);
      if (element.type === 'file') return Array.from(element.files ?? [], (file) => `${file.name}:${file.size}`).join();
      return element.value;
    }
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
    return element.getAttribute('aria-checked') ?? '';
  }).join('\u0000');
}

/**
 * Apple's sheet: what's used now and then (a preview link, a version's name, a new version) opens
 * from a row or a button instead of folding out on the page. Every section on a page stays open and
 * looks the same; set-up lives here.
 *
 * A sheet that edits something (`form`, or a form inside using `useSheetForm`) has Cancel on the
 * left and its button on the right, which saves and closes. Cancel, Escape and a click outside close
 * it, asking first when a field has changed. Any other sheet has Done alone, which closes it: what's
 * in it saves as it goes, or only shows.
 */
export function Sheet({ title, open, onClose, form: ownForm, children }: { title: string; open: boolean; onClose: () => void; form?: SheetForm; children: ReactNode }) {
  const t = useTranslations('app.ui');
  const titleId = useId();
  const [innerForm, setInnerForm] = useState<SheetForm | null>(null);
  const form = ownForm ?? innerForm;
  const [asking, setAsking] = useState(false);
  const body = useRef<HTMLDivElement | null>(null);
  const before = useRef<string | null>(null);
  // Mounted on every open: the fields start over.
  const bodyRef = useCallback((node: HTMLDivElement | null) => {
    body.current = node;
    before.current = null;
    if (!node) setAsking(false);
  }, []);
  const remember = () => {
    if (before.current === null && body.current) before.current = fieldValues(body.current);
  };
  const cancel = () => {
    if (form && before.current !== null && body.current && fieldValues(body.current) !== before.current) setAsking(true);
    else onClose();
  };
  const context = useMemo(() => ({ setForm: setInnerForm, close: onClose }), [onClose]);
  return (
    <AccessLinkModalPortal open={open} onClose={cancel} titleId={titleId} wide>
      {form ? (
        <div className={`${modalStyles.modalHeader} ${styles.header} ${styles.formHeader}`}>
          <button type="button" className={styles.cancel} onClick={cancel}>
            {t('cancel')}
          </button>
          <h2 id={titleId} className={`${modalStyles.modalTitle} ${styles.formTitle}`}>
            {title}
          </h2>
          <button type="submit" form={form.id} className={styles.done} disabled={form.pending || form.disabled} data-testid={form.testId ?? 'sheet-save'}>
            {form.label}
          </button>
        </div>
      ) : (
        <div className={`${modalStyles.modalHeader} ${styles.header}`}>
          <h2 id={titleId} className={modalStyles.modalTitle}>
            {title}
          </h2>
          <button type="button" className={styles.done} onClick={onClose} data-autofocus>
            {t('done')}
          </button>
        </div>
      )}
      {/* The fields as they were when first touched: a keypress or a click comes before the change. */}
      <div ref={bodyRef} className={modalStyles.modalBody} onFocusCapture={remember} onPointerDownCapture={remember} onKeyDownCapture={remember}>
        <SheetContext.Provider value={context}>{children}</SheetContext.Provider>
      </div>
      <ConfirmDialog
        open={asking}
        tone="danger"
        title={t('discard.title')}
        description={t('discard.text')}
        confirmLabel={t('discard.confirm')}
        cancelLabel={t('discard.keep')}
        onConfirm={() => {
          setAsking(false);
          onClose();
        }}
        onClose={() => setAsking(false)}
      />
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
