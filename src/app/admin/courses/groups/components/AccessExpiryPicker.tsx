'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { formatDateTimeLocalValue, parseDateTimeLocalValue } from '@/lib/access-links';
import AdminSearchableSelectField from '@/app/admin/components/ui/AdminSearchableSelectField';
import styles from './AccessExpiryPicker.module.css';

/** The days of the week from Sunday (as `Date.getDay()` counts them): their keys in `groups.expiryPicker.weekdays`. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** The first column of the month: Sunday in English, Monday in Slovenian (as Slovenian calendars have it). */
const WEEK_STARTS: Record<Locale, number> = { en: 0, sl: 1 };

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function parseParts(value: string) {
  const d = parseDateTimeLocalValue(value);
  if (!d) {
    return null;
  }
  return {
    date: d,
    day: d.getDate(),
    hours: d.getHours(),
    minutes: d.getMinutes(),
    month: d.getMonth(),
    year: d.getFullYear(),
  };
}

function roundMinute5(m: number) {
  const r = Math.round(m / 5) * 5;
  return r >= 60 ? 55 : r;
}

interface AccessExpiryPickerProps {
  idPrefix: string;
  value: string;
  onChange: (datetimeLocal: string) => void;
}

export default function AccessExpiryPicker({ idPrefix, value, onChange }: AccessExpiryPickerProps) {
  const t = useTranslations('groups.expiryPicker');
  const locale = useLocale();
  const weekStart = WEEK_STARTS[locale];
  const parsed = useMemo(() => parseParts(value), [value]);
  const base = parsed?.date ?? new Date();

  const [viewYear, setViewYear] = useState(() => base.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => base.getMonth());

  useEffect(() => {
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }, [parsed?.year, parsed?.month, value]);

  const selected = parsed;

  // Empty cells before the 1st: how far its weekday is from the week's first day.
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() - weekStart + 7) % 7;
  const dim = daysInMonth(viewYear, viewMonth);
  const today = new Date();

  const handleDayClick = (day: number) => {
    if (day < 1 || day > dim) {
      return;
    }
    const h = selected?.hours ?? 12;
    const m = roundMinute5(selected?.minutes ?? 0);
    const next = new Date(viewYear, viewMonth, day, h, m, 0, 0);
    onChange(formatDateTimeLocalValue(next));
  };

  const setTime = (hours: number, minutes: number) => {
    const y = selected?.year ?? viewYear;
    const mo = selected?.month ?? viewMonth;
    let day = selected?.day;
    if (day == null) {
      const t = new Date();
      day =
        t.getFullYear() === y && t.getMonth() === mo ? t.getDate() : 1;
    }
    const next = new Date(y, mo, day, hours, minutes, 0, 0);
    onChange(formatDateTimeLocalValue(next));
  };

  const monthName = new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    month: 'long',
    year: 'numeric',
  }).format(new Date(viewYear, viewMonth, 1));
  // A heading starts with a capital ("Oktober 2026"), though Slovenian month names are lower case.
  const monthLabel = monthName.charAt(0).toLocaleUpperCase(INTL_LOCALES[locale]) + monthName.slice(1);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const hourOptions = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minuteOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i * 5), []);

  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ day: null });
  }
  for (let d = 1; d <= dim; d++) {
    cells.push({ day: d });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: null });
  }

  const selectedDayInView =
    selected &&
    selected.year === viewYear &&
    selected.month === viewMonth &&
    selected.day >= 1 &&
    selected.day <= dim
      ? selected.day
      : null;

  const roundedMinute = roundMinute5(selected?.minutes ?? 0);

  const isToday = (day: number) =>
    viewYear === today.getFullYear() &&
    viewMonth === today.getMonth() &&
    day === today.getDate();

  return (
    <div className={styles.picker}>
      <div className={styles.monthNav}>
        <button
          type="button"
          className={styles.navBtn}
          aria-label={t('previousMonth')}
          onClick={() => shiftMonth(-1)}
        >
          <FiChevronLeft size={18} />
        </button>
        <span className={styles.monthLabel}>{monthLabel}</span>
        <button
          type="button"
          className={styles.navBtn}
          aria-label={t('nextMonth')}
          onClick={() => shiftMonth(1)}
        >
          <FiChevronRight size={18} />
        </button>
      </div>

      <div className={styles.weekdays}>
        {WEEKDAYS.map((_, index) => WEEKDAYS[(index + weekStart) % 7]).map((day) => (
          <span key={day}>{t(`weekdays.${day}`)}</span>
        ))}
      </div>

      <div className={styles.days}>
        {cells.map((cell, idx) => {
          if (cell.day == null) {
            return <span key={`pad-${idx}`} className={`${styles.dayCell} ${styles.dayCellMuted}`} />;
          }
          const isSel = selectedDayInView === cell.day;
          const todayCell = isToday(cell.day);
          return (
            <button
              key={`${viewYear}-${viewMonth}-${cell.day}`}
              type="button"
              className={`${styles.dayCell} ${isSel ? styles.dayCellSelected : ''} ${todayCell && !isSel ? styles.dayCellToday : ''}`}
              onClick={() => handleDayClick(cell.day!)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div className={styles.timeRow}>
        <span className={styles.timeLabel}>{t('time')}</span>
        <AdminSearchableSelectField
          id={`${idPrefix}-hour`}
          label={t('hour')}
          hideLabel
          variant="toolbar"
          searchable={false}
          value={String(selected?.hours ?? 12)}
          options={hourOptions.map((h) => ({ value: String(h), label: String(h).padStart(2, '0') }))}
          onValueChange={(next) => setTime(Number(next), roundedMinute)}
        />
        <span className={styles.timeSep}>:</span>
        <AdminSearchableSelectField
          id={`${idPrefix}-minute`}
          label={t('minute')}
          hideLabel
          variant="toolbar"
          searchable={false}
          value={String(roundedMinute)}
          options={minuteOptions.map((m) => ({ value: String(m), label: String(m).padStart(2, '0') }))}
          onValueChange={(next) => setTime(selected?.hours ?? 12, Number(next))}
        />
      </div>
    </div>
  );
}
