import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import BrandName from '@/components/BrandName';
import LanguageMenu from '@/components/LanguageMenu';
import ThemeToggle from '@/components/ThemeToggle';
import { type Locale, homePath } from '@/i18n/config';
import IntlProvider from '@/i18n/IntlProvider';
import { EDITION } from '@/lib/site';

import styles from '../admin.module.css';

/**
 * Sign-in, sign-up, password reset, invites and onboarding: on the ruled paper, the product name over
 * the page's card: its title, the form, and the ways elsewhere at its foot. In the language picked in
 * its corner (the theme switch's neighbour), English until then: its client components get `common`
 * and `auth` words. The product name leads to the landing page in that language (the local edition
 * has none: its `/` is signing in).
 */
export default async function AuthShell({
  title,
  children,
  footer,
  hideTitle = false,
}: {
  title: string;
  /** Keep the title for screen readers only. */
  hideTitle?: boolean;
  /** None: the title says it all (a link that ran out), with the ways elsewhere under it. */
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const home = EDITION === 'cloud' ? homePath((await getLocale()) as Locale) : '/';
  return (
    <IntlProvider namespaces={['common', 'auth']}>
    <div className={styles.adminLayoutShell} data-admin-segment>
      <div className={`${styles.page} ${styles.authPage}`}>
        <LanguageMenu variant="floating" />
        <ThemeToggle />
        <div className={styles.authLayout}>
          <Link href={home} className={styles.authBrand}>
            <BrandName detail={1} />
          </Link>
          <main className={styles.authMain}>
            <section className={styles.authCard}>
              {hideTitle ? (
                <h1 className="sr-only">{title}</h1>
              ) : (
                <header className={styles.authHeader}>
                  <h1 className={styles.authTitle}>{title}</h1>
                </header>
              )}
              {children ? <div className={styles.authBody}>{children}</div> : null}
              {footer ? <footer className={styles.authFooter}>{footer}</footer> : null}
            </section>
          </main>
        </div>
      </div>
    </div>
    </IntlProvider>
  );
}
