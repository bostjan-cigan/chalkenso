import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import { authorizeCurriculumSync } from '@/lib/curriculum-sync-read';
import { uploadSyncAsset, type UploadSyncAssetInput } from '@/lib/sync-assets';

export const runtime = 'nodejs';
/**
 * 60s is the hard ceiling some serverless hosts set for a function (their builds reject anything
 * higher), so this is a constraint to fit inside rather than a preference: a long upload or batch has
 * to finish within it. Self-hosted there is no per-request cap at all and this is inert.
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Uploads one image referenced by a lesson note, returning its `assetId` for the caller to bind
 * via `assetBindings` when creating the lesson.
 *
 * Auth: `Authorization: Bearer <token>` with WRITE on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id` (required: a token acts as its owner and may reach several).
 * Body: `{ filename, contentType, dataBase64, sourcePath? }`.
 */
export async function POST(request: Request) {
  const auth = await authorizeCurriculumSync(request, [Permission.WRITE]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  let payload: UploadSyncAssetInput;

  try {
    payload = (await request.json()) as UploadSyncAssetInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const result = await uploadSyncAsset(payload, { organizationId: auth.organizationId, courseId: auth.courseId });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      asset: {
        assetId: result.assetId,
        sourcePath: result.sourcePath,
        originalFilename: result.originalFilename,
        bytes: result.bytes,
      },
    },
    { status: 201 }
  );
}
