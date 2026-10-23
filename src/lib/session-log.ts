import 'server-only';

import { prisma } from './prisma';
import type { SessionEndReason } from './session-limits';

/**
 * The history of sessions: every sign-in and "log in as" visit, and how it ended.
 * Better Auth keeps only open sessions (`AuthSession`, deleted as they end); its database hooks
 * (src/lib/auth.ts) mirror each one here, under the same id, and say how it ended.
 */

type AuthSessionRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt?: Date;
  userAgent?: string | null;
  maxExpiresAt?: Date | null;
  persistent?: boolean | null;
  location?: string | null;
  organizationId?: string | null;
  impersonatedBy?: string | null;
};

/** Better Auth's endpoints that end a session, and what the history calls it. */
const ENDED_BY: Array<[RegExp, SessionEndReason]> = [
  [/^\/sign-out$/, 'signout'],
  [/^\/admin\/stop-impersonating$/, 'signout'],
  [/^\/revoke-(session|sessions|other-sessions)$/, 'self'],
  [/^\/admin\/ban-user$/, 'deactivated'],
  [/^\/admin\/(revoke-user-session|revoke-user-sessions|remove-user)$/, 'platform'],
  [/^\/reset-password$/, 'password'],
];

export async function logSessionStarted(session: AuthSessionRow) {
  await prisma.userSession.create({
    data: {
      id: session.id,
      userId: session.userId,
      impersonatorId: session.impersonatedBy ?? null,
      organizationId: session.organizationId ?? null,
      expiresAt: session.expiresAt,
      maxExpiresAt: session.maxExpiresAt ?? session.expiresAt,
      persistent: Boolean(session.persistent),
      userAgent: session.userAgent || null,
      location: session.location ?? null,
      createdAt: session.createdAt ?? new Date(),
    },
  });
}

/** Moved on, or switched organisation. */
export async function logSessionChanged(session: AuthSessionRow) {
  await prisma.userSession.updateMany({
    where: { id: session.id },
    data: { expiresAt: session.expiresAt, organizationId: session.organizationId ?? null },
  });
}

/**
 * Better Auth is deleting it: expired (the history keeps its end as it was), or ended early by
 * someone, said by the endpoint that did it. A caller outside Better Auth's endpoints (signing a
 * member out of an organisation) writes its own reason first; the first reason stays.
 */
export async function logSessionEnded(session: AuthSessionRow, path: string | undefined) {
  const now = new Date();
  if (session.expiresAt <= now) {
    return;
  }
  const reason = ENDED_BY.find(([pattern]) => path && pattern.test(path))?.[1] ?? null;
  await prisma.userSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now } });
  if (reason) {
    await prisma.userSession.updateMany({ where: { id: session.id, endedReason: null }, data: { endedReason: reason } });
  }
}

/** Before ending sessions outside Better Auth's endpoints: the reason their history gives. */
export async function noteEndReason(sessionIds: string[], reason: SessionEndReason) {
  if (sessionIds.length) {
    await prisma.userSession.updateMany({ where: { id: { in: sessionIds }, endedReason: null }, data: { endedReason: reason } });
  }
}
