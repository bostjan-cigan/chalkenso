'use client';

import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './MemberLinkModal.module.css';

/**
 * Inline layout so the overlay stays viewport-fixed even if CSS module classes fail to attach.
 * Without this, a portal child of `body` can flow below the app (off-screen) while scroll lock runs.
 */
const MODAL_ROOT_LAYOUT: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 100_000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
};

interface AccessLinkModalPortalProps {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  titleId?: string;
  /** Optional id for `aria-describedby` on the dialog (e.g. description paragraph). */
  descriptionId?: string;
  /** A sheet with a form or a list in it: wider and taller than an alert. */
  wide?: boolean;
  /** A sheet that puts two versions side by side: nearly the whole window. */
  large?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Full-viewport backdrop on `document.body` with a centered dialog. Clicking the dimmed backdrop
 * (not the panel), pressing Escape, or using Cancel / dismiss in content closes via onClose.
 *
 * Focus works as in a system alert: it moves into the dialog as it opens (to the element marked
 * `data-autofocus`, or one with `autoFocus`, else the dialog itself), Tab and Shift+Tab stay inside,
 * and closing returns it to where it was.
 */
export default function AccessLinkModalPortal({
  children,
  onClose,
  open,
  titleId,
  descriptionId,
  wide = false,
  large = false,
}: AccessLinkModalPortalProps) {
  const allowBackdropCloseRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) {
        return;
      }
      (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (before?.isConnected) {
        before.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      allowBackdropCloseRef.current = false;
      return;
    }
    // Same click that opened the modal can finish on the new overlay; ignore backdrop closes briefly.
    allowBackdropCloseRef.current = false;
    const t = window.setTimeout(() => {
      allowBackdropCloseRef.current = true;
    }, 200);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      // Escape with a dropdown open closes the dropdown only; the next Escape closes the dialog. A
      // dialog opened from a sheet (a new link) closes alone: only the one on top answers.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"]') && dialogs[dialogs.length - 1] === dialogRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  /** Tab past the last control comes back to the first, and Shift+Tab the other way. */
  const keepFocusInside = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }
    const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.offsetParent !== null || element === document.activeElement
    );
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={styles.modalRoot}
      style={MODAL_ROOT_LAYOUT}
      role="presentation"
      onClick={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        if (!allowBackdropCloseRef.current) {
          return;
        }
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={large ? `${styles.modalDialog} ${styles.modalDialogLarge}` : wide ? `${styles.modalDialog} ${styles.modalDialogWide}` : styles.modalDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(descriptionId ? { 'aria-describedby': descriptionId } : {})}
        tabIndex={-1}
        style={{ outline: 'none' }}
        onKeyDown={keepFocusInside}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
