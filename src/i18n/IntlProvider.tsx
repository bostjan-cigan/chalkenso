import type { ReactNode } from 'react';
import { cache } from 'react';
import { getLocale } from 'next-intl/server';
import ClientIntlProvider from './ClientIntlProvider';
import type { Locale } from './config';
import { type Namespace, loadMessages, pickMessages } from './messages';

/**
 * The request's language once a provider has looked it up, so the providers below it (a section's
 * own words) render at once: one that waits makes its part of the page stream in later, behind
 * the loading screen, for no reason.
 */
const requestLocale = cache((): { locale: Locale | null } => ({ locale: null }));

/** What next-intl uses when none is configured (`src/i18n/request.ts` sets none): the server's. */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Gives the client components below it their words (`useTranslations`), in `locale` or the
 * request's language (`src/i18n/request.ts`). Providers don't merge: a nested one replaces its
 * parent's words for everything under it, so list every namespace the components under it use.
 */
export default function IntlProvider({
  locale,
  namespaces,
  children,
}: {
  locale?: Locale;
  namespaces: readonly Namespace[];
  children: ReactNode;
}) {
  const known = locale ?? requestLocale().locale;
  return known ? (
    <WithWords locale={known} namespaces={namespaces}>
      {children}
    </WithWords>
  ) : (
    <LookingUpLocale namespaces={namespaces}>{children}</LookingUpLocale>
  );
}

/** The first provider of a request without a language of its own: looks it up, and remembers it. */
async function LookingUpLocale({ namespaces, children }: { namespaces: readonly Namespace[]; children: ReactNode }) {
  const locale = (await getLocale()) as Locale;
  requestLocale().locale = locale;
  return (
    <WithWords locale={locale} namespaces={namespaces}>
      {children}
    </WithWords>
  );
}

function WithWords({ locale, namespaces, children }: { locale: Locale; namespaces: readonly Namespace[]; children: ReactNode }) {
  return (
    <ClientIntlProvider locale={locale} messages={pickMessages(loadMessages(locale), namespaces)} timeZone={TIME_ZONE}>
      {children}
    </ClientIntlProvider>
  );
}
