import 'server-only';

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { MINUTE, hashForLimits } from './rate-limit';
import { prisma } from './prisma';
import { hashSessionToken } from './security';
import { isUniqueViolation } from './unique-retry';

/**
 * Locking out password guessing without letting anyone lock you out (OWASP's "device cookies"),
 * on top of Better Auth's sign-in (its hooks in src/lib/auth.ts call these).
 *
 * A browser that has signed in to an account is remembered for it (a signed cookie, one per
 * account). Browsers the account hasn't been used on share one lock per account: the 5th wrong
 * password within 15 minutes of the first locks them all for 15 minutes from then, the right
 * password included. A remembered browser has its own lock and is never stopped by someone else's
 * guesses, nor counted by Better Auth's per-address limit. Someone on a new browser during an attack
 * gets in with "Forgot your password?": finishing a reset ends the locks and remembers that browser.
 * "Sign out of all devices" forgets every browser (the account's `knownBrowsersVersion` is part of
 * each cookie's signature). Wrong two-factor codes are Better Auth's own lockout.
 *
 * Counts are kept in `rate_limits`, so every server instance sees them. They never depend on the
 * visitor's address (which a self-hosted install may not be able to trust), and this machine isn't
 * exempt. An email without an account locks the same way, so the lock never tells which emails
 * have one.
 */

export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_MS = 15 * MINUTE;

const KNOWN_PREFIX = 'cai_known_';
const KNOWN_TTL_MS = 365 * 24 * 60 * MINUTE;

/** Reading and writing this request's cookies: Better Auth's endpoint context, or Next's cookie store. */
export type CookieJar = {
  get(name: string): string | undefined;
  set(name: string, value: string, options: { httpOnly: boolean; sameSite: 'lax'; secure: boolean; path: string; maxAge: number }): void;
};

/** The lock shared by every browser the account hasn't been used on. */
export function accountLockKey(userId: string) {
  return `signin-lock:user:${userId}`;
}

/** The start of every remembered browser's own lock for `userId`. */
export function knownBrowserLockPrefix(userId: string) {
  return `signin-lock:known:${userId}:`;
}

/** The cookie that remembers this browser for `userId`: one per account, its name telling nothing. */
function knownCookieName(userId: string) {
  return `${KNOWN_PREFIX}${hashSessionToken(`known-device-name:${userId}`).slice(0, 16)}`;
}

/** The account a remembered browser is for: its id, and which round of remembered browsers counts. */
export type BrowserAccount = { id: string; knownBrowsersVersion: number };

const signature = (user: BrowserAccount, nonce: string) =>
  hashSessionToken(`known-device:${user.id}:${user.knownBrowsersVersion}:${nonce}`);

/** `<user id>.<nonce>.<signature>`, when genuine for that account's current round. */
function verify(value: string, user: BrowserAccount): string | null {
  const [userId, nonce, given] = value.split('.');
  if (userId !== user.id || !nonce || !given) {
    return null;
  }
  const expected = Buffer.from(signature(user, nonce));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? nonce : null;
}

/** This browser's id for the account when it has signed in to it before (since it last forgot its browsers). */
function knownBrowser(jar: Pick<CookieJar, 'get'>, user: BrowserAccount): string | null {
  return verify(jar.get(knownCookieName(user.id)) ?? '', user);
}

/**
 * Which lock an attempt counts against: the browser's own when it has signed in to this account
 * before (`known`), the account's for any other browser, or what was typed when there's no such
 * account.
 */
export function signInLock(jar: Pick<CookieJar, 'get'>, user: BrowserAccount | null, identifier: string): { key: string; known: boolean } {
  if (!user) {
    return { key: `signin-lock:name:${hashForLimits(identifier.trim().toLowerCase())}`, known: false };
  }
  const browser = knownBrowser(jar, user);
  return browser
    ? { key: `${knownBrowserLockPrefix(user.id)}${hashForLimits(browser)}`, known: true }
    : { key: accountLockKey(user.id), known: false };
}

/**
 * Whether a request comes from a browser some account has signed in on (Better Auth's per-address
 * sign-in limit leaves those alone, so one person can't use up a school's address for everyone).
 */
export async function fromRememberedBrowser(cookieHeader: string | null): Promise<boolean> {
  const values = (cookieHeader ?? '')
    .split(/;\s*/)
    .filter((pair) => pair.startsWith(KNOWN_PREFIX))
    .map((pair) => decodeURIComponent(pair.slice(pair.indexOf('=') + 1)))
    .slice(0, 5);
  for (const value of values) {
    const user = await prisma.user.findUnique({ where: { id: value.split('.')[0] ?? '' }, select: { id: true, knownBrowsersVersion: true } });
    if (user && verify(value, user)) {
      return true;
    }
  }
  return false;
}

/** After signing in (or setting a new password from a reset link) here: remember this browser for the account. */
export function rememberBrowser(jar: CookieJar, user: BrowserAccount) {
  const nonce = knownBrowser(jar, user) ?? randomBytes(16).toString('hex');
  jar.set(knownCookieName(user.id), `${user.id}.${nonce}.${signature(user, nonce)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: KNOWN_TTL_MS / 1000,
  });
}

/** Whether `key` is locked now. */
export async function isLockedOut(key: string): Promise<boolean> {
  const row = await prisma.rateLimit.findUnique({ where: { key }, select: { count: true, expiresAt: true } });
  return Boolean(row && row.count >= LOCKOUT_FAILURES && row.expiresAt > new Date());
}

/**
 * Counts one wrong try against `key`. The count runs for 15 minutes from the first; the try that
 * reaches the limit locks it for 15 minutes from then. Returns whether it is locked now.
 */
export async function recordFailedSignIn(key: string): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LOCKOUT_MS);
  // An old count (or lock) that ran out starts again.
  await prisma.rateLimit.deleteMany({ where: { key, expiresAt: { lte: now } } });
  const count = () =>
    prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, expiresAt: until },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
  let row: { count: number };
  try {
    row = await count();
  } catch (error) {
    // Two wrong tries at once both created it: count on the one that did.
    if (!isUniqueViolation(error)) throw error;
    row = await count();
  }
  if (row.count === LOCKOUT_FAILURES) {
    await prisma.rateLimit.update({ where: { key }, data: { expiresAt: until } });
  }
  return row.count >= LOCKOUT_FAILURES;
}

/**
 * After signing in: the wrong tries counted against the lock that was used no longer count. A
 * remembered browser signing in leaves the account's lock alone, so guessing elsewhere doesn't
 * start again.
 */
export async function clearFailedSignIns(key: string) {
  await prisma.rateLimit.deleteMany({ where: { key } });
}

/** A new password: every lock on the account ends (the account's, and each browser's own). */
export async function clearAllSignInLocks(userId: string) {
  await prisma.rateLimit.deleteMany({ where: { OR: [{ key: accountLockKey(userId) }, { key: { startsWith: knownBrowserLockPrefix(userId) } }] } });
}
