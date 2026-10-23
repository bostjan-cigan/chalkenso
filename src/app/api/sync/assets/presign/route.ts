import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';
import { presignSyncAssetUpload, type PresignSyncAssetInput } from '@/lib/sync-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 1 of a direct-to-R2 upload. The client hashes the image locally and declares it here; an
 * image already on the server comes back as `reused` and never needs transferring. Anything new
 * gets a short-lived presigned PUT, followed by the `complete` endpoint.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE on the target version.
 * Body: `{ filename, contentType, bytes, checksum, sourcePath? }`.
 */
export async function POST(request: Request) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  let payload: PresignSyncAssetInput;
  try {
    payload = (await request.json()) as PresignSyncAssetInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const result = await presignSyncAssetUpload(payload, { organizationId: auth.organizationId, courseId: auth.courseId });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}
