'use client';

import { NextIntlClientProvider } from 'next-intl';
import { type ComponentProps, useLayoutEffect } from 'react';

/**
 * next-intl's provider as a plain client component: `IntlProvider` hands it everything, so nothing
 * reads the request again (next-intl's server wrapper would, and could make a static page dynamic).
 * Also puts its language on `<html lang>`: the root layout can only guess it (it is the same for
 * every language), and an outer provider wins over an inner one (the app's chrome over a preview).
 */
export default function ClientIntlProvider(props: ComponentProps<typeof NextIntlClientProvider>) {
  const { locale } = props;
  useLayoutEffect(() => {
    if (locale) document.documentElement.lang = locale;
  }, [locale]);
  return <NextIntlClientProvider {...props} />;
}
