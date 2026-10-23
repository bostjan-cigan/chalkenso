/**
 * The languages the app speaks. Client-safe. English is the default: what anyone sees until they
 * pick another language (in the language menu) or open the Slovenian landing page (`/sl`).
 */
export const LOCALES = ['en', 'sl'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Remembers someone's pick for a year: set in the browser by the language menu, and by the proxy
 * when someone opens `/sl`. Present only after a choice, so "no cookie" means "never picked".
 */
export const LOCALE_COOKIE = 'chalkenso_locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Each language as it calls itself, and its short code, for the language menu. */
export const LANGUAGES: Record<Locale, { name: string; short: string }> = {
  en: { name: 'English', short: 'EN' },
  sl: { name: 'Slovenščina', short: 'SL' },
};

/**
 * What `Intl` formats with: British English (18 Oct 2026, 1,250), Slovenian as in Slovenia (18. okt. 2026;
 * 1250 and 12.500: four digits stay together, as Slovenian spelling has it).
 */
export const INTL_LOCALES: Record<Locale, string> = {
  en: 'en-GB',
  sl: 'sl-SI',
};

/**
 * The landing page in each language: the only page whose address says its language (`/`, `/sl`).
 * Every other page keeps one address and follows the remembered pick.
 */
export function homePath(locale: Locale) {
  return locale === DEFAULT_LOCALE ? '/' : `/${locale}`;
}

/** Whether a path is one of the landing pages (`/`, `/sl`). */
export function isHomePath(pathname: string) {
  return LOCALES.some((locale) => pathname === homePath(locale));
}
