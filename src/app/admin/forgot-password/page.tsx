import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import AuthShell from '../components/AuthShell';
import ForgotPasswordForm from './ForgotPasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgotPassword');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Asks for the email; a reset link goes to it when it has an account. */
export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth.forgotPassword');
  return (
    <AuthShell
      title={t('title')}
      intro={t('intro')}
      footer={t.rich('rememberedIt', { link: (chunks: ReactNode) => <Link href="/admin/login">{chunks}</Link> })}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
