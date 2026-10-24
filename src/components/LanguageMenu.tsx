'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import AdminSearchableSelectField from '@/app/admin/components/ui/AdminSearchableSelectField';
import {
  LANGUAGES,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
  isLocale,
  languageAddress,
} from '@/i18n/config';
import { rememberLocale } from '@/i18n/actions';
import { cn } from '@/utils/cn';
import Flag from './Flag';
import styles from './LanguageMenu.module.css';

/**
 * Remembers a language (a cookie, for a year, and on the account of someone signed in) and shows the
 * page in it: a page with an address per language (`hasLanguageAddress`) goes to that language's;
 * any other page keeps its address and loads again.
 */
export async function chooseLocale(next: Locale) {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax${secure}`;
  // Saving it on the account is a nicety: the page changes language whether or not it worked.
  await rememberLocale(next).catch(() => undefined);
  const { pathname, search, hash } = window.location;
  const address = languageAddress(pathname, next);
  if (address) {
    window.location.assign(`${address}${search}${hash}`);
  } else {
    window.location.reload();
  }
}

/**
 * The language menu, as on pavone.ai: the flag and short code ("EN") in the trigger, each language's
 * flag and own name ("Slovenščina") in the list. `header`: in the website's header, beside "Sign in";
 * `floating`: in the top-right corner beside the theme switch (signing in, learner pages); `menu`: in
 * the phone menu's panel; `sidebar`: in the app sidebar, beside the account name (the code hides
 * when the sidebar is collapsed).
 */
export default function LanguageMenu({
  variant,
  className,
}: {
  variant: 'header' | 'floating' | 'menu' | 'sidebar';
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('common.language');
  const id = useId();
  return (
    <AdminSearchableSelectField
      id={`language-${id}`}
      label={t('label')}
      hideLabel
      variant="toolbar"
      searchable={false}
      options={LOCALES.map((code) => ({ value: code, label: LANGUAGES[code].name, icon: <Flag locale={code} /> }))}
      value={locale}
      onValueChange={(next) => {
        if (isLocale(next) && next !== locale) void chooseLocale(next);
      }}
      leading={<Flag locale={locale} />}
      valueLabel={
        variant === 'menu' ? LANGUAGES[locale].name : <span className={styles.code}>{LANGUAGES[locale].short}</span>
      }
      triggerClassName={cn(styles.trigger, styles[variant])}
      className={cn(styles.field, variant === 'floating' && styles.floatingField, className)}
    />
  );
}
