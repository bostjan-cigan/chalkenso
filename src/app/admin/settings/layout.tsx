import type { ReactNode } from 'react';
import IntlProvider from '@/i18n/IntlProvider';

/** The words of settings; `app` and `common` again, since a nested provider replaces its parent's. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <IntlProvider namespaces={['common', 'app', 'account']}>{children}</IntlProvider>;
}
