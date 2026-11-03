import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Suspense, type ReactNode } from 'react';
import IntlProvider from '@/i18n/IntlProvider';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { PRODUCT_NAME } from '@/lib/site';
import SessionKeeper from './components/SessionKeeper';
import { SidebarState } from './components/SidebarState';
import { SIDEBAR_COOKIE } from './sidebar-cookie';

/** While signed in (as themselves), the eye on the session's end. Streams on its own: never holds up the page. */
async function SessionWatch() {
  const session = await getCurrentUserSession();
  return session && !session.user.impersonator ? (
    <SessionKeeper expiresAt={session.expiresAt.toISOString()} maxExpiresAt={session.maxExpiresAt.toISOString()} />
  ) : null;
}

/** The tab's title where a page has none of its own: the product's name, no tagline. */
export const metadata: Metadata = { title: { absolute: PRODUCT_NAME, template: `%s | ${PRODUCT_NAME}` } };

/**
 * Keeps `admin.module.css` loaded for every `/admin/*` route so portaled UI (e.g. account menu
 * attached to `document.body`) does not lose hashed class styles during client navigations when
 * per-page CSS chunks swap (`SidebarState` imports it). Also holds whether the sidebar is collapsed,
 * across navigations, and, while signed in, keeps an eye on the session (`SessionKeeper`). Gives every
 * page the words of the app's frame and shared pieces (`common`, `app`), in the language picked in this
 * browser or saved on the account; a section adds its own words with a nested provider.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed';
  return (
    <IntlProvider namespaces={['common', 'app']}>
      <SidebarState initialCollapsed={collapsed}>
        {children}
        <Suspense fallback={null}>
          <SessionWatch />
        </Suspense>
      </SidebarState>
    </IntlProvider>
  );
}
