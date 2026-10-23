import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin, captcha, twoFactor, username } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { AUTH_BASE_PATH, BOT_CHECKED_AUTH_ENDPOINTS } from './auth-paths';
import { composeMail, sendMail } from './mail';
import { prisma } from './prisma';
import { isLoopback } from './rate-limit';
import { hashPasswordAsync, verifyPassword } from './security';
import { locationFromHeaders } from './session-device';
import { IMPERSONATION_MS, SESSION_LIMITS, sessionLimits } from './session-limits';
import { logSessionChanged, logSessionEnded, logSessionStarted } from './session-log';
import {
  clearAllSignInLocks,
  clearFailedSignIns,
  fromRememberedBrowser,
  isLockedOut,
  recordFailedSignIn,
  rememberBrowser,
  signInLock,
  type CookieJar,
} from './sign-in-lockout';
import { PRODUCT_NAME, SITE_URL, absoluteUrl } from './site';

/**
 * Signing in and sessions, by Better Auth. It does: email or username with a password (our scrypt
 * hashes as they are), sessions in the database moved on by use, two-factor codes with their own
 * lockout, listing and ending sessions, the platform admin's "log in as" and bans, password reset
 * links, limits per address on its endpoints (`/api/auth/...`), and, where it is turned on, Vercel
 * BotID on signing in and "Forgot your password?" (its captcha plugin).
 *
 * What it doesn't do, added here through its hooks and nowhere else:
 * - a hard end to every session, and "Keep me signed in" choosing the limits (src/lib/session-limits.ts);
 * - locking out password guessing without letting strangers lock the owner out (src/lib/sign-in-lockout.ts);
 * - the history of sessions and how each ended (src/lib/session-log.ts);
 * - where a session was opened, the organisation it works in.
 * Moving short sessions on, and signing a member out of an organisation, are in src/lib/admin-auth.ts.
 */

const SIGN_IN_PATHS = new Set(['/sign-in/email', '/sign-in/username']);
const RESET_TTL_S = 60 * 60;
/** At most this many reset emails an hour for one account, so nobody can flood someone's inbox. */
const MAX_RESETS_PER_HOUR = 3;

/**
 * The app's one secret (it also signs our own tokens and remembered browsers). Better Auth would
 * fall back to a built-in default without one; never here, except while `next build` collects
 * pages (nothing is signed then).
 */
function appSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error('Missing required environment variable: SESSION_SECRET');
  }
  return secret || 'only-while-building';
}

/**
 * Vercel BotID's verdict, from the edition, loaded only when a request asks: the edition's modules
 * lead back to this one, so reading them while it loads would find them half made.
 */
async function botVerdict(): Promise<{ isBot: boolean }> {
  const { serverExtensions } = await import('@/extensions/server');
  return serverExtensions.authBotCheck ? serverExtensions.authBotCheck() : { isBot: false };
}

/**
 * One of Better Auth's limits per address. On the end-to-end tests' server only
 * (`AUTH_LIMITS_SKIP_LOOPBACK=1`, set by scripts/test-edition.mjs), requests from this machine aren't
 * counted: a run signs in hundreds of times from 127.0.0.1. Without it this machine counts like any
 * visitor, since a self-hosted install behind a proxy on the same machine sees every visitor as
 * 127.0.0.1.
 */
function addressLimit(rule: { window: number; max: number }, { exceptRememberedBrowsers = false } = {}) {
  return async (request: Request) => {
    if (process.env.AUTH_LIMITS_SKIP_LOOPBACK === '1' && isLoopback(request.headers.get('x-forwarded-for')?.trim())) return false;
    if (exceptRememberedBrowsers && (await fromRememberedBrowser(request.headers.get('cookie')))) return false;
    return rule;
  };
}

/** While a platform admin makes a reset link to send by hand, the link comes back here instead of by email. */
const resetLinkCapture = new AsyncLocalStorage<{ link: string | null }>();

/** The sign-in lock's view of an endpoint's cookies. */
function cookieJar(ctx: { getCookie(name: string): string | null | undefined; setCookie(name: string, value: string, options: object): unknown }): CookieJar {
  return {
    get: (name) => ctx.getCookie(name) ?? undefined,
    set: (name, value, options) => {
      ctx.setCookie(name, value, options);
    },
  };
}

async function signInAccount(identifier: string) {
  const value = identifier.trim();
  if (!value) return null;
  return prisma.user.findFirst({
    where: { OR: [{ identifier: value }, { email: { equals: value, mode: 'insensitive' } }] },
    orderBy: { createdAt: 'asc' },
    select: { id: true, knownBrowsersVersion: true },
  });
}

