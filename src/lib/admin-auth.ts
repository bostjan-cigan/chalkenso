import 'server-only';

import { MemberAccess, OrgRole, Permission, UserRole } from '@prisma/client';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { isLocale, type Locale } from '@/i18n/config';
import { canAccessSection, resolveGrants, type AdminSectionKey, type Grant } from './permissions';
import { serverExtensions } from '@/extensions/server';
import { auth } from './auth';
import { prisma } from './prisma';
import { nextIdleEnd } from './session-limits';
import { noteEndReason } from './session-log';

/**
 * Who is signed in, for every page, action and route: Better Auth's session (src/lib/auth.ts) with
 * the person's organisations, role and access around it. Better Auth moves sessions with "Keep me
 * signed in" on as they're used; the short ones, which it never moves on, are moved on here, and a
 * member signed out of the organisation the session works in is signed out here.
 */

/** Better Auth's session cookie (its secure name on https). */
export const SESSION_COOKIE_NAMES = ['cai.session_token', '__Secure-cai.session_token'];

/** How often a session's `lastSeenAt` (and a short session's idle end) move forward: often enough for "online now", rarely enough to cost nothing. */
const SEEN_EVERY_MS = 1000 * 60 * 5;

export type SessionOrganization = {
  id: string;
  name: string;
  slug: string;
  plan: string;
};

/** One of the person's organisations, as the app's frame shows them (its card and switcher). */
export type SessionMembership = {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  iconName: string | null;
  iconColor: string | null;
  role: OrgRole;
};

export type SessionUser = {
  id: string;
  identifier: string;
  email: string | null;
  /**
   * Always `USER` inside an organisation: platform admins get no blanket access to customer data
   * through permission checks. Their platform role is `platformAdmin`.
   */
  role: UserRole;
  platformAdmin: boolean;
  isActive: boolean;
  profileImageKey: string | null;
  firstName: string | null;
  lastName: string | null;
  totpEnabled: boolean;
  /** The language they picked while signed in (the app follows it where a browser has no pick), or null. */
  locale: Locale | null;
  /** The organisation this session works in, and the user's role there. */
  organization: SessionOrganization | null;
  /** Every organisation the person belongs to, oldest membership first. */
  organizations: SessionMembership[];
  orgRole: OrgRole | null;
  /** FULL or LIMITED in this organisation (owners and admins always have full access). */
  access: MemberAccess | null;
  /**
   * Grants for permission checks in this organisation only: everything for owners, admins and FULL
   * members (one `all` grant); a LIMITED member's own rows there. Team management checks `orgRole`.
   */
  grants: Grant[];
  /** The platform admin looking through this user's eyes ("log in as"), if any. */
  impersonator: { id: string; name: string } | null;
};

type AdminSessionResult = {
  sessionId: string;
  /** Better Auth's token for it (to end or change it through Better Auth). */
  token: string;
  user: SessionUser;
  /** When it ends without activity (as of this request), and at the latest. */
  expiresAt: Date;
  maxExpiresAt: Date;
  persistent: boolean;
};


/** Kept for compatibility with older call sites: two-factor is optional in the MVP. */
export const TWO_FACTOR_SETUP_PATH = '/admin/profile?setup=two-factor';

export function mustSetUpTwoFactor(_user: { role: UserRole; totpEnabled: boolean }) {
  return false;
}

export function displayName(user: { firstName: string | null; lastName: string | null; identifier: string }) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.identifier;
}

/**
 * This request's headers for Better Auth, with the cookies as they are now: after an action changes
 * them (signing in, Better Auth starting a new session as two-factor goes on), `headers()` still
 * has the ones the request came with, and the page drawn in the same response would read a session
 * that has just ended.
 */
