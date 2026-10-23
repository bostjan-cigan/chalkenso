import { NextResponse } from 'next/server';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { streamObjectFromR2 } from '@/lib/r2';

export const runtime = 'nodejs';

/** Streams the signed-in user's own profile image from R2. */
export async function GET() {
  const session = await getCurrentUserSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const key = session.user.profileImageKey;

  if (!key) {
    return NextResponse.json({ error: 'No profile image.' }, { status: 404 });
  }

  try {
    const object = await streamObjectFromR2(key);

    return new Response(object.body, {
      status: 200,
      headers: {
        // Key is unique per upload and callers cache-bust by it, so the object is immutable.
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
