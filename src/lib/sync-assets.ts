import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import {
  SYNC_ASSET_URL_TTL_SECONDS,
  buildCourseAssetKey,
  courseAssetPrefix,
  deleteObjectFromR2,
  downloadObjectFromR2,
  getSignedR2UploadUrl,
  headObjectInR2,
  safeImageBuffer,
  uploadImageToR2,
  UnsafeImageError,
  type CourseAssetScope,
} from './r2';
import { isSvgUpload } from './sanitize/svg';

/** Key prefix of an asset whose object isn't confirmed yet; the rest is where it will live. */
const PENDING_PREFIX = 'pending/';

/** An identical image (same bytes) already stored for this course's lessons, if there is one. */
function findCourseLessonImage(scope: CourseAssetScope, checksum: string) {
  return prisma.mediaAsset.findFirst({
    where: { checksum, r2Key: { startsWith: courseAssetPrefix(scope, 'lessons') } },
    select: { id: true, originalFilename: true, bytes: true },
  });
}

/** Cap on a single synced image; keeps base64 request bodies reasonable. */
const MAX_SYNC_ASSET_BYTES = 10 * 1024 * 1024;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export type UploadSyncAssetInput = {
  filename?: unknown;
  contentType?: unknown;
  dataBase64?: unknown;
  sourcePath?: unknown;
};

