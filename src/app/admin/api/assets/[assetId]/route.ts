import { NextResponse } from 'next/server';
import { canViewAsset, getCrmViewer } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { getWindowedSignedR2ObjectUrl } from '@/lib/r2';

export const runtime = 'nodejs';

/** How long one signed file URL is handed out (it stays valid for one more after that). */
const SIGNED_URL_WINDOW_SECONDS = 60 * 60;

/**
 * An uploaded image for team members who may see it (`canViewAsset`). Redirects to a signed file
 * URL instead of passing the bytes through the function. The URL is the same for the rest of the
 * signing window, so the browser keeps the image under it, and keeps this redirect (privately)
 * until the window ends.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params;
  // The image row is read alongside the check (the check doesn't hand it back).
  const [viewer, asset] = await Promise.all([
    getCrmViewer(),
    prisma.mediaAsset.findUnique({
      where: {
        id: assetId,
      },
      select: {
        originalFilename: true,
        r2Key: true,
      },
    }),
  ]);

  if (!viewer || !(await canViewAsset(viewer, assetId))) {
    return NextResponse.json(
      {
        error: 'Unauthorized.',
      },
      { status: 401 }
    );
  }

  if (!asset) {
    return NextResponse.json(
      {
        error: 'Asset not found.',
      },
      { status: 404 }
    );
  }

  try {
    const signed = await getWindowedSignedR2ObjectUrl(asset.r2Key, SIGNED_URL_WINDOW_SECONDS, {
      filename: asset.originalFilename,
    });
    const response = NextResponse.redirect(signed.url, 302);
    response.headers.set('Cache-Control', `private, max-age=${signed.freshFor}`);
    response.headers.set('Vary', 'Cookie');
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to load asset.',
      },
      { status: 500 }
    );
  }
}
