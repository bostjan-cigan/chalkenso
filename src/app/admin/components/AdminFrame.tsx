/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense, type ComponentType, type ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  TbBook2,
  TbShieldCheck,
  TbHome,
  TbLogout,
  TbSettings,
  TbUsers,
  TbUsersGroup,
} from 'react-icons/tb';
import BrandName from '@/components/BrandName';
import LanguageMenu from '@/components/LanguageMenu';
import ThemeToggle from '@/components/ThemeToggle';
import { serverExtensions } from '@/extensions/server';
import type { AdminNavLabel } from '@/extensions/types';
import { ui } from '@/extensions/ui';
import { getCurrentUserSession, isOrgAdmin } from '@/lib/admin-auth';
import { hasAnyAccess, hasCourseLevelAccess, isUnrestricted } from '@/lib/crm-access';
import { isSignupOpen } from '@/lib/organizations';
import { getOrganizationLogoUrl } from '@/lib/organization-logo';
import { EDITION } from '@/lib/site';

import type { AdminNavAudience } from '../nav';
import GettingStarted from '../getting-started/GettingStarted';
import OrganizationSwitcher from './OrganizationSwitcher';
import NeedsYouCount from './NeedsYouCount';
import { SidebarToggle, SidebarTooltips } from './SidebarState';
import { getAdminProfileImageUrl } from '@/lib/profile-image';
import AdminBadge from './ui/AdminBadge';
import AdminButton from './ui/AdminButton';
import styles from '../admin.module.css';

type NavItem = {
  /** Its name's key in `app.nav.places` (`adminNavItems`). */
  label: AdminNavLabel;
  href: string;
  active?: boolean;
  audience?: AdminNavAudience;
};

type ActionItem = {
  label: string;
  href: string;
  tone?: 'primary' | 'secondary';
};

interface AdminFrameProps {
  navItems: NavItem[];
  children: ReactNode;
  /** When false, only the sidebar is shown; no page header, stats, or top actions. */
  showHero?: boolean;
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ActionItem[];
  /** Optional summary stats (e.g. dashboard tiles) — right column of the page header on wide viewports. */
  summary?: ReactNode;
  /** Highlights the account link when on `/admin/profile`. */
  accountPageActive?: boolean;
  /** Wider page for workspaces (the lesson editor). */
  wide?: boolean;
  /** The platform admin's pages: which item of their sidebar (`ui.platformNav`) is this page. */
  platformSection?: string;
}

const NAV_ICONS: Record<string, IconType> = {
  '/admin': TbHome,
  '/admin/courses': TbBook2,
  '/admin/courses/groups': TbUsersGroup,
  '/admin/team': TbUsers,
  '/admin/settings': TbSettings,
  ...Object.fromEntries(ui.adminNav.map((item) => [item.href, item.icon])),
};

/** Counts next to places: what needs you on Home, and the edition's own. */
const NAV_COUNTS: Record<string, ComponentType> = {
  '/admin': NeedsYouCount,
  ...Object.fromEntries(ui.adminNav.flatMap((item) => (item.Count ? [[item.href, item.Count]] : []))),
};

