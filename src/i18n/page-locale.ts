import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';
import { type Locale, isLocale } from './config';

/**
 * The language of the page being rendered, when its address decides it rather than the remembered
 * pick: the website's pages, which are rendered ahead of time once per language (under the
 * `[locale]` folder the proxy routes to). Without it, `src/i18n/request.ts` reads the cookie, which
 * would make those pages render on every request.
 */
const current = cache((): { locale: Locale | null } => ({ locale: null }));

export function pageLocale() {
  return current().locale;
}

/**
 * For each website layout, page and `generateMetadata`: reads the `[locale]` segment, 404s an unknown
 * one, and makes it the language of everything this render translates.
 */
export async function websiteLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  current().locale = locale;
  return locale;
}
