import { getTranslations } from 'next-intl/server';
import { loadNeedsYou } from '../needs-you';
import styles from '../admin.module.css';

/** The number next to Home in the sidebar: what waits on the viewer (nothing when nothing does). */
export default async function NeedsYouCount() {
  const [items, t] = await Promise.all([loadNeedsYou(), getTranslations('app.frame')]);
  const count = items.reduce((total, item) => total + item.count, 0);
  if (!count) return null;
  return (
    <span className={styles.sideNavCount} aria-label={t('needYou', { count })} data-testid="needs-you-count">
      {count > 99 ? '99+' : count}
    </span>
  );
}
