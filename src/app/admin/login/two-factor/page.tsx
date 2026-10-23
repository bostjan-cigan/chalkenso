import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentUserSession, homePathForUser } from '@/lib/admin-auth';
import { safeNext } from '@/lib/sign-in-messages';
import AuthShell from '../../components/AuthShell';
import TwoFactorForm from './TwoFactorForm';

type SearchParams = Promise<{ next?: string }>;

/** Better Auth's step between the password and the code (its cookie, five minutes). */
const TWO_FACTOR_COOKIES = ['cai.two_factor', '__Secure-cai.two_factor'];

export default async function AdminTwoFactorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const existingSession = await getCurrentUserSession();

  if (existingSession) {
    redirect(homePathForUser(existingSession.user));
  }

  const cookieStore = await cookies();
  if (!TWO_FACTOR_COOKIES.some((name) => cookieStore.has(name))) {
    redirect('/admin/login?error=totp-expired');
  }

  const params = await searchParams;
  const t = await getTranslations('auth.twoFactor');

  return (
    <AuthShell
      title={t('title')}
      intro={t('intro')}
      footer={<Link href="/admin/login">{t('back')}</Link>}
    >
      <TwoFactorForm next={safeNext(params.next)} />
    </AuthShell>
  );
}
