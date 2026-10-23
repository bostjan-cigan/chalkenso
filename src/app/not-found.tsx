import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { type Locale, homePath } from '@/i18n/config';
import { EDITION, PRODUCT_NAME } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common.notFound');
  return { title: t('metaTitle') };
}

/**
 * In the visitor's language, and back to the landing page in it (the local edition has none: its `/`
 * is signing in).
 */
export default async function NotFound() {
  const t = await getTranslations('common.notFound');
  const home = EDITION === 'cloud' ? homePath((await getLocale()) as Locale) : '/';
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
        <p style={{ fontSize: '1.25rem', margin: '0.5rem 0 1.5rem' }}>{t('text')}</p>
        <Link href={home} style={{ color: 'var(--accent-color-hex)' }}>
          {t('back', { product: PRODUCT_NAME })}
        </Link>
      </div>
    </main>
  );
}
