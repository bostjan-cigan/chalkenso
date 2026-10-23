import type { ReactNode } from 'react';
import IntlProvider from '@/i18n/IntlProvider';

/**
 * The words of courses, their workspace and groups (all under /admin/courses), with the edition's own
 * pieces they show (absent in the local edition); `app` and `common` again, since a nested provider
 * replaces its parent's.
 */
export default function CoursesLayout({ children }: { children: ReactNode }) {
  return (
    <IntlProvider namespaces={['common', 'app', 'courses', 'editor', 'groups', 'insights', 'cloudApp', 'tasks.plan', 'tasks.record']}>{children}</IntlProvider>
  );
}
