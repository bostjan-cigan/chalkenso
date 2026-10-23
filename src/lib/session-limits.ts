/**
 * How long a session lasts (src/lib/auth.ts applies it). Every session ends after `idle` without
 * activity (each visit, and the open page while someone works in it, moves that on) and at the
 * latest `max` after signing in, however active. "Keep me signed in" chooses the longer pair and a
 * cookie that outlives the browser; without it the cookie goes when the browser closes. "Log in
 * as" visits last an hour, never moved on.
 */

const HOUR_MS = 1000 * 60 * 60;
const DAY_MS = 24 * HOUR_MS;

export const SESSION_LIMITS = {
  kept: { idleMs: 14 * DAY_MS, maxMs: 30 * DAY_MS },
  short: { idleMs: 2 * HOUR_MS, maxMs: 12 * HOUR_MS },
} as const;

export const IMPERSONATION_MS = HOUR_MS;

export function sessionLimits(persistent: boolean) {
  return persistent ? SESSION_LIMITS.kept : SESSION_LIMITS.short;
}

/** The idle end after activity now: `idle` from now, never past the hard end. */
export function nextIdleEnd(session: { persistent: boolean; maxExpiresAt: Date }, now = new Date()) {
  return new Date(Math.min(now.getTime() + sessionLimits(session.persistent).idleMs, session.maxExpiresAt.getTime()));
}

/** Why a session ended early, kept in its history (`UserSession.endedReason`). */
export type SessionEndReason = 'signout' | 'self' | 'organization' | 'platform' | 'password' | 'deactivated';
