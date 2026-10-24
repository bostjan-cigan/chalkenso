'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/config';

export type NotFoundWords = { text: string; back: string; home: string };

const unchanging = () => () => {};

/** The page's language as the root layout's script put it on `<html lang>`: its address's, else the remembered pick. */
function pageLanguage(): Locale {
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

/** The 404's words in the visitor's language, picked in the browser (English on the server). */
export default function NotFoundText({ words }: { words: Record<Locale, NotFoundWords> }) {
  const locale = useSyncExternalStore(unchanging, pageLanguage, () => DEFAULT_LOCALE);
  const { text, back, home } = words[locale];
  return (
    <>
      <p style={{ fontSize: '1.25rem', margin: '0.5rem 0 1.5rem' }}>{text}</p>
      <Link href={home} style={{ color: 'var(--accent-color-hex)' }}>
        {back}
      </Link>
    </>
  );
}
