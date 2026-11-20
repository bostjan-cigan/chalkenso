import 'server-only';

import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { streamObjectFromR2 } from './r2';

/**
 * One of a lesson's own images, from this site instead of the file storage: the PDF export reads the
 * image's bytes in the browser, which the storage's own address doesn't allow from another site.
 * `src` is the image's address as the lesson's HTML has it (a signed storage address, a local file
 * address or the admin's `/admin/api/assets/<id>`); it is never fetched, only matched against the
 * images this lesson uses. The caller has checked that the reader may read `lesson`.
 */
export async function lessonImageResponse(lesson: { id: string; curriculumVersionId: string; published?: boolean }, src: string) {
  let path: string;
  try {
    path = decodeURIComponent(new URL(src, 'http://localhost').pathname);
  } catch {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }
  const references = await prisma.lessonAssetReference.findMany({
    where: {
      assetId: { not: null },
      lesson: { id: lesson.id, curriculumVersionId: lesson.curriculumVersionId, ...(lesson.published ? { publishedAt: { not: null } } : {}) },
    },
    select: { asset: { select: { id: true, r2Key: true, mimeType: true } } },
  });
  const asset = references.map((reference) => reference.asset).find((entry) => entry && (path.endsWith(`/${entry.r2Key}`) || path === `/admin/api/assets/${entry.id}`));
  if (!asset) {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }
  try {
    const object = await streamObjectFromR2(asset.r2Key);
    return new Response(object.body, {
      headers: {
        'Cache-Control': 'private, no-store',
        ...(object.contentLength === null ? {} : { 'Content-Length': String(object.contentLength) }),
        'Content-Type': object.contentType || asset.mimeType || 'application/octet-stream',
        // Bytes for the export's own reading, never a page.
        'Content-Disposition': 'attachment',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }
}
