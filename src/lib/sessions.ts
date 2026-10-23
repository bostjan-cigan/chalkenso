import 'server-only';

import { authHeaders } from './admin-auth';
import { auth } from './auth';
import { prisma } from './prisma';
import { describeDevice, type SessionDevice } from './session-device';

/**
 * "Where you're signed in": a person's open sessions, as their Profile lists them, and ending them,
 * through Better Auth's own session APIs. "Log in as" visits are the platform's, not theirs: never
 * listed here.
 */

export type OpenSession = {
  id: string;
  device: SessionDevice;
  location: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  /** When it ends without activity, and at the latest. */
  expiresAt: Date;
  maxExpiresAt: Date;
  persistent: boolean;
  /** This browser. */
  current: boolean;
};

type ListedSession = {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  maxExpiresAt?: Date | null;
  persistent?: boolean | null;
  location?: string | null;
  impersonatedBy?: string | null;
};

/** The person's sessions, as Better Auth lists them (open ones only), without "log in as" visits. */
async function listed(): Promise<ListedSession[]> {
  const sessions = (await auth.api.listSessions({ headers: await authHeaders() })) as unknown as ListedSession[];
  return sessions.filter((session) => !session.impersonatedBy);
}

/** The person's open sessions: this browser first, then the most recently active. */
export async function listOpenSessions(currentSessionId: string): Promise<OpenSession[]> {
  const sessions = await listed();
  const history = new Map(
    (await prisma.userSession.findMany({ where: { id: { in: sessions.map((session) => session.id) } }, select: { id: true, lastSeenAt: true } })).map(
      (row) => [row.id, row.lastSeenAt]
    )
  );
  return sessions
    .map((session) => ({
      id: session.id,
      device: describeDevice(session.userAgent),
      location: session.location ?? null,
      createdAt: session.createdAt,
      lastSeenAt: history.get(session.id) ?? null,
      expiresAt: session.expiresAt,
      maxExpiresAt: session.maxExpiresAt ?? session.expiresAt,
      persistent: Boolean(session.persistent),
      current: session.id === currentSessionId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.lastSeenAt ?? b.createdAt).getTime() - (a.lastSeenAt ?? a.createdAt).getTime());
}

/** Ends one of the person's own sessions (not this browser's: that is "Sign out"). */
export async function endOwnSession(currentSessionId: string, sessionId: string): Promise<boolean> {
  if (sessionId === currentSessionId) {
    return false;
  }
  const session = (await listed()).find((entry) => entry.id === sessionId);
  if (!session) {
    return false;
  }
  await auth.api.revokeSession({ body: { token: session.token }, headers: await authHeaders() });
  return true;
}

/**
 * "Sign out of all devices" (theirs, or the superadmin's "Sign out everywhere" for them): every
 * remembered browser is forgotten too, so each one counts as new to the sign-in lock again.
 */
export async function forgetRememberedBrowsers(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { knownBrowsersVersion: { increment: 1 } } });
}
