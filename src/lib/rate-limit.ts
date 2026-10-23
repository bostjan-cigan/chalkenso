import 'server-only';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { prisma } from './prisma';
import { isUniqueViolation } from './unique-retry';

/**
 * Limits on the public forms (signing up, password resets and the like), counted in the database so
 * every server instance shares them: each instance has its own memory. Fixed windows: a count
 * starts again when its window ends. Visitors (and emails) are counted by a salted hash, never the
 * address itself.
 *
 * A request from this machine (development, the tests) isn't limited: on a hosting platform the
 * visitor's address is always the real, public one.
 */

export type Limit = { name: string; max: number; windowMs: number };

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Whether an address is this machine's own. */
export function isLoopback(address: string | null | undefined): boolean {
  return Boolean(address && LOOPBACK.has(address));
}

/** A salted hash of an address or an email: enough to count repeats, useless for anything else. */
export function hashForLimits(value: string | null) {
  if (!value) return null;
  const salt = process.env.SESSION_SECRET || 'chalkenso-waitlist';
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);
}

/** The visitor's address (the first in `x-forwarded-for`, which the proxy in front sets), or null. */
export async function visitorAddress(): Promise<string | null> {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || requestHeaders.get('x-real-ip') || null;
}

/** Who to count a public form's request against: the hashed address, or null on this machine. */
export async function visitorKey(): Promise<string | null> {
  const address = await visitorAddress();
  return address && !isLoopback(address) ? hashForLimits(address) : null;
}

/**
 * Counts one more for `subject` (a `visitorKey()`, a hashed email) and says whether it's still within
 * `limit` in the current window. No subject (this machine) is always within it.
 */
export async function withinLimit(limit: Limit, subject: string | null): Promise<boolean> {
  if (!subject) return true;
  const now = Date.now();
  const window = Math.floor(now / limit.windowMs);
  const key = `${limit.name}:${subject}:${window}`;
  const expiresAt = new Date((window + 1) * limit.windowMs);
  const count = () =>
    prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, expiresAt },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
  let row: { count: number };
  try {
    row = await count();
  } catch (error) {
    // Two requests creating the same row at once: the other one won, so this one counts on it.
    if (!isUniqueViolation(error)) throw error;
    row = await count();
  }
  // Clearing out old counts now and then is enough: an old window's row is never read again. After
  // the response, so nobody waits for it.
  if (Math.random() < 0.1) {
    after(() => prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => {}));
  }
  return row.count <= limit.max;
}
