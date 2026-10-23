import { getTranslations } from 'next-intl/server';
import ThemeToggle from '@/components/ThemeToggle';
import IntlProvider from '@/i18n/IntlProvider';
import styles from '../admin.module.css';

const block = (width: string, height: string, borderRadius: number) => (
  <span className={styles.skeletonBlock} style={{ display: 'block', width, height, borderRadius }} />
);

/**
 * Neutral fallback for the sign-in and two-factor routes: the card's shape, where it will be (no admin
 * chrome). In the visitor's language, like the page that follows (the app around it is English).
 */
export default async function LoginLoading() {
  const t = await getTranslations('auth.loading');
  return (
    <IntlProvider namespaces={['common']}>
      <div className={`${styles.page} ${styles.authPage}`} aria-busy="true" aria-label={t('label')}>
        <ThemeToggle />
        <div className={styles.authLayout}>
          <div className={styles.authAside} />
          <div className={styles.authMain}>
            <div className={styles.authCard} style={{ minHeight: '22rem' }}>
              {block('12rem', '2rem', 10)}
              {block('100%', '3rem', 12)}
              {block('100%', '3rem', 12)}
              {block('100%', '3rem', 999)}
            </div>
          </div>
        </div>
      </div>
    </IntlProvider>
  );
}
