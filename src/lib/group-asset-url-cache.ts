import 'server-only';

import { prisma } from './prisma';
import { getSignedR2ObjectUrl } from './r2';

const GROUP_ASSET_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
const GROUP_ASSET_URL_REFRESH_BUFFER_SECONDS = 60 * 5;

interface GetCachedGroupAssetUrlInput {
  assetId: string;
  groupId: string;
  r2Key: string;
}

export async function getCachedGroupAssetUrl(
  input: GetCachedGroupAssetUrlInput
): Promise<string> {
  const urls = await getCachedGroupAssetUrls(input.groupId, [
    { assetId: input.assetId, r2Key: input.r2Key },
  ]);

  return urls.get(input.assetId) as string;
}

/**
 * Batched form of {@link getCachedGroupAssetUrl}: resolves every asset in one cache read, signs
 * only the ones that are missing or about to expire, and writes them back in two statements
 * regardless of how many there are. A lesson with N images costs a constant number of queries
 * instead of N (plus N upserts).
 */
export async function getCachedGroupAssetUrls(
  groupId: string,
  assets: { assetId: string; r2Key: string }[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  // Distinct assets only: the same image may be referenced several times in one lesson.
  const r2KeyByAssetId = new Map(assets.map((asset) => [asset.assetId, asset.r2Key]));
  if (r2KeyByAssetId.size === 0) {
    return resolved;
  }

  const assetIds = Array.from(r2KeyByAssetId.keys());
  const refreshThreshold = new Date(
    Date.now() + GROUP_ASSET_URL_REFRESH_BUFFER_SECONDS * 1000
  );

  const cached = await prisma.groupAssetUrlCache.findMany({
    where: { groupId, assetId: { in: assetIds } },
    select: { assetId: true, expiresAt: true, signedUrl: true },
  });

  const stale: string[] = [];
  for (const row of cached) {
    if (row.expiresAt > refreshThreshold) {
      resolved.set(row.assetId, row.signedUrl);
    } else {
      stale.push(row.assetId);
    }
  }

  const missing = assetIds.filter((assetId) => !resolved.has(assetId));
  if (missing.length === 0) {
    return resolved;
  }

  // Signing is local crypto, not an R2 call, so these cost nothing but CPU.
  const expiresAt = new Date(Date.now() + GROUP_ASSET_URL_TTL_SECONDS * 1000);
  const signed = await Promise.all(
    missing.map(async (assetId) => ({
      assetId,
      signedUrl: await getSignedR2ObjectUrl(
        r2KeyByAssetId.get(assetId) as string,
        GROUP_ASSET_URL_TTL_SECONDS
      ),
    }))
  );

  for (const row of signed) {
    resolved.set(row.assetId, row.signedUrl);
  }

  // Two statements instead of one upsert per asset. A concurrent render may race us here; either
  // side's URL is equally valid, and `skipDuplicates` keeps the loser from throwing.
  if (stale.length > 0) {
    await prisma.groupAssetUrlCache.deleteMany({
      where: { groupId, assetId: { in: stale } },
    });
  }
  await prisma.groupAssetUrlCache.createMany({
    data: signed.map((row) => ({
      assetId: row.assetId,
      expiresAt,
      groupId,
      signedUrl: row.signedUrl,
    })),
    skipDuplicates: true,
  });

  return resolved;
}