export type UploadSyncAssetResult =
  | {
      ok: true;
      assetId: string;
      sourcePath: string | null;
      originalFilename: string;
      bytes: number | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Uploads one image (base64) to R2 and records a `MediaAsset`, mirroring the admin upload route.
 * Returns the new asset id, which the caller binds to a lesson or content entry via `assetBindings`.
 */
export async function uploadSyncAsset(
  input: UploadSyncAssetInput,
  scope: CourseAssetScope
): Promise<UploadSyncAssetResult> {
  const filename = asString(input.filename).trim();
  const contentType = asString(input.contentType).trim() || 'application/octet-stream';
  const dataBase64 = asString(input.dataBase64);
  const sourcePath = asString(input.sourcePath).trim() || null;

  if (!filename) {
    return { ok: false, status: 400, error: 'filename is required.' };
  }
  if (!contentType.startsWith('image/')) {
    return { ok: false, status: 400, error: 'Only image uploads are supported.' };
  }
  if (!dataBase64) {
    return { ok: false, status: 400, error: 'dataBase64 is required.' };
  }

  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.byteLength) {
    return { ok: false, status: 400, error: 'Image data is empty or not valid base64.' };
  }
  if (buffer.byteLength > MAX_SYNC_ASSET_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Image exceeds the ${MAX_SYNC_ASSET_BYTES / (1024 * 1024)}MB limit.`,
    };
  }

  // Reuse an identical image (same bytes) of the same course so re-syncing a note doesn't pile up
  // duplicate assets. Never across courses: every course keeps its own files.
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const existing = await findCourseLessonImage(scope, checksum);
  if (existing) {
    return {
      ok: true,
      assetId: existing.id,
      sourcePath,
      originalFilename: existing.originalFilename,
      bytes: existing.bytes,
    };
  }

  const file = new File([buffer], filename, { type: contentType });
  let createdAssetId: string | null = null;

  try {
    const asset = await prisma.mediaAsset.create({
      data: {
        mimeType: contentType,
        originalFilename: filename,
        r2Key: `${PENDING_PREFIX}${randomUUID()}`,
      },
      select: { id: true },
    });
    createdAssetId = asset.id;

    const uploaded = await uploadImageToR2(file, buildCourseAssetKey(scope, 'lessons', asset.id, filename));

    const updated = await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        bytes: uploaded.bytes,
        // The checksum of what the client has (an SVG is stored cleaned), so the next sync of the
        // same file is recognised.
        checksum,
        mimeType: uploaded.mimeType,
        originalFilename: uploaded.originalFilename,
        r2Key: uploaded.key,
      },
      select: { id: true, bytes: true, originalFilename: true },
    });

    return {
      ok: true,
      assetId: updated.id,
      sourcePath,
      originalFilename: updated.originalFilename,
      bytes: updated.bytes,
    };
  } catch (error) {
    if (createdAssetId) {
      await prisma.mediaAsset.delete({ where: { id: createdAssetId } }).catch(() => undefined);
    }
    return {
      ok: false,
      status: error instanceof UnsafeImageError ? 400 : 500,
      error: error instanceof Error ? error.message : 'Upload failed.',
    };
  }
}


// ---------------------------------------------------------------------------------------------
// Direct-to-R2 upload
//
// `uploadSyncAsset` above takes the image as base64 in the request body, which means the bytes are
// inflated by a third, buffered in function memory, and — worst of all — transferred in full
// *before* the checksum is known, so re-syncing a note with unchanged images uploads everything
// only for the server to recognise it and throw it away.
//
// This flow inverts that: the client hashes locally and asks first. A known checksum is answered
// without moving a single byte, and anything genuinely new goes straight to R2 on a presigned PUT.
// ---------------------------------------------------------------------------------------------

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/i;

export type PresignSyncAssetInput = {
  filename?: unknown;
  contentType?: unknown;
  bytes?: unknown;
  checksum?: unknown;
  sourcePath?: unknown;
};

export type PresignSyncAssetResult =
  | {
      ok: true;
      /** The image was already stored: nothing to upload, bind this asset id. */
      reused: true;
      assetId: string;
      sourcePath: string | null;
      originalFilename: string;
      bytes: number | null;
    }
  | {
      ok: true;
      reused: false;
      assetId: string;
      sourcePath: string | null;
      /** PUT the raw bytes here, then call the complete endpoint. */
      uploadUrl: string;
      expiresAt: string;
    }
  | { ok: false; status: number; error: string };

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Validates the declared image and either recognises it or hands back a presigned PUT. */
export async function presignSyncAssetUpload(
  input: PresignSyncAssetInput,
  scope: CourseAssetScope
): Promise<PresignSyncAssetResult> {
  const filename = asString(input.filename).trim();
  const contentType = asString(input.contentType).trim() || 'application/octet-stream';
  const checksum = asString(input.checksum).trim().toLowerCase();
  const bytes = asNumber(input.bytes);
  const sourcePath = asString(input.sourcePath).trim() || null;

  if (!filename) {
    return { ok: false, status: 400, error: 'filename is required.' };
  }
  if (!contentType.startsWith('image/')) {
    return { ok: false, status: 400, error: 'Only image uploads are supported.' };
  }
  if (!CHECKSUM_PATTERN.test(checksum)) {
    return { ok: false, status: 400, error: 'checksum must be a sha256 hex digest.' };
  }
  if (bytes === null || bytes <= 0) {
    return { ok: false, status: 400, error: 'bytes must be the image size in bytes.' };
  }
  if (bytes > MAX_SYNC_ASSET_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Image exceeds the ${MAX_SYNC_ASSET_BYTES / (1024 * 1024)}MB limit.`,
    };
  }

  // Same de-duplication as the base64 path, but before anything is transferred.
  const existing = await findCourseLessonImage(scope, checksum);
  if (existing) {
    return {
      ok: true,
      reused: true,
      assetId: existing.id,
      sourcePath,
      originalFilename: existing.originalFilename,
      bytes: existing.bytes,
    };
  }

  // `checksum` stays null until the object actually lands, so a half-finished upload can never be
  // handed to another caller as an existing asset.
  const asset = await prisma.mediaAsset.create({
    data: {
      bytes,
      mimeType: contentType,
      originalFilename: filename,
      r2Key: `${PENDING_PREFIX}${randomUUID()}`,
    },
    select: { id: true },
  });

  let uploadUrl: string;
  try {
    // The pending key remembers where the object goes, so `complete` looks for it there.
    const key = buildCourseAssetKey(scope, 'lessons', asset.id, filename);
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { r2Key: `${PENDING_PREFIX}${key}` } });
    uploadUrl = await getSignedR2UploadUrl(key, SYNC_ASSET_URL_TTL_SECONDS, { contentType });
  } catch (error) {
    // A storage setup problem: tell the client what it is, and don't leave the pending row behind.
    await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Upload failed.' };
  }

  return {
    ok: true,
    reused: false,
    assetId: asset.id,
    sourcePath,
    uploadUrl,
    expiresAt: new Date(Date.now() + SYNC_ASSET_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * Confirms a presigned upload landed and promotes the pending row to a real asset. Returns the
 * same shape as `uploadSyncAsset`, so callers bind the result identically either way.
 */
export async function completeSyncAssetUpload(
  assetId: string,
  input: { checksum?: unknown; sourcePath?: unknown }
): Promise<UploadSyncAssetResult> {
  const checksum = asString(input.checksum).trim().toLowerCase();
  const sourcePath = asString(input.sourcePath).trim() || null;

  if (!CHECKSUM_PATTERN.test(checksum)) {
    return { ok: false, status: 400, error: 'checksum must be a sha256 hex digest.' };
  }

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, bytes: true, mimeType: true, originalFilename: true, r2Key: true },
  });

  if (!asset) {
    return { ok: false, status: 404, error: 'Unknown asset.' };
  }

  // Already completed: treat as success so a retried confirmation is harmless.
  if (!asset.r2Key.startsWith(PENDING_PREFIX)) {
    return {
      ok: true,
      assetId: asset.id,
      sourcePath,
      originalFilename: asset.originalFilename,
      bytes: asset.bytes,
    };
  }

  const key = asset.r2Key.slice(PENDING_PREFIX.length);
  const head = await headObjectInR2(key);

  if (!head) {
    await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
    return { ok: false, status: 400, error: 'No uploaded object found for this asset.' };
  }

  // What R2 received has to match what was declared at presign time. The checksum itself is the
  // client's word — verifying it here would mean downloading the object back, which is the cost
  // this whole flow exists to avoid — but the length is checked against the source of truth.
  if (asset.bytes !== null && head.contentLength !== asset.bytes) {
    await deleteObjectFromR2(key).catch(() => undefined);
    await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
    return { ok: false, status: 400, error: 'Uploaded size does not match the declared size.' };
  }

  // An SVG went straight to storage: it's read back and kept as its drawing only (put back when
  // anything was taken out). The checksum stays the client's, so a re-sync is still recognised.
  let bytes = head.contentLength ?? asset.bytes;
  if (isSvgUpload(head.contentType || asset.mimeType, asset.originalFilename)) {
    try {
      const stored = (await downloadObjectFromR2(key)).body;
      const clean = safeImageBuffer(stored, 'image/svg+xml');
      if (!clean.equals(stored)) await uploadImageToR2(new File([new Uint8Array(clean)], asset.originalFilename, { type: 'image/svg+xml' }), key);
      bytes = clean.byteLength;
    } catch (error) {
      await deleteObjectFromR2(key).catch(() => undefined);
      await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      return {
        ok: false,
        status: error instanceof UnsafeImageError ? 400 : 500,
        error: error instanceof Error ? error.message : 'Upload failed.',
      };
    }
  }

  const updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: {
      bytes,
      checksum,
      mimeType: head.contentType || asset.mimeType,
      r2Key: key,
    },
    select: { id: true, bytes: true, originalFilename: true },
  });

  return {
    ok: true,
    assetId: updated.id,
    sourcePath,
    originalFilename: updated.originalFilename,
    bytes: updated.bytes,
  };
}
