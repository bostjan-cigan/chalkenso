import 'server-only';

import { cookies, headers } from 'next/headers';
import { after } from 'next/server';
import { SESSION_COOKIE_NAMES } from './admin-auth';
import { prisma } from './prisma';

/** Better Auth's admin plugin keeps the platform admin's own session here during a visit. */
const ADMIN_SESSION_COOKIES = ['cai.admin_session', '__Secure-cai.admin_session'];

/**
 * The trail of a "log in as" visit: every database write made while a platform admin is logged in
 * as someone becomes an `ImpersonationChange`, whatever page, action or route made it. `prisma.ts`
 * calls `noteWrite` after each successful write; only requests carrying the admin's own session cookie
 * (that is, a visit) go further, so everyone else's writes cost a cookie lookup. The rows are
 * written after the response, one batch per request.
 *
 * What is kept: the record (model, id, its title or name), the operation, the fields written and
 * the page it was done from. Never the values: lesson text and settings stay out of the log, and
 * rows stay small.
 */

/** Bookkeeping, not changes: sessions, activity days, the logs themselves, sign-in challenges, caches. */
const UNLOGGED_MODELS = new Set([
  'UserSession',
  'UserActivityDay',
  'PlatformAuditEvent',
  'ImpersonationChange',
  'GroupAssetUrlCache',
  // Better Auth's own bookkeeping (src/lib/auth.ts).
  'AuthSession',
  'AuthAccount',
  'AuthVerification',
  'AuthTwoFactor',
  'AuthRateLimit',
  'RateLimit',
]);

/** Fields every write touches by itself. */
const IGNORED_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

type Change = {
  model: string;
  operation: string;
  recordId: string | null;
  label: string | null;
  fields: string[];
  count: number;
  path: string | null;
  createdAt: Date;
};

/** Changes waiting for their request to finish, by session (token hash). */
const pending = new Map<string, Change[]>();

const asRecord = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function describe(model: string, operation: string, args: unknown, result: unknown, referer: string | null): Change {
  const input = asRecord(args) ?? {};
  const payloads = [input.data, input.create, input.update].flatMap((payload) => (Array.isArray(payload) ? payload : payload ? [payload] : []));
  const fields = Array.from(new Set(payloads.flatMap((row) => Object.keys(asRecord(row) ?? {})))).filter((field) => !IGNORED_FIELDS.has(field));
  const row = asRecord(result);
  const where = asRecord(input.where);
  // Its title or name: from what the write returned, or else from what it wrote.
  const label = [row, ...payloads.map(asRecord)]
    .flatMap((record) => [record?.title, record?.name, record?.fullName, record?.label])
    .find((value): value is string => typeof value === 'string' && value.length > 0);
  let path: string | null = null;
  try {
    path = referer ? new URL(referer).pathname.slice(0, 200) : null;
  } catch {
    path = null;
  }
  return {
    model,
    operation,
    recordId: typeof row?.id === 'string' ? row.id : typeof where?.id === 'string' ? where.id : null,
    label: label ? label.slice(0, 120) : null,
    fields: fields.slice(0, 30),
    count: Array.isArray(result) ? result.length : typeof row?.count === 'number' ? row.count : Array.isArray(input.data) ? input.data.length : 1,
    path,
    createdAt: new Date(),
  };
}

/** Called by `prisma.ts` after every successful write. Never throws, never slows anyone else down. */
export async function noteWrite(model: string, operation: string, args: unknown, result: unknown) {
  if (UNLOGGED_MODELS.has(model)) {
    return;
  }
  try {
    const jar = await cookies();
    // Better Auth's session cookie is the token and its signature.
    const token = SESSION_COOKIE_NAMES.map((name) => jar.get(name)?.value).find(Boolean)?.split('.')[0];
    if (!token || !ADMIN_SESSION_COOKIES.some((name) => jar.has(name))) {
      return;
    }
    const change = describe(model, operation, args, result, (await headers()).get('referer'));
    const key = token;
    const queue = pending.get(key);
    if (queue) {
      queue.push(change);
      return;
    }
    after(() => flush(key));
    pending.set(key, [change]);
  } catch {
    // Outside a request (scripts, build): nobody is logged in as anyone.
  }
}

/** Writes a request's changes, once its response is out, if the session really is a visit. */
async function flush(key: string) {
  const changes = pending.get(key);
  pending.delete(key);
  if (!changes?.length) {
    return;
  }
  try {
    const session = await prisma.authSession.findUnique({
      where: { token: key },
      select: { id: true, userId: true, impersonatedBy: true, organizationId: true },
    });
    const actorId = session?.impersonatedBy;
    if (!session || !actorId) {
      return;
    }
    await prisma.impersonationChange.createMany({
      data: changes.map((change) => ({ ...change, sessionId: session.id, actorId, userId: session.userId, organizationId: session.organizationId })),
    });
  } catch (error) {
    console.error(`[log in as] ${changes.length} changes were not recorded`, error);
  }
}
