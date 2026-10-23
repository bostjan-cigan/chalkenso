import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, isLocale } from './config';
import { loadMessages } from './messages';
import { pageLocale } from './page-locale';

/** The language someone picked in this browser (the language menu's cookie), or null if they never did. */
export async function chosenLocale(): Promise<Locale | null> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : null;
}

/**
 * The language saved on the signed-in person's account (picked in the menu while signed in, on any
 * device), or null. Loaded on demand: the session code imports most of the app, and this file is
 * part of every render.
 */
async function accountLocale(): Promise<Locale | null> {
  const { getCurrentUserSession } = await import('@/lib/admin-auth');
  return (await getCurrentUserSession())?.user.locale ?? null;
}

/**
 * next-intl's configuration for each render (`next.config.js` points its plugin here). The language,
 * first that applies: one asked for by name (`getTranslations({ locale })`, e.g. a learner page in
 * its course's language), the website page's own (`websiteLocale`), this browser's pick, the
 * signed-in person's saved pick, English.
 */
export default getRequestConfig(async ({ locale }) => {
  const resolved =
    (isLocale(locale) ? locale : null) ?? pageLocale() ?? (await chosenLocale()) ?? (await accountLocale()) ?? DEFAULT_LOCALE;
  return { locale: resolved, messages: loadMessages(resolved) };
});
