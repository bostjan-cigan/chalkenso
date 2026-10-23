import type { ReactNode } from 'react';
import IntlProvider from '@/i18n/IntlProvider';

/** The words of profile and security; `app` and `common` again, since a nested provider replaces its parent's. */
export default function ProfileLayout({ children }: { children: ReactNode }) {
  return <IntlProvider namespaces={['common', 'app', 'account']}>{children}</IntlProvider>;
}
