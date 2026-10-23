import type { CSSProperties } from 'react';
import { INTL_LOCALES, type Locale } from '@/i18n/config';

/** When a course's lessons last changed, for its row in the course list. */
export function formatLessonUpdatedAt(value: Date, locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

/** Inline flex row for secondary meta lines (course + lesson list rows). */
export const courseListMetaGroupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.85rem',
};

/** Slightly wider gaps between meta chips on the groups list. */
export const groupListMetaGroupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '1.2rem',
};
