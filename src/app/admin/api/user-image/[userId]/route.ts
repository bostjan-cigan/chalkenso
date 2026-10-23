import { NextResponse } from 'next/server';
import { canAccessSection } from '@/lib/permissions';
import { getCrmViewer, hasAnyAccess } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { streamObjectFromR2 } from '@/lib/r2';

export const runtime = 'nodejs';

/** Streams a given user's profile image from R2 (admin-gated), for avatars in the CRM. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  // Avatars on the task board and assignee lists, for anyone who reaches some course or group, and
  // for the users section's people cards.
  const viewer = await getCrmViewer();

  if (!viewer || !(canAccessSection(viewer, 'users') || hasAnyAccess(viewer))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { profileImageKey: true },
  });

  if (!user?.profileImageKey) {
    return NextResponse.json({ error: 'No profile image.' }, { status: 404 });
  }

  try {
    const object = await streamObjectFromR2(user.profileImageKey);

    return new Response(object.body, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=31536000, immutable',
        ...(object.contentLength === null
          ? {}
          : { 'Content-Length': String(object.contentLength) }),
        'Content-Type': object.contentType || 'application/octet-stream',
        ...(object.etag ? { ETag: object.etag } : {}),
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load image.' },
      { status: 500 }
    );
  }
}
