import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';
import { completeSyncAssetUpload } from '@/lib/sync-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 2 of a direct-to-R2 upload: confirms the object landed and turns the pending row into a
 * usable asset. Returns the same `{ asset }` shape as the base64 upload route, so the caller binds
 * it to a lesson the same way.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE on the target version.
 * Body: `{ checksum, sourcePath? }`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  let payload: { checksum?: unknown; sourcePath?: unknown };
  try {
    payload = (await request.json()) as { checksum?: unknown; sourcePath?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const { assetId } = await params;
  const result = await completeSyncAssetUpload(assetId, payload);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ asset: result }, { status: 201 });
}
