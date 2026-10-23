'use client';

import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TbDots } from 'react-icons/tb';
import styles from '../../admin.module.css';

export type AdminMenuItem =
  | { label: string; href: string; icon?: ReactNode; danger?: boolean; newTab?: boolean }
  | { label: string; onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean };

/**
 * The "⋯" menu: the rare and the destructive actions of a row or a page (delete, close, settings),
 * out of the way of the common ones. Items are links or buttons; a destructive one still asks first
 * (the caller's dialog).
 */
export default function AdminMenu({
  items,
  label: ownLabel,
  trigger,
}: {
  items: AdminMenuItem[];
  /** The trigger's accessible name ("More actions" by default). */
  label?: string;
  /** A visible trigger instead of the dots (e.g. a title with a chevron). */
  trigger?: ReactNode;
}) {
  const t = useTranslations('app.ui');
  const label = ownLabel ?? t('moreActions');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    const button = triggerRef.current;
    const menu = menuRef.current;
    if (!open || !button || !menu) return;
    return autoUpdate(button, menu, () => {
      void computePosition(button, menu, {
        placement: 'bottom-end',
        strategy: 'fixed',
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(menu.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' });
      });
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', onDown);
    };
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close(false);
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={trigger ? styles.menuTriggerText : styles.menuTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={trigger ? undefined : label}
        title={trigger ? undefined : label}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <TbDots size={18} aria-hidden />}
      </button>
      {open
        ? createPortal(
            <div ref={menuRef} role="menu" aria-label={label} className={styles.orgMenu} style={{ minWidth: 200, visibility: 'hidden' }} onKeyDown={onMenuKey}>
              {items.map((item, index) => {
                const className = item.danger ? `${styles.orgMenuItem} ${styles.menuItemDanger}` : styles.orgMenuItem;
                if ('href' in item) {
                  return (
                    <Link
                      key={`${index}-${item.label}`}
                      href={item.href}
                      role="menuitem"
                      className={className}
                      target={item.newTab ? '_blank' : undefined}
                      onClick={() => close(false)}
                    >
                      {item.icon}
                      <span className={styles.orgMenuItemName}>{item.label}</span>
                    </Link>
                  );
                }
                return (
                  <button
                    key={`${index}-${item.label}`}
                    type="button"
                    role="menuitem"
                    className={className}
                    disabled={item.disabled}
                    onClick={() => {
                      close(false);
                      item.onSelect();
                    }}
                  >
                    {item.icon}
                    <span className={styles.orgMenuItemName}>{item.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
