import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import AuthShell from '@/app/admin/components/AuthShell';
import type { Locale } from '@/i18n/config';
import { redirectAuthenticatedAdmin } from '@/lib/admin-auth';
import { isSignupOpen, MIN_PASSWORD_LENGTH } from '@/lib/organizations';
import { EDITION, PRODUCT_NAME } from '@/lib/site';
import { serverExtensions } from '@/extensions/server';
import { ui } from '@/extensions/ui';
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

/**
 * The plan the pricing page sent them for (`?plan=…`), in the visitor's language; null where the
 * edition has no plans (the local edition), and `missing` when it has and none was picked.
 */
async function signupPlan(locale: Locale, requested: string | undefined) {
  const plans = await serverExtensions.signupPlans?.(locale);
  if (!plans) return null;
  const wanted = requested?.toUpperCase();
  return plans.options.find((option) => option.value === wanted) ?? 'missing';
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signup');
  return { title: t('metaTitle'), description: t('metaDescription', { product: PRODUCT_NAME }) };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  serverExtensions.beforeSignup();
  await redirectAuthenticatedAdmin();

  const t = await getTranslations('auth');
  const signIn = t.rich('links.haveAccount', { link: (chunks: ReactNode) => <Link href="/admin/login">{chunks}</Link> });

  if (!(await isSignupOpen())) {
    return (
      <AuthShell title={t('signup.closed.title')} intro={t('signup.closed.intro')} footer={signIn}>
        <span />
      </AuthShell>
    );
  }

  const locale = (await getLocale()) as Locale;
  const [intro, plan] = await Promise.all([
    serverExtensions.signupIntro(locale),
    signupPlan(locale, (await searchParams).plan),
  ]);
  // Where the edition has plans, registering starts with picking one, on its pricing page.
  if (plan === 'missing') {
    redirect('/pricing');
  }
  return (
    <AuthShell kicker={intro.kicker} title={t('signup.title')} intro={intro.intro} footer={signIn}>
      <SignupForm minPasswordLength={MIN_PASSWORD_LENGTH} plan={plan} checkHandles={EDITION === 'cloud'} />
      {ui.SignupNote ? <ui.SignupNote /> : null}
    </AuthShell>
  );
}
