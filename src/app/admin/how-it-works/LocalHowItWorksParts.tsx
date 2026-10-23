import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TbKey, TbNotebook, TbSparkles, TbUsers } from 'react-icons/tb';
import styles from './how-it-works.module.css';

/**
 * The local edition's parts of How Chalkenso works: AI in the app on the installation's Anthropic
 * key, or Claude Code in an Obsidian vault the plugin syncs; for the manager, the team and the key.
 */
export default async function LocalHowItWorksParts({ part }: { organizationId: string; admin: boolean; part: 'ai' | 'running' }) {
  const t = await getTranslations('app.howItWorks.local');
  if (part === 'ai') {
    return (
      <section className={styles.section} data-testid="how-it-works-ai">
        <h3>{t('ai.title')}</h3>
        <div className={styles.ways}>
          <div className={styles.way}>
            <div className={styles.wayTitle}>
              <TbSparkles aria-hidden />
              {t('ways.app.title')}
              <span className={styles.tag}>{t('tags.key')}</span>
            </div>
            {t('ways.app.text')}
          </div>
          <div className={styles.way}>
            <div className={styles.wayTitle}>
              <TbNotebook aria-hidden />
              {t('ways.vault.title')}
              <span className={styles.tag}>{t('tags.optional')}</span>
            </div>
            {t('ways.vault.text')}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.section} data-testid="how-it-works-running">
      <h3>{t('running.title')}</h3>
      <ul className={styles.rows}>
        <li>
          <Link href="/admin/team">
            <span className={styles.rowLabel}>
              <TbUsers aria-hidden />
              {t('rows.team')}
            </span>
            <span className={styles.where}>{t('where.team')} ›</span>
          </Link>
        </li>
        <li>
          <Link href="/admin/settings/ai">
            <span className={styles.rowLabel}>
              <TbKey aria-hidden />
              {t('rows.key')}
            </span>
            <span className={styles.where}>{t('where.ai')} ›</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
