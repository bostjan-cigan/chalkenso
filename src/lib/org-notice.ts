import 'server-only';

import { cookies } from 'next/headers';
import { createTranslator } from 'next-intl';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';

/**
 * A one-minute note for the next page after leaving or deleting an organisation ("You left …").
 * Kept in a cookie rather than the address, so a link can't put its own words on the page; shown
 * only when the page is opened with `?org=notice`.
 */
const COOKIE = 'chalkenso_org_notice';

export type OrgNotice = { kind: 'left' | 'deleted'; name: string };

export async function setOrgNotice(notice: OrgNotice) {
  (await cookies()).set(COOKIE, JSON.stringify({ kind: notice.kind, name: notice.name.slice(0, 120) }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin',
    maxAge: 60,
  });
}

export async function readOrgNotice(): Promise<OrgNotice | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; name?: unknown };
    if ((parsed.kind === 'left' || parsed.kind === 'deleted') && typeof parsed.name === 'string') {
      return { kind: parsed.kind, name: parsed.name };
    }
  } catch {
    // Not ours or damaged: show nothing.
  }
  return null;
}

/** The note in words (`auth.onboarding.notice`): English for the app's pages, the visitor's language on onboarding. */
export function orgNoticeText(notice: OrgNotice, locale: Locale = DEFAULT_LOCALE) {
  const t = createTranslator({ locale, messages: { auth: loadMessages(locale).auth }, namespace: 'auth.onboarding.notice' });
  return t(notice.kind, { name: notice.name });
}
