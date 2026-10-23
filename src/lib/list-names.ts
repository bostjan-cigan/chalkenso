import { INTL_LOCALES, type Locale } from '@/i18n/config';

/**
 * Names in a sentence: "Ana", "Ana and Bo", "Ana, Bo and Cene" (in Slovenian "Ana, Bo in Cene", with
 * `locale`). Client-safe.
 */
export function listNames(names: string[], locale?: Locale) {
  if (locale) {
    return new Intl.ListFormat(INTL_LOCALES[locale], { type: 'conjunction' }).format(names);
  }
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
