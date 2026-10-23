import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { platformAdminHome, requireUser } from '@/lib/admin-auth';
import { orgNoticeText, readOrgNotice } from '@/lib/org-notice';
import { isSignupOpen } from '@/lib/organizations';
import AuthShell from '../components/AuthShell';
import AdminNotice from '../components/ui/AdminNotice';
import JoinInviteForm from './JoinInviteForm';
import OrganizationForm from './OrganizationForm';
import styles from '../admin.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.onboarding');
  return { title: t('title.create'), robots: { index: false, follow: false } };
}

/**
 * For signed-in users without an organisation (removed from their only team, or they left or
 * deleted it): create one while sign-up is open, or open an invite link from a colleague.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const user = await requireUser();
  if (user.organization) {
    redirect('/admin');
  }
  // A platform admin works outside organisations: they set one up for someone in Organisations.
  if (platformAdminHome(user)) {
    redirect('/admin/platform/organizations?new=organization');
  }
  const [canCreate, params] = await Promise.all([isSignupOpen(), searchParams]);
  const notice = params.org === 'notice' ? await readOrgNotice() : null;
  const t = await getTranslations('auth.onboarding');

  return (
    <AuthShell
      title={canCreate ? t('title.create') : t('title.none')}
      intro={canCreate ? t('intro.create') : t('intro.none')}
      footer={<Link href="/admin/logout">{t('signOut')}</Link>}
    >
      {notice ? <AdminNotice>{orgNoticeText(notice, (await getLocale()) as Locale)}</AdminNotice> : null}
      {canCreate ? (
        <>
          <OrganizationForm />
          <p className={styles.fieldHint} style={{ margin: 0, textAlign: 'center' }}>
            {t('or')}
          </p>
        </>
      ) : null}
      <JoinInviteForm />
    </AuthShell>
  );
}
