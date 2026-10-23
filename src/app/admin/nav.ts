import { ui } from '@/extensions/ui';
import type { AdminNavLabel } from '@/extensions/types';

/**
 * Top-level admin places, in display order: Home, Groups, Courses, then the edition's own, Team and
 * Settings. Single source for every page's `AdminFrame` nav. Tasks, drafts,
 * feedback and partners live inside these places (a group's or course's Feedback, Home, Settings).
 * The platform admin's sidebar is the edition's own (`ui.platformNav`). Labels are keys of their words
 * in `app.nav.places`: `AdminFrame` shows them in the reader's language.
 */
export type AdminSection = 'overview' | 'groups' | 'courses' | 'team' | 'settings' | (string & {});

/**
 * Who sees an item: every member; members who reach some course or group (`work`); whole courses
 * (`courseLevel`); owners, admins and unrestricted members (`unrestricted`); or owners and admins
 * (`orgAdmin`).
 */
export type AdminNavAudience = 'member' | 'work' | 'courseLevel' | 'unrestricted' | 'orgAdmin';

export type AdminNavItem = {
  label: AdminNavLabel;
  href: string;
  active: boolean;
  audience: AdminNavAudience;
};

const ADMIN_NAV: Array<Omit<AdminNavItem, 'active'> & { key: AdminSection }> = [
  { key: 'overview', label: 'overview', href: '/admin', audience: 'member' },
  { key: 'groups', label: 'groups', href: '/admin/courses/groups', audience: 'work' },
  { key: 'courses', label: 'courses', href: '/admin/courses', audience: 'courseLevel' },
];

/** The organisation's own, after the edition's places. */
const ORG_NAV: Array<Omit<AdminNavItem, 'active'> & { key: AdminSection }> = [
  { key: 'team', label: 'team', href: '/admin/team', audience: 'orgAdmin' },
  // Every member has Settings (Tokens, Export, Partners); General opens for owners and admins.
  { key: 'settings', label: 'settings', href: '/admin/settings', audience: 'member' },
];

export function adminNavItems(active?: AdminSection | null): AdminNavItem[] {
  return [...ADMIN_NAV, ...ui.adminNav, ...ORG_NAV].map(({ key, label, href, audience }) => ({
    label,
    href,
    audience,
    active: key === active,
  }));
}