export async function authHeaders() {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const copy = new Headers(requestHeaders);
  copy.set('cookie', cookieStore.getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; '));
  return copy;
}

/** The session cookie this request carries, if any. */
async function sessionCookie() {
  const store = await cookies();
  for (const name of SESSION_COOKIE_NAMES) {
    const value = store.get(name)?.value;
    if (value) return value;
  }
  return null;
}

/**
 * React's `cache` only lasts a render: in server actions and route handlers every call would load
 * the session again, and the organisation scoping in prisma.ts asks for it before nearly every
 * query. So the session is also kept per request, on the request's cookie store (one object per
 * request), until this request changes it (`forgetCurrentSession`) or its cookie.
 */
const sessionsByRequest = new WeakMap<object, { token: string; session: Promise<AdminSessionResult | null> }>();

/** After changing the current session (its organisation): the next read loads it again. */
async function forgetCurrentSession() {
  try {
    sessionsByRequest.delete(await cookies());
  } catch {
    // Outside a request: nothing is kept.
  }
}

/**
 * The signed-in, active user with their current organisation. A session without an organisation
 * (or whose organisation the user left) falls back to the user's first membership.
 */
export const getCurrentUserSession = cache(
  async function getCurrentUserSession(): Promise<AdminSessionResult | null> {
    const cookie = await sessionCookie();
    if (!cookie) {
      return null;
    }
    const cookieStore = await cookies();
    const known = sessionsByRequest.get(cookieStore);
    if (known?.token === cookie) {
      return known.session;
    }
    const session = loadSession();
    sessionsByRequest.set(cookieStore, { token: cookie, session });
    session.catch(() => {
      if (sessionsByRequest.get(cookieStore)?.session === session) sessionsByRequest.delete(cookieStore);
    });
    return session;
  }
);

type BetterAuthSession = {
  id: string;
  token: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  maxExpiresAt?: Date | null;
  persistent?: boolean | null;
  organizationId?: string | null;
  impersonatedBy?: string | null;
};

async function loadSession(): Promise<AdminSessionResult | null> {
  const result = await auth.api.getSession({ headers: await authHeaders() });
  if (!result) {
    return null;
  }
  const session = result.session as unknown as BetterAuthSession;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      memberships: {
        orderBy: { createdAt: 'asc' },
        include: {
          organization: {
            select: { id: true, name: true, slug: true, plan: true, logoKey: true, iconName: true, iconColor: true },
          },
        },
      },
      // A LIMITED member's grants; only the active organisation's rows count (resolveGrants).
      grants: {
        where: { organizationId: { not: null } },
        select: { organizationId: true, entityType: true, entityId: true, permissions: true },
      },
    },
  });
  const maxExpiresAt = session.maxExpiresAt ?? session.expiresAt;
  if (maxExpiresAt <= new Date()) {
    // Past its hard end: it ends as an expiry (Better Auth only knows the idle end).
    const { internalAdapter } = await auth.$context;
    await internalAdapter.updateSession(session.token, { expiresAt: maxExpiresAt });
    await internalAdapter.deleteSession(session.token);
    return null;
  }
  if (!user || !user.isActive) {
    return null;
  }
  const impersonator = session.impersonatedBy
    ? await prisma.user.findUnique({ where: { id: session.impersonatedBy }, select: { id: true, identifier: true, firstName: true, lastName: true } })
    : null;

  const memberships = user.memberships;
  const membership =
    memberships.find((entry) => entry.organizationId === session.organizationId) ?? memberships[0] ?? null;

  // Signed out of this organisation from its Team page after this session began: sign in again.
  if (membership?.signedOutAt && session.createdAt <= membership.signedOutAt) {
    await endSessionsByToken([{ id: session.id, token: session.token }], 'organization');
    return null;
  }
  const expiresAt = await recordSeen(session, Boolean(session.persistent), maxExpiresAt);

  return {
    sessionId: session.id,
    token: session.token,
    expiresAt,
    maxExpiresAt,
    persistent: Boolean(session.persistent),
    user: {
      id: user.id,
      identifier: user.identifier,
      email: user.email,
      role: UserRole.USER,
      platformAdmin: user.role === UserRole.SUPERADMIN,
      isActive: user.isActive,
      profileImageKey: user.profileImageKey,
      firstName: user.firstName,
      lastName: user.lastName,
      totpEnabled: user.totpEnabled,
      locale: isLocale(user.locale) ? user.locale : null,
      organization: membership
        ? {
            id: membership.organization.id,
            name: membership.organization.name,
            slug: membership.organization.slug,
            plan: membership.organization.plan,
          }
        : null,
      organizations: memberships.map(({ organization, role }) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logoKey: organization.logoKey,
        iconName: organization.iconName,
        iconColor: organization.iconColor,
        role,
      })),
      orgRole: membership?.role ?? null,
      access: membership?.access ?? null,
      grants: membership ? await resolveGrants(membership, user.grants, membership.organizationId) : [],
      impersonator: impersonator ? { id: impersonator.id, name: displayName(impersonator) } : null,
    },
  };
}

/**
 * When the person was last here: the session history's `lastSeenAt` (at most every few minutes)
 * and, the first time each day, a `UserActivityDay`. A short session (no "Keep me signed in") is
 * moved on with it: Better Auth only moves on the kept ones. Never while a platform admin is logged
 * in as them (their visit keeps its hour), and never in the way of the request. Returns the
 * session's idle end.
 */
