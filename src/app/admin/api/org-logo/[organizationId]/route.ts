import { NextResponse } from 'next/server';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { withoutOrgScope } from '@/lib/org-context';
import { prisma } from '@/lib/prisma';
import { streamObjectFromR2 } from '@/lib/r2';

export const runtime = 'nodejs';

/**
 * Streams an organisation's logo, for its members only (the sidebar's switcher shows the logos of
 * every organisation the person belongs to, not just the current one).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const session = await getCurrentUserSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const { organizationId } = await params;
  const membership = await withoutOrgScope(() =>
    prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: session.user.id } },
      select: { organization: { select: { logoKey: true } } },
    })
  );
  const key = membership?.organization.logoKey;
  if (!key) {
    return NextResponse.json({ error: 'No logo.' }, { status: 404 });
  }
  try {
    const object = await streamObjectFromR2(key);
    return new Response(object.body, {
      status: 200,
      headers: {
        // The key is unique per upload and callers cache-bust by it, so the object is immutable.
        'Cache-Control': 'private, max-age=31536000, immutable',
        ...(object.contentLength === null ? {} : { 'Content-Length': String(object.contentLength) }),
        'Content-Type': object.contentType || 'application/octet-stream',
        ...(object.etag ? { ETag: object.etag } : {}),
        Vary: 'Cookie',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Unable to load the logo.' }, { status: 500 });
  }
}
