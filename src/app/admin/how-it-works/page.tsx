import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import AdminFrame from '@/app/admin/components/AdminFrame';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import { adminNavItems } from '@/app/admin/nav';
import { isOrgAdmin, requireMember } from '@/lib/admin-auth';
import adminStyles from '@/app/admin/admin.module.css';
import HowItWorksContent from './HowItWorksContent';
import { howItWorksAction } from './data';
import styles from './how-it-works.module.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('app.howItWorks'))('title') };
}
export const dynamic = 'force-dynamic';

/** How Chalkenso works as a page, for any time after the card on Home (Profile links here). */
export default async function HowItWorksPage() {
  const viewer = await requireMember();
  const [t, action] = await Promise.all([getTranslations('app.howItWorks'), howItWorksAction(viewer)]);
  return (
    <AdminFrame navItems={adminNavItems('overview')} eyebrow={viewer.organization.name} title={t('title')} description={t('description')}>
      <section className={adminStyles.editorPageSection} style={{ display: 'grid', gap: '1.25rem', maxWidth: '48rem' }}>
        <HowItWorksContent organizationId={viewer.organization.id} admin={isOrgAdmin(viewer)} />
        <div className={styles.footer} style={{ justifyContent: 'flex-end' }}>
          <AdminButton href={action.href} data-testid="how-it-works-action">
            {t(`action.${action.kind}`)}
          </AdminButton>
        </div>
      </section>
    </AdminFrame>
  );
}