async function recordSeen(session: BetterAuthSession, persistent: boolean, maxExpiresAt: Date): Promise<Date> {
  if (session.impersonatedBy) {
    return session.expiresAt;
  }
  const now = new Date();
  const history = await prisma.userSession.findUnique({ where: { id: session.id }, select: { lastSeenAt: true } });
  const lastSeenAt = history?.lastSeenAt ?? null;
  if (lastSeenAt && now.getTime() - lastSeenAt.getTime() < SEEN_EVERY_MS) {
    return session.expiresAt;
  }
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  try {
    let expiresAt = session.expiresAt;
    if (!persistent) {
      expiresAt = nextIdleEnd({ persistent, maxExpiresAt }, now);
      await (await auth.$context).internalAdapter.updateSession(session.token, { expiresAt });
    }
    await Promise.all([
      prisma.userSession.updateMany({ where: { id: session.id }, data: { lastSeenAt: now } }),
      lastSeenAt && lastSeenAt >= day
        ? null
        : prisma.userActivityDay.createMany({ data: [{ userId: session.userId, day }], skipDuplicates: true }),
    ]);
    return expiresAt;
  } catch (error) {
    console.error('[session] could not record activity', error);
    return session.expiresAt;
  }
}

/**
 * Ends sessions through Better Auth (so its history says how), from outside its own endpoints:
 * signing a member out of an organisation, or ending one as it is read.
 */
export async function endSessionsByToken(sessions: Array<{ id: string; token: string }>, reason: Parameters<typeof noteEndReason>[1]) {
  if (!sessions.length) return 0;
  await noteEndReason(sessions.map((session) => session.id), reason);
  const { internalAdapter } = await auth.$context;
  for (const session of sessions) {
    await internalAdapter.deleteSession(session.token);
  }
  return sessions.length;
}

/**
 * The current session's end times, read without counting as activity: for the page that keeps
 * an eye on them (src/app/admin/components/SessionKeeper.tsx). Null when it has ended.
 */
export async function peekCurrentSession(): Promise<{ expiresAt: Date; maxExpiresAt: Date; persistent: boolean } | null> {
  const result = await auth.api.getSession({ headers: await authHeaders(), query: { disableRefresh: true } });
  if (!result) {
    return null;
  }
  const session = result.session as unknown as BetterAuthSession;
  const maxExpiresAt = session.maxExpiresAt ?? session.expiresAt;
  if (maxExpiresAt <= new Date()) {
    return null;
  }
  return { expiresAt: session.expiresAt, maxExpiresAt, persistent: Boolean(session.persistent) };
}

/**
 * "Stay signed in", or someone working on the open page: moves the current session's idle end on
 * now. Better Auth does it for a kept session (and its cookie) when it's due; a short one is moved
 * on here. Never past its hard end, never a "log in as" visit. Returns the new end times, or null.
 */
export async function extendCurrentSession(): Promise<{ expiresAt: Date; maxExpiresAt: Date } | null> {
  const session = await getCurrentUserSession();
  if (!session || session.user.impersonator) {
    return null;
  }
  if (session.persistent) {
    const fresh = await auth.api.getSession({ headers: await authHeaders() });
    const expiresAt = fresh ? new Date(Math.min(fresh.session.expiresAt.getTime(), session.maxExpiresAt.getTime())) : session.expiresAt;
    return { expiresAt, maxExpiresAt: session.maxExpiresAt };
  }
  const expiresAt = nextIdleEnd({ persistent: false, maxExpiresAt: session.maxExpiresAt });
  await (await auth.$context).internalAdapter.updateSession(session.token, { expiresAt });
  await prisma.userSession.updateMany({ where: { id: session.sessionId }, data: { lastSeenAt: new Date() } });
  return { expiresAt, maxExpiresAt: session.maxExpiresAt };
}

/**
 * Where a platform admin works when the edition has a page for it: they manage organisations from
 * there, not from inside one. Logged in as someone, they are that person.
 */
export function platformAdminHome(user: { platformAdmin?: boolean; impersonator?: unknown }) {
  return user.platformAdmin && !user.impersonator ? serverExtensions.platformAdminHome : null;
}

/** Where a signed-in user lands: their organisation's dashboard, or onboarding without one. */
export function homePathForUser(user: {
  organization?: SessionOrganization | null;
  platformAdmin?: boolean;
  impersonator?: unknown;
}) {
  return platformAdminHome(user) ?? (user.organization ? '/admin' : '/admin/onboarding');
}

export async function homePathForUserId(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === UserRole.SUPERADMIN && serverExtensions.platformAdminHome) {
    return serverExtensions.platformAdminHome;
  }
  const membership = await prisma.organizationMember.findFirst({ where: { userId }, select: { id: true } });
  return membership ? '/admin' : '/admin/onboarding';
}

