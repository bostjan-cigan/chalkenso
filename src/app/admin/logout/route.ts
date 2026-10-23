import { NextResponse } from 'next/server';
import { getCurrentUserSession, revokeCurrentAdminSession, authHeaders } from '@/lib/admin-auth';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/logout — signs this browser out through Better Auth (its session and cookie). While a
 * platform admin is logged in as someone, the visit ends first and their own session comes back,
 * and this runs again for it: signing out means signing out completely.
 */
export async function GET(request: Request) {
  const session = await getCurrentUserSession();
  if (session?.user.impersonator) {
    await auth.api.stopImpersonating({ headers: await authHeaders() }).catch(() => null);
    return NextResponse.redirect(new URL('/admin/logout', request.url));
  }
  await revokeCurrentAdminSession();
  return NextResponse.redirect(new URL('/admin/login', request.url));
}
