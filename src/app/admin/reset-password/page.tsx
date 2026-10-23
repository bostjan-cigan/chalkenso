import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MIN_PASSWORD_LENGTH } from '@/lib/organizations';
import { checkResetToken } from '@/lib/password-reset';
import AuthShell from '../components/AuthShell';
import ResetPasswordForm from './ResetPasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetPassword');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/** The reset link: a new password for the account, or why the link no longer works. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = String((await searchParams).token ?? '');
  const [check, t] = await Promise.all([checkResetToken(token), getTranslations('auth.resetPassword')]);
  if (!check.ok) {
    return (
      <AuthShell
        title={t('expired.title')}
        intro={t('expired.intro')}
        footer={<Link href="/admin/forgot-password">{t('expired.sendNew')}</Link>}
      >
        <span />
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t('title')} intro={t('intro', { email: check.email })}>
      <ResetPasswordForm token={token} minPasswordLength={MIN_PASSWORD_LENGTH} />
    </AuthShell>
  );
}
