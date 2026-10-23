'use client';

import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FiCheck, FiChevronDown } from 'react-icons/fi';
import { useTranslations } from 'next-intl';
import { cn } from '@/utils/cn';
import adminStyles from '../../admin.module.css';
import styles from './AdminSearchableSelectField.module.css';

export type AdminSearchableMultiSelectOption = {
  label: string;
  value: string;
};

type AdminSearchableMultiSelectFieldProps = {
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  hint?: ReactNode;
  id: string;
  label: string;
  name: string;
  onChange?: (nextValues: string[]) => void;
  options: AdminSearchableMultiSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  values: string[];
};

function normalizeQuery(raw: string) {
  return raw.trim().toLowerCase();
}

export default function AdminSearchableMultiSelectField({
  className,
  disabled = false,
  fullWidth = false,
  hint,
  id,
  label,
  name,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  values,
}: AdminSearchableMultiSelectFieldProps) {
  const t = useTranslations('common.select');
  const listId = useId();
  const searchId = `${id}-search`;
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedLabels = useMemo(
    () =>
      values
        .map((value) => options.find((option) => option.value === value)?.label)
        .filter((label): label is string => Boolean(label)),
    [options, values]
  );

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    if (!q) {
      return options;
    }
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightIndex(0);
      const t = window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useEffect(() => {
    setHighlightIndex((index) => {
      if (filtered.length === 0) {
        return 0;
      }
      return Math.min(index, filtered.length - 1);
    });
  }, [filtered.length]);

  const displayText =
    selectedLabels.length > 0 ? selectedLabels.join(', ') : (placeholder ?? t('placeholder'));

  function toggleValue(nextValue: string) {
    const nextValues = selectedSet.has(nextValue)
      ? values.filter((value) => value !== nextValue)
      : [...values, nextValue];
    onChange?.(nextValues);
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (disabled) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen((value) => !value);
    }
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) =>
        Math.min(index + 1, Math.max(filtered.length - 1, 0))
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter' && filtered.length > 0) {
      event.preventDefault();
      const highlighted = filtered[highlightIndex];
      if (highlighted) {
        toggleValue(highlighted.value);
      }
    }
  }

  return (
    <label
      className={cn(adminStyles.field, fullWidth && adminStyles.fieldFullWidth, className)}
      htmlFor={id}
    >
      <span className={adminStyles.inputLabel}>{label}</span>

      <div ref={rootRef} className={styles.root}>
        {values.map((value) => (
          <input key={value} type="hidden" name={name} value={value} />
        ))}
        <button
          id={id}
          type="button"
          className={cn(styles.trigger, open && styles.triggerOpen)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          onClick={() => !disabled && setOpen((value) => !value)}
          onKeyDown={onTriggerKeyDown}
        >
          <span
            className={cn(
              styles.triggerText,
              values.length === 0 && styles.placeholder
            )}
          >
            {displayText}
          </span>
          <FiChevronDown
            className={cn(styles.chevron, open && styles.chevronOpen)}
            size={18}
            aria-hidden
          />
        </button>

        {open ? (
          <div className={styles.dropdown} role="presentation">
            <input
              ref={searchInputRef}
              id={searchId}
              type="search"
              className={styles.search}
              placeholder={searchPlaceholder ?? t('search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              autoComplete="off"
              aria-autocomplete="list"
              aria-controls={listId}
            />
            <ul id={listId} className={styles.list} role="listbox" aria-multiselectable="true">
              {filtered.length === 0 ? (
                <li className={styles.empty} role="presentation">
                  {t('noMatches')}
                </li>
              ) : (
                filtered.map((option, index) => {
                  const selected = selectedSet.has(option.value);
                  return (
                    <li key={`${index}-${option.value}`} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          styles.option,
                          styles.optionWithCheck,
                          index === highlightIndex && styles.optionHighlight,
                          selected && styles.optionSelected
                        )}
                        onMouseEnter={() => setHighlightIndex(index)}
                        onClick={() => toggleValue(option.value)}
                      >
                        <span className={styles.optionLabel}>{option.label}</span>
                        <span className={styles.optionCheck} aria-hidden>
                          {selected ? <FiCheck size={14} /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ) : null}
      </div>

      {hint ? <span className={adminStyles.fieldHint}>{hint}</span> : null}
    </label>
  );
}
