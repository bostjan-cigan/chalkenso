import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { TbBuilding, TbBuildingStore, TbKey, TbPackageExport, TbSparkles } from 'react-icons/tb';
import { serverExtensions } from '@/extensions/server';
import { ui } from '@/extensions/ui';
import { getCurrentUserSession, isOrgAdmin } from '@/lib/admin-auth';
import { hasAnyAccess } from '@/lib/crm-access';
import AdminFrame from '../components/AdminFrame';
import { adminNavItems } from '../nav';
import ui_ from './ui/settings-ui.module.css';

/** Each place's tile, in System Settings' colours. */
const TILE: Record<string, string> = {
  general: '#8e8e93',
  ai: '#af52de',
  website: '#007aff',
  claude: '#d97757',
  plan: '#34c759',
  tokens: '#ff9500',
  export: '#30b0c7',
  partners: '#5856d6',
};

/**
 * The organisation's settings: General and AI here, the edition's own tabs, Tokens (each person's
 * sync tokens), Export, and Partners (shared by every course). Owners and admins see every tab;
 * members reach Tokens, Export (what they can open) and Partners. A component rather than a layout,
 * so an edition's own pages share it. The tabs' names are in `app.nav.settings`; the page gives its
 * own title and description.
 */
export default async function SettingsFrame({
  active,
  title,
  description,
  children,
}: {
  active: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const [session, t] = await Promise.all([getCurrentUserSession(), getTranslations('app.nav.settings')]);
  const admin = Boolean(session && isOrgAdmin(session.user));
  const user = session?.user;
  const exports = admin || Boolean(user?.organization && hasAnyAccess({ id: user.id, role: user.role, grants: user.grants }));
  const tabs = [
    ...(admin
      ? [
          { key: 'general', label: t('tabs.general'), href: '/admin/settings', Icon: TbBuilding },
          ...(serverExtensions.aiOrganizationKeys ? [{ key: 'ai', label: t('tabs.ai'), href: '/admin/settings/ai', Icon: TbSparkles }] : []),
        ]
      : []),
    ...ui.settingsTabs
      .filter((tab) => admin || tab.members)
      .map(({ key, label, href, icon }) => ({ key, label: t(`tabs.${label}`), href, Icon: icon })),
    // Sync tokens are each person's own (Obsidian): every member has the tab.
    { key: 'tokens', label: t('tabs.tokens'), href: '/admin/api-tokens', Icon: TbKey },
    ...(exports ? [{ key: 'export', label: t('tabs.export'), href: '/admin/settings/export', Icon: TbPackageExport }] : []),
    { key: 'partners', label: t('tabs.partners'), href: '/admin/courses/partners', Icon: TbBuildingStore },
  ];
  // The page's title is enough (Apple's Settings has no sentence under it); `description` is kept
  // for the page's metadata and callers, not shown.
  void description;
  return (
    <AdminFrame navItems={adminNavItems('settings')} eyebrow={t('label')} title={title}>
      <div className={ui_.layout}>
        <nav className={ui_.nav} aria-label={t('label')}>
          {tabs.map(({ key, label, href, Icon }) => (
            <Link
              key={key}
              href={href}
              prefetch
              className={key === active ? ui_.navLinkActive : ui_.navLink}
              aria-current={key === active ? 'page' : undefined}
              data-testid={`settings-nav-${key}`}
            >
              <span className={ui_.tile} style={{ '--tile': TILE[key] ?? TILE.general } as CSSProperties} aria-hidden>
                <Icon size={17} />
              </span>
              {label}
            </Link>
          ))}
        </nav>
        <div className={ui_.content}>{children}</div>
      </div>
    </AdminFrame>
  );
}