function initials(name: string) {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

/**
 * The app chrome: a sidebar (brand, organisation, sections, account) and the page header. Its own
 * words are in `app` (the places' names in `app.nav`, roles in `app.roles`), in the reader's language;
 * the page header's are the page's.
 */
export default async function AdminFrame({
  navItems,
  children,
  showHero = true,
  eyebrow,
  title,
  description,
  actions = [],
  summary,
  accountPageActive = false,
  wide = false,
  platformSection,
}: AdminFrameProps) {
  const { AdminBanner } = ui;
  const [adminSession, t] = await Promise.all([getCurrentUserSession(), getTranslations('app')]);
  const fullName = [adminSession?.user.firstName, adminSession?.user.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const accountName = fullName || adminSession?.user.identifier || t('frame.account');
  const avatarUrl = getAdminProfileImageUrl(adminSession?.user.profileImageKey);
  const viewer = adminSession?.user;
  // A platform admin (as themselves, where the edition has a superadmin page) works outside any
  // organisation: the sidebar is their admin panel, with the edition's own sections.
  const adminPanel = Boolean(viewer?.platformAdmin && !viewer.impersonator && serverExtensions.platformAdminHome);
  const visibleNavItems =
    viewer && !adminPanel
    ? navItems
        .filter((item) => {
          switch (item.audience ?? 'member') {
            case 'orgAdmin':
              return Boolean(viewer.organization) && isOrgAdmin(viewer);
            case 'unrestricted':
              return Boolean(viewer.organization) && isUnrestricted(viewer);
            case 'courseLevel':
              return Boolean(viewer.organization) && hasCourseLevelAccess(viewer);
            case 'work':
              return Boolean(viewer.organization) && hasAnyAccess(viewer);
            default:
              return Boolean(viewer.organization);
          }
        })
    : [];
  // Every organisation the person belongs to, for the card and its switcher: loaded with the session.
  const organizations = (viewer?.organizations ?? []).map((organization) => ({
    id: organization.id,
    name: organization.name,
    logoUrl: getOrganizationLogoUrl(organization.id, organization.logoKey),
    iconName: organization.iconName,
    iconColor: organization.iconColor,
    // The edition's names for the roles (`serverExtensions.team.roles`), in the reader's language.
    roleLabel: t(`roles.${EDITION}.${organization.role}`),
  }));
  const currentOrganization = viewer?.organization
    ? organizations.find((organization) => organization.id === viewer.organization?.id) ?? null
    : null;
  // The hosted edition: people start, join and leave organisations themselves (never while a
  // platform admin is logged in as them). The local edition runs one.
  const ownChoices = EDITION === 'cloud' && Boolean(viewer) && !viewer?.impersonator;
  const createHref = ownChoices && currentOrganization && (await isSignupOpen()) ? '/admin/organizations/new' : null;
  const roleLabel = adminPanel
    ? t('roles.platformAdmin')
    : viewer?.orgRole
      ? t(`roles.${EDITION}.${viewer.orgRole}`)
      : viewer?.platformAdmin
        ? t('roles.platformAdmin')
        : null;

  return (
    <div className={`${styles.page} ${styles.appLayout}`}>
      <aside className={adminPanel ? `${styles.sidebar} ${styles.sidebarPlatform}` : styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link
            href={adminPanel ? (serverExtensions.platformAdminHome ?? '/admin') : '/admin'}
            className={styles.sidebarBrand}
            data-tip={t('frame.home')}
          >
            <span className={styles.sidebarBrandFull}>
              <BrandName />
            </span>
            <img src="/brand/chalkenso-enso.svg" alt="" aria-hidden className={styles.sidebarBrandMark} />
          </Link>
          <SidebarToggle />
        </div>
        <SidebarTooltips />

        {adminPanel ? (
          <div className={styles.sidebarOrg}>
            <div className={styles.platformMark} data-testid="admin-panel" data-tip={t('frame.platformAdmin')}>
              <span className={styles.platformMarkIcon} aria-hidden>
                <TbShieldCheck size={17} />
              </span>
              <span className={styles.platformMarkText}>
                <strong>{t('frame.platformAdmin')}</strong>
                <span>{t('frame.acrossOrganizations')}</span>
              </span>
            </div>
          </div>
        ) : viewer?.organization ? (
          <div className={styles.sidebarOrg}>
            {currentOrganization ? (
              <OrganizationSwitcher
                current={currentOrganization}
                organizations={organizations}
                settingsHref={isOrgAdmin(viewer) ? '/admin/settings' : null}
                canJoin={EDITION === 'cloud'}
                createHref={createHref}
                canLeave={ownChoices}
              />
            ) : null}
          </div>
        ) : null}

        {adminPanel ? (
          <nav className={styles.sideNav} aria-label={t('nav.platform.label')} data-testid="platform-nav">
            {ui.platformNav.map((group) => (
              <div key={group.label ?? 'top'} className={styles.sideNavGroup}>
                {group.label ? <span className={styles.sideNavHeading}>{t(`nav.platform.headings.${group.label}`)}</span> : null}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const Count = item.Count;
                  const active = item.key === platformSection;
                  const label = t(`nav.platform.items.${item.label}`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={active ? styles.sideNavLinkActive : styles.sideNavLink}
                      aria-current={active ? 'page' : undefined}
                      data-tip={label}
                    >
                      <Icon aria-hidden size={18} />
                      <span className={styles.sideNavLabel}>{label}</span>
                      {Count ? <Count /> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        ) : (
          <nav className={styles.sideNav} aria-label={t('nav.label')}>
            {visibleNavItems.map((item) => {
              const Icon = NAV_ICONS[item.href];
              const Count = NAV_COUNTS[item.href];
              const label = t(`nav.places.${item.label}`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={item.active ? styles.sideNavLinkActive : styles.sideNavLink}
                  aria-current={item.active ? 'page' : undefined}
                  data-tip={label}
                >
                  {Icon ? <Icon aria-hidden size={18} /> : null}
                  <span className={styles.sideNavLabel}>{label}</span>
                  {Count ? <Count /> : null}
                </Link>
              );
            })}
          </nav>
        )}

        <div className={styles.sidebarFooter}>
          {/* The account, and beside it the language (the tools row below has no room left for it). */}
          <div className={styles.sidebarAccountRow}>
            <Link
              href="/admin/profile"
              className={accountPageActive ? styles.sidebarAccountActive : styles.sidebarAccount}
              aria-label={t('frame.accountLink', { name: accountName })}
              data-tip={accountName}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" aria-hidden className={styles.sidebarAvatar} />
              ) : (
                <span className={styles.sidebarAvatar} aria-hidden>
                  {initials(accountName)}
                </span>
              )}
              <span className={styles.sidebarAccountText}>
                <span className={styles.sidebarAccountName}>{accountName}</span>
                {roleLabel ? <span className={styles.sidebarAccountMeta}>{roleLabel}</span> : null}
              </span>
            </Link>
            <LanguageMenu variant="sidebar" />
          </div>
          <div className={styles.sidebarTools}>
            <Link href="/admin/logout" prefetch={false} className={styles.sidebarTool} data-tip={t('frame.signOut')}>
              <TbLogout aria-hidden size={16} />
              <span>{t('frame.signOut')}</span>
            </Link>
            <ThemeToggle variant="inline" />
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        {viewer && AdminBanner ? <AdminBanner viewer={viewer} /> : null}
        {/* Said once, on the platform admin's Home: on every page it only pushes the page down (a phone above all). */}
        {adminPanel && platformSection === 'home' ? (
          <div className={styles.platformStrip} role="note">
            <TbShieldCheck aria-hidden size={16} />
            <span>
              {t.rich('frame.platformStrip', {
                strong: (chunks) => <strong>{chunks}</strong>,
                em: (chunks) => <em>{chunks}</em>,
              })}
            </span>
          </div>
        ) : null}
        <div className={wide ? `${styles.shell} ${styles.shellWide}` : styles.shell}>
          {showHero ? (
            <section className={styles.heroCard}>
              <div className={styles.heroContent}>
                {eyebrow ? <AdminBadge variant="kicker">{eyebrow}</AdminBadge> : null}
                {title ? <h1 className={styles.heroTitle}>{title}</h1> : null}
                {description ? <p className={styles.heroDescription}>{description}</p> : null}
                {actions.length ? (
                  <div className={styles.actionRow}>
                    {actions.map((action) => (
                      <AdminButton
                        key={`${action.href}-${action.label}`}
                        href={action.href}
                        tone={action.tone === 'secondary' ? 'secondary' : 'primary'}
                      >
                        {action.label}
                      </AdminButton>
                    ))}
                  </div>
                ) : null}
              </div>
              {summary ? <div className={styles.heroSummary}>{summary}</div> : null}
            </section>
          ) : null}

          {children}
        </div>
        {/* Getting started in the corner, inside an organisation: not on the workspaces (their own
            buttons sit there) or the platform admin's pages. Outside the page's column, whose layer
            would put it under the top bar on phones. */}
        {viewer?.organization && !adminPanel && !wide && !platformSection ? (
          <Suspense fallback={null}>
            <GettingStarted home={navItems.some((item) => item.active && item.href === '/admin')} />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
