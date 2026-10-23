import 'server-only';

import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { composeMail, sendMail } from './mail';
import { prisma } from './prisma';
import { hashSessionToken } from './security';
import { PRODUCT_NAME } from './site';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether an address looks like one an invite can go to. */
export function inviteEmailProblem(email: string): string | null {
  return EMAIL_PATTERN.test(email.trim()) ? null : 'Enter the email to send the invite to.';
}

/**
 * Emails an invite link (the Team page's, or a guest instructor's from a group page) and records where
 * it went. Returns whether it was sent; the link is shown on the page either way. In the language of
 * whoever sends it (their pick).
 */
export async function emailInvite(input: {
  token: string;
  to: string;
  organizationName: string;
  inviterName: string;
  link: string;
  /** A guest instructor's invite: the group they'll teach. */
  teaches?: { group: string; course: string } | null;
}): Promise<boolean> {
  const to = input.to.trim();
  const [locale, t] = await Promise.all([getLocale(), getTranslations('email.invite')]);
  const values = { inviter: input.inviterName, organization: input.organizationName, product: PRODUCT_NAME };
  const sent = await sendMail(
    composeMail({
      to,
      locale: locale as Locale,
      subject: input.teaches ? t('teachSubject', { ...values, group: input.teaches.group }) : t('subject', values),
      paragraphs: input.teaches
        ? [t('teachBody', { ...values, group: input.teaches.group, course: input.teaches.course }), t('teachNext')]
        : [t('body', values)],
      action: { label: t('action'), url: input.link },
      footer: t('footer'),
    })
  );
  if (sent.ok) {
    await prisma.userInvite.updateMany({ where: { tokenHash: hashSessionToken(input.token) }, data: { email: to, emailedAt: new Date() } });
  }
  return sent.ok;
}
