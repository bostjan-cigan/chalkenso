import { NextResponse } from 'next/server';
import { canViewAsset, getCrmViewer } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { getWindowedSignedR2ObjectUrl } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How long one signed file URL is handed out (it stays valid for one more after that). */
const SIGNED_URL_WINDOW_SECONDS = 60 * 60;

/**
 * Stable URL for an uploaded image (`/media/<assetId>`) for signed-in team members who can see a
 * lesson that uses it. Redirects to a signed storage URL that stays the same for the rest of the
 * signing window, so the browser keeps the image, and this redirect (privately), until it ends.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params;

  const [asset, viewer] = await Promise.all([
    prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { r2Key: true },
    }),
    getCrmViewer(),
  ]);

  if (!asset || asset.r2Key.startsWith('pending/')) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (!(viewer && (await canViewAsset(viewer, assetId)))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const signed = await getWindowedSignedR2ObjectUrl(asset.r2Key, SIGNED_URL_WINDOW_SECONDS);
  const response = NextResponse.redirect(signed.url, 302);
  response.headers.set('Cache-Control', `private, max-age=${signed.freshFor}`);
  response.headers.set('Vary', 'Cookie');
  return response;
}
