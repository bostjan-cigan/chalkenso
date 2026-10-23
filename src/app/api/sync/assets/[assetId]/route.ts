import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync, isAssetInCurriculumVersion } from '@/lib/curriculum-sync-read';
import { prisma } from '@/lib/prisma';
import { streamObjectFromR2 } from '@/lib/r2';

export const runtime = 'nodejs';
/**
 * 60s is the hard ceiling some serverless hosts set for a function (their builds reject anything
 * higher), so this is a constraint to fit inside rather than a preference: a long upload or batch has
 * to finish within it. Self-hosted there is no per-request cap at all and this is inert.
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Downloads one image used by a lesson of the requested version, so the Obsidian plugin can restore
 * images missing from the vault after downloading lessons. Assets not referenced by that version are
 * reported as missing, so a version grant never exposes another version's files.
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

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found in this curriculum version.' }, { status: 404 });
  }

  try {
    const object = await streamObjectFromR2(asset.r2Key);

    return new Response(object.body, {
      headers: {
        'Cache-Control': 'private, no-store',
        ...(object.contentLength === null
          ? {}
          : { 'Content-Length': String(object.contentLength) }),
        'Content-Disposition': `attachment; filename="${asset.originalFilename}"`,
        'Content-Type': object.contentType || asset.mimeType || 'application/octet-stream',
      },
      status: 200,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load asset.' },
      { status: 500 }
    );
  }
}