/**
 * Where to sign in. When the browser still holds a session that has ended (it ran out, or was
 * signed out from elsewhere), the page says so.
 */
async function signInPath() {
  return (await sessionCookie()) ? '/admin/login?signedout=1' : '/admin/login';
}

/** The signed-in platform admin (sees the whole platform). */
export async function requireSuperAdmin() {
  const session = await getCurrentUserSession();

  if (!session) {
    redirect(await signInPath());
  }

  if (!session.user.platformAdmin) {
    redirect(homePathForUser(session.user));
  }

  return session.user;
}

/**
 * The signed-in user inside an organisation; users without one go to onboarding, and platform
 * admins to their own page (organisation pages are for members).
 */
export async function requireMember() {
  const session = await getCurrentUserSession();

  if (!session) {
    redirect(await signInPath());
  }

  const adminHome = platformAdminHome(session.user);
  if (adminHome) {
    redirect(adminHome);
  }

  if (!session.user.organization) {
    redirect('/admin/onboarding');
  }

  return session.user as SessionUser & { organization: SessionOrganization; orgRole: OrgRole };
}

/** An owner or admin of the current organisation (team and settings). */
export async function requireOrgAdmin() {
  const user = await requireMember();

  if (user.orgRole !== OrgRole.OWNER && user.orgRole !== OrgRole.ADMIN) {
    redirect('/admin');
  }

  return user;
}

export function isOrgAdmin(user: { orgRole: OrgRole | null }) {
  return user.orgRole === OrgRole.OWNER || user.orgRole === OrgRole.ADMIN;
}

/** The signed-in member, if they hold `permissions` on the admin `section` (members always do). */
export async function requireSection(section: AdminSectionKey, permissions: Permission[] = [Permission.READ]) {
  const user = await requireMember();

  if (!canAccessSection(user, section, permissions)) {
    redirect('/admin');
  }

  return user;
}

/** The signed-in user of any kind (account pages), or a redirect to sign in. */
export async function requireUser(_options: { allowWithoutTwoFactor?: boolean } = {}) {
  const session = await getCurrentUserSession();

  if (!session) {
    redirect(await signInPath());
  }

  return session.user;
}

export async function redirectAuthenticatedAdmin() {
  const session = await getCurrentUserSession();

  if (session) {
    redirect(homePathForUser(session.user));
  }
}

/**
 * Signs a new account in on this browser through Better Auth, with the password it was just made
 * with (sign-up, joining by invite). Without "Keep me signed in": the
 * next sign-in offers it.
 */
export async function signInWithPassword(email: string, password: string) {
  await auth.api.signInEmail({ body: { email, password, rememberMe: false }, headers: await authHeaders() });
  await forgetCurrentSession();
}

/** Points the current session at another organisation the user belongs to. */
export async function switchSessionOrganization(organizationId: string) {
  const session = await getCurrentUserSession();
  if (!session) {
    return false;
  }
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.user.id } },
    select: { id: true },
  });
  if (!membership) {
    return false;
  }
  await (await auth.$context).internalAdapter.updateSession(session.token, { organizationId });
  await forgetCurrentSession();
  return true;
}

/**
 * After leaving or deleting the session's organisation: work in the oldest one the person still
 * belongs to. Returns its id, or null when none is left (the next page is onboarding).
 */
export async function moveSessionToRemainingOrganization(): Promise<string | null> {
  const session = await getCurrentUserSession();
  if (!session) {
    return null;
  }
  const next = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true },
  });
  await (await auth.$context).internalAdapter.updateSession(session.token, { organizationId: next?.organizationId ?? null });
  await forgetCurrentSession();
  return next?.organizationId ?? null;
}

/**
 * Signs out this browser, through Better Auth (its cookie goes too). While a platform admin is
 * logged in as someone, the sign-out route first returns them to their own session
 * (src/app/admin/logout/route.ts).
 */
export async function revokeCurrentAdminSession() {
  if (await sessionCookie()) {
    await auth.api.signOut({ headers: await authHeaders() }).catch(() => null);
  }
  await forgetCurrentSession();
}

/**
 * For actions that change how someone signs in (password, two-factor, email, API keys): a platform
 * admin logged in as that user may look and help, but not touch their credentials.
 */
export async function refuseWhileImpersonating(): Promise<string | null> {
  const session = await getCurrentUserSession();
  if (!session?.user.impersonator) return null;
  return (await getTranslations('app.impersonation'))('refused');
}
