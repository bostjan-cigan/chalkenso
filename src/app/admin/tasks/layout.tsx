import type { ReactNode } from 'react';
import IntlProvider from '@/i18n/IntlProvider';

/** The words of tasks; `app` and `common` again, since a nested provider replaces its parent's. */
export default function TasksLayout({ children }: { children: ReactNode }) {
  return <IntlProvider namespaces={['common', 'app', 'tasks']}>{children}</IntlProvider>;
}
