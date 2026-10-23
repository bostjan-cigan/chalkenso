import { NextResponse } from 'next/server';
import { Permission } from '@prisma/client';
import {
  authorizeCurriculumSync,
  getCurriculumSyncManifest,
} from '@/lib/curriculum-sync-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-side snapshot for the Obsidian sync plugin: the requested curriculum version with its arcs
 * and lessons (each with its `revision`). With `?include=content`, lessons also carry their markdown,
 * arc title and uploaded image references, so the plugin can download them into the vault.
 *
 * `?since=<ISO timestamp>` narrows only the heavy part: every lesson still appears in the list (so
 * deletions are still detected by absence), but bodies are sent only for lessons changed since
 * then. Omit it and the response is exactly what it always was. The response carries `syncedAt` to
 * send back next time, and an `ETag` — pass it as `If-None-Match` and an unchanged curriculum
 * answers 304 with no body at all.
 *
 * Auth: `Authorization: Bearer <token>` with READ on the target version, named by
 * `?versionId=` or `X-Curriculum-Version-Id` (required: a token acts as its owner and may reach several).
 */
export async function GET(request: Request) {
  const auth = await authorizeCurriculumSync(request, [Permission.READ]);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, reason: auth.reason }, { status: auth.status });
  }

  const params = new URL(request.url).searchParams;
  const includeContent = params.get('include') === 'content';

  const rawSince = params.get('since');
  const since = rawSince ? new Date(rawSince) : null;
  if (since && Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: 'since must be an ISO timestamp.' }, { status: 400 });
  }

  const manifest = await getCurriculumSyncManifest(auth.versionId, { includeContent, since });

  if (!manifest) {
    return NextResponse.json(
      { error: 'Curriculum version no longer exists.' },
      { status: 404 }
    );
  }

  // Nothing has moved since the client last looked, so there is no point sending the snapshot.
  if (request.headers.get('if-none-match') === manifest.etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: manifest.etag, 'Cache-Control': 'private, no-store' },
    });
  }

  return NextResponse.json(manifest, {
    headers: { ETag: manifest.etag, 'Cache-Control': 'private, no-store' },
  });
}
