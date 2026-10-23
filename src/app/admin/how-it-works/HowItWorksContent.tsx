import { getTranslations } from 'next-intl/server';
import { ui } from '@/extensions/ui';
import styles from './how-it-works.module.css';

const LOOP = ['teach', 'feedback', 'improve', 'publish'] as const;

/**
 * How Chalkenso works, the same everywhere it's shown (the sheet from Home, the page): the loop,
 * where AI helps (the edition's, by plan) and you decide; owners and admins also get how to run it
 * (the edition's), members a line saying who sets that up.
 */
export default async function HowItWorksContent({ organizationId, admin }: { organizationId: string; admin: boolean }) {
  const t = await getTranslations('app.howItWorks');
  return (
    <div className={styles.content} data-testid="how-it-works">
      <section className={styles.section}>
        <h3>{t('loop.title')}</h3>
        <ol className={styles.loop}>
          {LOOP.map((step) => (
            <li key={step}>
              <b>{t(`loop.${step}.title`)}</b>
              {t(`loop.${step}.text`)}
            </li>
          ))}
        </ol>
      </section>
      {ui.HowItWorksParts ? <ui.HowItWorksParts organizationId={organizationId} admin={admin} part="ai" /> : null}
      <section className={styles.section}>
        <h3>{t('decide.title')}</h3>
        <p className={styles.quiet}>{t('decide.text')}</p>
      </section>
      {admin ? (
        ui.HowItWorksParts ? <ui.HowItWorksParts organizationId={organizationId} admin part="running" /> : null
      ) : (
        <p className={styles.quiet} data-testid="how-it-works-members">
          {t('membersNote')}
        </p>
      )}
    </div>
  );
}
