import { NextResponse } from 'next/server';
import { readLocalObject, verifyLocalSignature, writeLocalObject } from '@/lib/local-storage';
import { isR2Configured } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Largest object the local store accepts through a signed PUT (matches the sync upload cap). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type Params = { params: Promise<{ key: string[] }> };

async function keyOf(params: Params['params']) {
  const { key } = await params;
  return key.map((part) => decodeURIComponent(part)).join('/');
}

/** Serves an object from the local store to whoever holds a valid signed URL. */
export async function GET(request: Request, { params }: Params) {
  if (isR2Configured()) {
    return new NextResponse('Not found', { status: 404 });
  }
  const key = await keyOf(params);
  const search = new URL(request.url).searchParams;
  if (!verifyLocalSignature('GET', key, search)) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  try {
    const object = await readLocalObject(key);
    const headers = new Headers({
      'Content-Type': search.get('ct') || object.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
      // A stored file is shown, never run: opened on its own (an SVG is a document), nothing in it
      // may script, frame or load from elsewhere, on this origin.
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    const filename = search.get('fn');
    if (filename) {
      headers.set('Content-Disposition', `attachment; filename="${filename.replace(/["\\\r\n]/g, '')}"`);
    }
    return new NextResponse(new Uint8Array(object.body), { headers });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}

/** Receives an upload to a signed PUT URL (the local counterpart of a presigned R2 upload). */
export async function PUT(request: Request, { params }: Params) {
  if (isR2Configured()) {
    return new NextResponse('Not found', { status: 404 });
  }
  const key = await keyOf(params);
  const search = new URL(request.url).searchParams;
  if (!verifyLocalSignature('PUT', key, search)) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const signedType = search.get('ct');
  const contentType = request.headers.get('content-type');
  if (signedType && contentType !== signedType) {
    return new NextResponse('Content type does not match the signed upload.', { status: 400 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return new NextResponse('Too large.', { status: 413 });
  }
  await writeLocalObject(key, body, {
    contentType: contentType ?? null,
    cacheControl: 'public, max-age=31536000, immutable',
  });
  return new NextResponse(null, { status: 200 });
}
