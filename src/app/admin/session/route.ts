import { NextResponse } from 'next/server';
import { extendCurrentSession, peekCurrentSession } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

function times(session: { expiresAt: Date; maxExpiresAt: Date } | null) {
  return NextResponse.json(
    session ? { active: true, expiresAt: session.expiresAt.toISOString(), maxExpiresAt: session.maxExpiresAt.toISOString() } : { active: false },
    { headers: NO_STORE }
  );
}

/**
 * GET /admin/session — when the current session ends (without activity, and at the latest), read
 * without counting as activity. For the open page's "Still there?" (SessionKeeper).
 */
export async function GET() {
  return times(await peekCurrentSession());
}

/**
 * POST /admin/session — "Stay signed in", or someone working on the open page: moves the session's
 * idle end on (never past its hard end). Other sites can't: the session cookie is SameSite=Lax, so
 * their requests here come without it.
 */
export async function POST() {
  return times(await extendCurrentSession());
}
