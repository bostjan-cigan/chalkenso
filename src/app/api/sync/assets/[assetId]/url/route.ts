import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync, isAssetInCurriculumVersion } from '@/lib/curriculum-sync-read';
import { prisma } from '@/lib/prisma';
import { SYNC_ASSET_URL_TTL_SECONDS, getSignedR2DownloadUrl } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A short-lived URL for one image of the requested version, so the plugin downloads it straight
 * from R2 instead of through this function. Same authorization as the byte-proxying sibling route
 * (`../`), which stays in place for older clients.
 *
 * JSON rather than a 302: Obsidian's `requestUrl` does not follow redirects dependably, and an
 * explicit `{ url }` makes the expiry visible to the caller.
 *
 * Auth: `Authorization: Bearer <token>` with READ on the target version, named by `?versionId=` or
 * `X-Curriculum-Version-Id`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const auth = await authorizeCurriculumSync(request, [Permission.READ]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  const { assetId } = await params;

  const asset = (await isAssetInCurriculumVersion(auth.versionId, assetId))
    ? await prisma.mediaAsset.findUnique({
        where: { id: assetId },
        select: { mimeType: true, originalFilename: true, r2Key: true },
      })
    : null;

  if (!asset || asset.r2Key.startsWith('pending/')) {
    return NextResponse.json({ error: 'Asset not found in this curriculum version.' }, { status: 404 });
  }

  const url = await getSignedR2DownloadUrl(asset.r2Key, SYNC_ASSET_URL_TTL_SECONDS, {
    filename: asset.originalFilename,
    contentType: asset.mimeType,
  });

  return NextResponse.json(
    {
      url,
      expiresAt: new Date(Date.now() + SYNC_ASSET_URL_TTL_SECONDS * 1000).toISOString(),
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
