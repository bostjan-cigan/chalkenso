import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { redirectAuthenticatedAdmin } from '@/lib/admin-auth';
import { serverExtensions } from '@/extensions/server';
import { isSignupOpen } from '@/lib/organizations';
import AdminLoginMock from '../components/AdminLoginMock';
import AuthShell from '../components/AuthShell';
import { safeNext, signInErrorFromCode } from '@/lib/sign-in-messages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.login');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

type SearchParams = Promise<{ error?: string; next?: string; reset?: string; deleted?: string; signedout?: string; everywhere?: string }>;


export default async function AdminLoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNext(params.next) ?? undefined;
  if (!next) {
    await redirectAuthenticatedAdmin();
  }
  await serverExtensions.beforeLogin();
  const signupOpen = await isSignupOpen();
  const t = await getTranslations('auth');
  const error = signInErrorFromCode(params.error);

  return (
    <AuthShell
      title={
        params.deleted
          ? t('login.title.deleted')
          : params.everywhere
            ? t('login.title.everywhere')
            : params.signedout
              ? t('login.title.signedOut')
              : t('login.title.welcome')
      }
      // After a password reset or deleting an account, the line says it worked; after a session
      // ended (it ran out, or was signed out from elsewhere), that it did.
      intro={
        params.reset
          ? t('login.intro.reset')
          : params.deleted
            ? t('login.intro.deleted')
            : params.everywhere
              ? t('login.intro.everywhere')
              : params.signedout
              ? t('login.intro.signedOut')
              : t('login.intro.welcome')
      }
      footer={
        <>
          <Link href="/admin/forgot-password">{t('login.forgot')}</Link>
          {signupOpen ? (
            <>
              {' · '}
              {t.rich('login.newHere', { link: (chunks: ReactNode) => <Link href="/signup">{chunks}</Link> })}
            </>
          ) : null}
        </>
      }
    >
      <AdminLoginMock errorMessage={error ? t(`signInErrors.${error}`) : undefined} next={next} />
    </AuthShell>
  );
}