export const auth = betterAuth({
  appName: PRODUCT_NAME,
  baseURL: SITE_URL,
  basePath: AUTH_BASE_PATH,
  secret: appSecret(),
  // Versioned from the start (version 1 is SESSION_SECRET), so rotating Better Auth's secret is one
  // variable: BETTER_AUTH_SECRETS="2:<new>,1:<SESSION_SECRET>". Everyone signs in again once;
  // two-factor secrets stay readable, and SESSION_SECRET (our own tokens) stays as it is.
  secrets: process.env.BETTER_AUTH_SECRETS ? undefined : [{ version: 1, value: appSecret() }],
  // Its own address, and on Vercel the deployment's others (the production, deployment and branch
  // addresses): a sign-in from any other site is refused.
  trustedOrigins: [
    SITE_URL,
    ...[process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
      .filter((host): host is string => Boolean(host))
      .map((host) => `https://${host}`),
  ],
  telemetry: { enabled: false },
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  user: {
    // The R2 key of the profile photo is what Better Auth calls the image.
    fields: { image: 'profileImageKey' },
  },
  account: { modelName: 'authAccount' },
  verification: { modelName: 'authVerification' },
  session: {
    modelName: 'authSession',
    // Better Auth moves kept sessions on by this much; short ones are moved on in admin-auth.ts.
    expiresIn: SESSION_LIMITS.kept.idleMs / 1000,
    updateAge: 5 * 60,
    additionalFields: {
      maxExpiresAt: { type: 'date', required: false, input: false },
      persistent: { type: 'boolean', required: false, defaultValue: false, input: false },
      location: { type: 'string', required: false, input: false },
      organizationId: { type: 'string', required: false, input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    // Accounts are made with their organisation (src/lib/organizations.ts), then signed in here.
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 200,
    password: {
      hash: hashPasswordAsync,
      verify: async ({ hash, password }) => verifyPassword(password, hash),
    },
    resetPasswordTokenExpiresIn: RESET_TTL_S,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const link = absoluteUrl(`/admin/reset-password?token=${encodeURIComponent(token)}`);
      const capture = resetLinkCapture.getStore();
      if (capture) {
        capture.link = link;
        return;
      }
      const recent = await prisma.authVerification.count({
        where: { value: user.id, identifier: { startsWith: 'reset-password:' }, createdAt: { gt: new Date(Date.now() - RESET_TTL_S * 1000) } },
      });
      if (recent > MAX_RESETS_PER_HOUR) {
        return;
      }
      const person = await prisma.user.findUnique({ where: { id: user.id }, select: { firstName: true, isActive: true } });
      if (!person?.isActive) {
        return;
      }
      // In the language of the page that asked ("Forgot your password?" follows the visitor's pick).
      const [locale, t] = await Promise.all([getLocale(), getTranslations('email.passwordReset')]);
      await sendMail(
        composeMail({
          to: user.email,
          locale: locale as Locale,
          subject: t('subject', { product: PRODUCT_NAME }),
          paragraphs: [person.firstName ? t('greetingNamed', { name: person.firstName }) : t('greeting'), t('body')],
          action: { label: t('action'), url: link },
          footer: t('footer'),
        })
      );
    },
    // A new password: every browser is new again, and every lock ends.
    onPasswordReset: async ({ user }) => {
      await prisma.user.update({ where: { id: user.id }, data: { knownBrowsersVersion: { increment: 1 } } });
      await clearAllSignInLocks(user.id);
    },
  },

  rateLimit: {
    // In production only, as Better Auth does by default; counted in the database, shared by every instance.
    storage: 'database',
    modelName: 'authRateLimit',
    customRules: {
      // Plenty for a school's staff behind one address, and never for a browser someone signed in on before.
      '/sign-in/email': addressLimit({ window: 15 * 60, max: 50 }, { exceptRememberedBrowsers: true }),
      '/sign-in/username': addressLimit({ window: 15 * 60, max: 50 }, { exceptRememberedBrowsers: true }),
      '/two-factor/verify-totp': addressLimit({ window: 15 * 60, max: 50 }),
      // "Forgot your password?" (and at most 3 emails an hour to one account, in sendResetPassword).
      '/request-password-reset': addressLimit({ window: 60 * 60, max: 10 }),
    },
  },

  advanced: {
    cookiePrefix: 'cai',
    // Ids as everywhere else in the database (Prisma's cuid).
    database: { generateId: false },
  },

  databaseHooks: {
    session: {
      create: {
        // Its limits ("Keep me signed in", or a visit), where, and the organisation it starts in.
        before: async (session, ctx) => {
          const now = Date.now();
          let persistent: boolean;
          let expiresAt: Date;
          let maxExpiresAt: Date;
          if (session.impersonatedBy) {
            persistent = false;
            expiresAt = new Date(now + IMPERSONATION_MS);
            maxExpiresAt = expiresAt;
          } else {
            const body = (ctx?.body ?? {}) as { rememberMe?: boolean };
            const dontRemember = ctx ? await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret) : null;
            persistent = body.rememberMe !== false && !dontRemember;
            const limits = sessionLimits(persistent);
            expiresAt = new Date(now + limits.idleMs);
            maxExpiresAt = new Date(now + limits.maxMs);
          }
          const membership = await prisma.organizationMember.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: 'asc' },
            select: { organizationId: true },
          });
          return {
            data: {
              ...session,
              expiresAt,
              maxExpiresAt,
              persistent,
              // Never the address (the privacy page says so).
              ipAddress: null,
              userAgent: session.userAgent ? String(session.userAgent).slice(0, 500) : null,
              location: ctx?.headers ? locationFromHeaders(ctx.headers) : null,
              organizationId: membership?.organizationId ?? null,
            },
          };
        },
        after: async (session) => {
          await logSessionStarted(session as Parameters<typeof logSessionStarted>[0]);
          if (!session.impersonatedBy) {
            await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
          }
        },
      },
      update: {
        // Moved on by Better Auth: never past its hard end.
        after: async (session) => {
          const row = session as typeof session & { maxExpiresAt?: Date | null; persistent?: boolean | null };
          if (row.maxExpiresAt && row.expiresAt > row.maxExpiresAt) {
            await prisma.authSession.update({ where: { id: row.id }, data: { expiresAt: row.maxExpiresAt } });
            row.expiresAt = row.maxExpiresAt;
          }
          await logSessionChanged(row as Parameters<typeof logSessionChanged>[0]);
        },
      },
      delete: {
        before: async (session, ctx) => {
          await logSessionEnded(session as Parameters<typeof logSessionEnded>[0], ctx?.path);
        },
      },
    },
  },

  hooks: {
    // The sign-in lock: refused while locked, before the password is even checked.
    before: createAuthMiddleware(async (ctx) => {
      if (!SIGN_IN_PATHS.has(ctx.path)) return;
      const body = (ctx.body ?? {}) as { email?: string; username?: string };
      const identifier = body.email ?? body.username ?? '';
      const lock = signInLock(cookieJar(ctx), await signInAccount(identifier), identifier);
      if (await isLockedOut(lock.key)) {
        throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many wrong tries.', code: lock.known ? 'LOCKED_HERE' : 'LOCKED' });
      }
    }),
    // Counted when the password was wrong; cleared, and the browser remembered, when it worked.
    after: createAuthMiddleware(async (ctx) => {
      const returned = ctx.context.returned;
      if (SIGN_IN_PATHS.has(ctx.path)) {
        const body = (ctx.body ?? {}) as { email?: string; username?: string };
        const identifier = body.email ?? body.username ?? '';
        const user = await signInAccount(identifier);
        const lock = signInLock(cookieJar(ctx), user, identifier);
        if (returned instanceof APIError) {
          if (returned.statusCode === 401 && (await recordFailedSignIn(lock.key))) {
            throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many wrong tries.', code: lock.known ? 'LOCKED_HERE' : 'LOCKED' });
          }
          return;
        }
        // Past the password; with two-factor on, remembered once the code is right too.
        if (user && !(returned as { twoFactorRedirect?: boolean } | undefined)?.twoFactorRedirect) {
          await clearFailedSignIns(lock.key);
          rememberBrowser(cookieJar(ctx), user);
        }
        return;
      }
      if (ctx.path === '/two-factor/verify-totp' && !(returned instanceof APIError) && ctx.context.newSession) {
        const user = await prisma.user.findUnique({ where: { id: ctx.context.newSession.user.id }, select: { id: true, knownBrowsersVersion: true } });
        if (user) {
          await clearFailedSignIns(signInLock(cookieJar(ctx), user, '').key);
          rememberBrowser(cookieJar(ctx), user);
        }
      }
    }),
  },

  plugins: [
    // Older accounts sign in with a username (`User.identifier`); newer ones' is their email.
    username({
      schema: { user: { fields: { username: 'identifier' } } },
      minUsernameLength: 1,
      maxUsernameLength: 320,
      usernameValidator: () => true,
      usernameNormalization: false,
      displayUsernameNormalization: false,
    }),
    twoFactor({
      issuer: PRODUCT_NAME,
      twoFactorTable: 'authTwoFactor',
      schema: { user: { fields: { twoFactorEnabled: 'totpEnabled' } } },
      // Five wrong codes and the account's codes wait 15 minutes (as with passwords).
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
    }),
    // The platform admin: "log in as" (an hour), switching accounts off, ending anyone's sessions.
    admin({
      defaultRole: 'USER',
      adminRoles: ['SUPERADMIN'],
      roles: { USER: userAc, SUPERADMIN: adminAc },
      impersonationSessionDuration: IMPERSONATION_MS / 1000,
      bannedUserMessage: 'This account is switched off.',
    }),
    // Vercel BotID on signing in and "Forgot your password?", where next.config.js turns
    // CHALKENSO_BOT_CHECK on.
    ...(process.env.CHALKENSO_BOT_CHECK === 'on'
      ? [captcha({ provider: 'vercel-botid', endpoints: BOT_CHECKED_AUTH_ENDPOINTS, checkBotId: botVerdict })]
      : []),
    // Last: lets server actions set Better Auth's cookies.
    nextCookies(),
  ],
});

/** The reset link for `email`, made by Better Auth but handed back rather than emailed (for the platform admin). */
export async function makeResetLinkFor(email: string): Promise<string | null> {
  const capture = { link: null as string | null };
  await resetLinkCapture.run(capture, () => auth.api.requestPasswordReset({ body: { email, redirectTo: '/admin/reset-password' } }));
  return capture.link;
}
