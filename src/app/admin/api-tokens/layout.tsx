import type { ReactNode } from 'react';
import IntlProvider from '@/i18n/IntlProvider';

/** The words of sync tokens; `app` and `common` again, since a nested provider replaces its parent's. */
export default function ApiTokensLayout({ children }: { children: ReactNode }) {
  return <IntlProvider namespaces={['common', 'app', 'account']}>{children}</IntlProvider>;
}
