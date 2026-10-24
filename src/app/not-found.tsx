import type { Metadata } from 'next';
import { createTranslator } from 'next-intl';
import NotFoundText, { type NotFoundWords } from '@/components/NotFoundText';
import { LOCALES, type Locale, homePath } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
import { EDITION, PRODUCT_NAME } from '@/lib/site';

/**
 * The 404's words in every language, ahead of time. Next renders this page along with every other
 * one, so it reads nothing from the request: asking for the visitor's language here (a cookie) made
 * every page render per request, the website's included. The browser picks the language; the tab's
 * title needs none.
 */
function wordsIn(locale: Locale): NotFoundWords {
  const t = createTranslator({ locale, messages: loadMessages(locale), namespace: 'common.notFound' });
  return {
    text: t('text'),
    back: t('back', { product: PRODUCT_NAME }),
    // Back to the landing page in that language (the local edition has none: its `/` is signing in)
    home: EDITION === 'cloud' ? homePath(locale) : '/',
  };
}

const WORDS = Object.fromEntries(LOCALES.map((locale) => [locale, wordsIn(locale)])) as Record<Locale, NotFoundWords>;

export const metadata: Metadata = { title: { absolute: `404 | ${PRODUCT_NAME}` } };

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        background: 'rgb(var(--background-rgb))',
        color: 'rgb(var(--foreground-rgb))',
        fontFamily: 'var(--font-sans), system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ fontSize: '4rem', fontWeight: 700, margin: 0, color: 'var(--accent-color-hex)' }}>404</p>
        <NotFoundText words={WORDS} />
      </div>
    </main>
  );
}
