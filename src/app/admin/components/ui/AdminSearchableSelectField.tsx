'use client';

import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import {
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { FiChevronDown } from 'react-icons/fi';
import { useTranslations } from 'next-intl';
import { cn } from '@/utils/cn';
import adminStyles from '../../admin.module.css';
import styles from './AdminSearchableSelectField.module.css';

export type AdminSearchableSelectOption = {
  label: string;
  value: string;
  /** A second, quieter line under the label (e.g. what a role may do). */
  hint?: string;
  /** Shown before the label in the list (e.g. a flag). */
  icon?: ReactNode;
};

type AdminSearchableSelectFieldProps = {
  className?: string;
  /** On the outer label, e.g. its size in a row of filters. */
  style?: CSSProperties;
  disabled?: boolean;
  fullWidth?: boolean;
  hint?: ReactNode;
  id: string;
  label: string;
  /** Without a name nothing is submitted: for controls that act on change. */
  name?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  /** The picked value, without the event wrapper. */
  onValueChange?: (value: string) => void;
  options: AdminSearchableSelectOption[];
  /** Shown when `value` is empty or has no matching option label */
  placeholder?: string;
  required?: boolean;
  searchPlaceholder?: string;
  value: string;
  /** Show the search box (on by default; short lists read better without it). */
  searchable?: boolean;
  /** Keep the label for screen readers only, when the surrounding text already says it. */
  hideLabel?: boolean;
  /** Replaces the admin label style, e.g. on the public site. */
  labelClassName?: string;
  /** A smaller trigger, for inline use in lists. */
  compact?: boolean;
  /**
   * `field` fills its column; `toolbar` is a small inline trigger as wide as its value (an
   * editor's toolbar, a time picker).
   */
  variant?: 'field' | 'toolbar';
  /** Replaces the trigger's own look (e.g. the sidebar's organisation row). */
  triggerClassName?: string;
  /** Shown before the value inside the trigger. */
  leading?: ReactNode;
  /** What the trigger shows instead of the picked option's label (e.g. a short code). */
  valueLabel?: ReactNode;
  /** Replaces the chevron. */
  chevron?: ReactNode;
};

function normalizeQuery(raw: string) {
  return raw.trim().toLowerCase();
}

/**
 * The product's dropdown (never a native `<select>`). The list opens in a portal positioned
 * against the trigger, so scrolling sidebars, toolbars and popovers don't clip it; inside a
 * `<dialog>` it stays in the dialog's top layer. Submits through a hidden input when it has a name.
 */
export default function AdminSearchableSelectField({
  className,
  style,
  disabled = false,
  fullWidth = false,
  hint,
  id,
  label,
  name,
  onChange,
  onValueChange,
  options,
  placeholder,
  required = false,
  searchPlaceholder,
  value,
  searchable = true,
  hideLabel = false,
  labelClassName,
  compact = false,
  variant = 'field',
  triggerClassName,
  leading,
  valueLabel,
  chevron,
}: AdminSearchableSelectFieldProps) {
  const t = useTranslations('common.select');
  const listId = useId();
  const searchId = `${id}-search`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    if (!q) {
      return options;
    }
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, query]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      const selected = Math.max(
        options.findIndex((opt) => opt.value === value),
        0
      );
      setHighlightIndex(selected);
      const t = window.requestAnimationFrame(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        } else {
          popupRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"], [role="option"]')?.focus();
        }
      });
      return () => window.cancelAnimationFrame(t);
    }
    // Only when it opens: the highlight then follows the keyboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Where the list goes: the open dialog's top layer, or the page.
  useLayoutEffect(() => {
    if (open) {
      setPortalTarget(triggerRef.current?.closest('dialog') ?? document.body);
    }
  }, [open]);

  // Keep the list against the trigger (below it, or above when there's no room) while it is open.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!open || !portalTarget || !trigger || !popup) {
      return;
    }
    return autoUpdate(trigger, popup, () => {
      void computePosition(trigger, popup, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [
          offset(4),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ rects, availableHeight, elements }) {
              Object.assign(elements.floating.style, {
                minWidth: `${rects.reference.width}px`,
                maxHeight: `${Math.max(160, Math.min(availableHeight, 360))}px`,
              });
            },
          }),
        ],
      }).then(({ x, y }) => {
        Object.assign(popup.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' });
      });
    });
  }, [open, portalTarget]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectedOption = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const selectedLabel = selectedOption?.label ?? '';
  const displayText = (selectedOption ? valueLabel : null) ?? (selectedLabel || (placeholder ?? t('placeholder')));

  const selectValue = useCallback(
    (nextValue: string) => {
      // Close (and refocus the trigger) first, so a handler can move focus on (e.g. to an editor).
      close(true);
      onChange?.({
        target: { name: name ?? '', value: nextValue },
        currentTarget: { name: name ?? '', value: nextValue },
      } as ChangeEvent<HTMLSelectElement>);
      onValueChange?.(nextValue);
    },
    [close, name, onChange, onValueChange]
  );

  /** Focus leaving both the trigger and the list closes it (Tab away, a click elsewhere). */
  const onBlurWithin = useCallback((event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && (triggerRef.current?.contains(next) || popupRef.current?.contains(next))) {
      return;
    }
    if (next) {
      setOpen(false);
    }
  }, []);

  const onKeyDownTrigger = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) {
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
        e.preventDefault();
        setOpen(true);
      }
    },
    [disabled, open]
  );

  const onKeyDownSearch = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const last = Math.max(filtered.length - 1, 0);
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key === 'Tab') {
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, last));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if ((e.key === 'Home' || e.key === 'End') && !query) {
        e.preventDefault();
        setHighlightIndex(e.key === 'Home' ? 0 : last);
        return;
      }
      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        const opt = filtered[highlightIndex];
        if (opt) {
          selectValue(opt.value);
        }
      }
    },
    [close, filtered, highlightIndex, query, selectValue]
  );

  /** Without a search box, the options themselves take the arrow keys, Home/End and Escape. */
  const onKeyDownOption = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (searchable) return;
      const buttons = popupRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
      if (!buttons?.length) return;
      const move = (next: number) => {
        event.preventDefault();
        const clamped = Math.min(Math.max(next, 0), buttons.length - 1);
        setHighlightIndex(clamped);
        buttons[clamped]?.focus();
      };
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        setOpen(false);
      } else if (event.key === 'ArrowDown') {
        move(index + 1);
      } else if (event.key === 'ArrowUp') {
        move(index - 1);
      } else if (event.key === 'Home') {
        move(0);
      } else if (event.key === 'End') {
        move(buttons.length - 1);
      } else if (event.key.length === 1 && /\S/.test(event.key)) {
        // Type-ahead: the next option starting with that letter.
        const letter = event.key.toLowerCase();
        const order = [...options.slice(index + 1), ...options.slice(0, index + 1)];
        const match = order.find((opt) => opt.label.toLowerCase().startsWith(letter));
        if (match) move(options.indexOf(match));
      }
    },
    [close, options, searchable]
  );

  useEffect(() => {
    setHighlightIndex((i) => {
      if (filtered.length === 0) {
        return 0;
      }
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length]);

  const toolbar = variant === 'toolbar';
  const popup =
    open && portalTarget
      ? createPortal(
          <div
            ref={popupRef}
            className={cn(styles.dropdown, toolbar && styles.dropdownToolbar)}
            role="presentation"
            style={{ visibility: 'hidden' }}
            // Keep focus where it is while clicking an option (Safari doesn't focus buttons).
            onMouseDown={(event) => {
              if (event.target !== searchInputRef.current) event.preventDefault();
            }}
            onBlur={onBlurWithin}
          >
            {searchable ? (
              <input
                ref={searchInputRef}
                id={searchId}
                type="search"
                className={styles.search}
                placeholder={searchPlaceholder ?? t('search')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightIndex(0);
                }}
                onKeyDown={onKeyDownSearch}
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls={listId}
                aria-label={t('searchLabel', { label })}
              />
            ) : null}
            <ul id={listId} className={styles.list} role="listbox" aria-label={label}>
              {filtered.length === 0 ? (
                <li className={styles.empty} role="presentation">
                  {t('noMatches')}
                </li>
              ) : (
                filtered.map((opt, index) => (
                  <li key={`${index}-${opt.value}`} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={opt.value === value}
                      className={cn(
                        styles.option,
                        opt.icon ? styles.optionWithIcon : null,
                        index === highlightIndex && styles.optionHighlight,
                        opt.value === value && styles.optionSelected
                      )}
                      ref={(node) => {
                        if (node && index === highlightIndex && searchable) node.scrollIntoView({ block: 'nearest' });
                      }}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => selectValue(opt.value)}
                      onKeyDown={(event) => onKeyDownOption(event, index)}
                    >
                      {opt.icon}
                      <span className={styles.optionLabel}>{opt.label}</span>
                      {opt.hint ? <span className={styles.optionHint}>{opt.hint}</span> : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          portalTarget
        )
      : null;

  return (
    <label
      className={cn(toolbar ? styles.toolbarField : adminStyles.field, fullWidth && adminStyles.fieldFullWidth, className)}
      htmlFor={id}
      style={style}
    >
      <span className={hideLabel ? 'sr-only' : labelClassName ?? adminStyles.inputLabel}>{label}</span>

      <div className={cn(styles.root, toolbar && styles.rootInline)}>
        {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className={
            triggerClassName ??
            cn(styles.trigger, compact && styles.triggerCompact, toolbar && styles.triggerToolbar, open && styles.triggerOpen)
          }
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={onKeyDownTrigger}
          onBlur={onBlurWithin}
        >
          {leading}
          <span className={cn(styles.triggerText, !selectedLabel && value === '' && styles.placeholder)}>{displayText}</span>
          {chevron ?? <FiChevronDown className={cn(styles.chevron, open && styles.chevronOpen)} size={toolbar ? 15 : 18} aria-hidden />}
        </button>
        {popup}
      </div>

      {hint ? <span className={adminStyles.fieldHint}>{hint}</span> : null}
    </label>
  );
}
