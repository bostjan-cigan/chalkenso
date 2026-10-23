import 'server-only';

import { createHash } from 'node:crypto';
import { isSvgUpload, sanitizeSvg } from './sanitize/svg';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  deleteLocalObject,
  headLocalObject,
  listLocalObjectKeys,
  localSignedUrl,
  readLocalObject,
  writeLocalObject,
} from './local-storage';

type UploadedR2Image = {
  bytes: number;
  checksum: string;
  key: string;
  mimeType: string;
  originalFilename: string;
};

type DownloadedR2Object = {
  body: Buffer;
  cacheControl: string | null;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
};

const MAX_SIGNED_R2_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

let r2Client: S3Client | undefined;

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const R2_VARIABLES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;

/**
 * R2 is used when its four variables are set; otherwise every call below falls back to local disk
 * (`local-storage.ts`), which is how the local edition and development run.
 *
 * Only some of them set (a typo, one forgotten), or none on Vercel (its disk is read-only), is a
 * broken setup rather than local disk: say which variables are missing instead of failing on a path.
 */
export function isR2Configured() {
  const missing = R2_VARIABLES.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) {
    return true;
  }
  if (missing.length < R2_VARIABLES.length || process.env.VERCEL) {
    throw new Error(
      `File storage needs Cloudflare R2 here, but these environment variables are missing: ${missing.join(', ')}. ` +
        'Set them for this environment and redeploy.'
    );
  }
  return false;
}

function getR2Client() {
  if (r2Client) {
    return r2Client;
  }

  r2Client = new S3Client({
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
    endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    region: 'auto',
  });

  return r2Client;
}

function getSafeFileExtension(filename: string) {
  const extensionMatch = filename.trim().toLowerCase().match(/\.([a-z0-9]{1,10})$/);

  return extensionMatch ? `.${extensionMatch[1]}` : '';
}

/*
 * Bucket layout: every object sits under what it belongs to, so one organisation's or one course's
 * files can be found, counted, exported or removed by prefix.
 *
 *   organizations/<orgId>/courses/<courseId>/cover/<assetId>.<ext>     course covers
 *   organizations/<orgId>/courses/<courseId>/lessons/<assetId>.<ext>   lesson images (all versions
 *                                                                       and group copies of the course)
 *   organizations/<orgId>/logo/<uploadId>.<ext>                         organisation logos
 *   users/<userId>/profile/<uploadId>.<ext>                             profile pictures
 *
 * Objects uploaded before this layout keep their old keys (`lesson-images/…`, `profile-images/…`);
 * each asset row stores its own key, so they keep working.
 */

/** The course an upload belongs to. */
export type CourseAssetScope = { organizationId: string; courseId: string };

/** `cover` for the course's cover image, `lessons` for images in its lessons. */
export type CourseAssetFolder = 'cover' | 'lessons';

export function courseAssetPrefix(scope: CourseAssetScope, folder: CourseAssetFolder) {
  return `organizations/${scope.organizationId}/courses/${scope.courseId}/${folder}/`;
}

export function buildCourseAssetKey(
  scope: CourseAssetScope,
  folder: CourseAssetFolder,
  assetId: string,
  filename: string
) {
  return `${courseAssetPrefix(scope, folder)}${assetId}${getSafeFileExtension(filename)}`;
}

/** Unique per upload so a replaced avatar gets a fresh URL (no stale cache). */
export function buildProfileImageKey(userId: string, uploadId: string, filename: string) {
  return `users/${userId}/profile/${uploadId}${getSafeFileExtension(filename)}`;
}

/** An organisation's logo; unique per upload, like profile pictures. */
export function buildOrganizationLogoKey(organizationId: string, uploadId: string, filename: string) {
  return `organizations/${organizationId}/logo/${uploadId}${getSafeFileExtension(filename)}`;
}

export async function deleteObjectFromR2(key: string) {
  if (!isR2Configured()) {
    return deleteLocalObject(key);
  }
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
    })
  );
}

/** Every object key under a prefix (e.g. `organizations/<id>/`). */
export async function listObjectKeys(prefix: string) {
  if (!isR2Configured()) {
    return listLocalObjectKeys(prefix);
  }
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await getR2Client().send(
      new ListObjectsV2Command({ Bucket: requireEnv('R2_BUCKET'), Prefix: prefix, ContinuationToken: token })
    );
    keys.push(...(page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Deletes many objects (in batches of 1,000 on R2). Returns the keys that couldn't be deleted. */
export async function deleteObjects(keys: string[]): Promise<string[]> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (!isR2Configured()) {
    const failed: string[] = [];
    for (const key of unique) {
      await deleteLocalObject(key).catch(() => failed.push(key));
    }
    return failed;
  }
  const failed: string[] = [];
  for (let start = 0; start < unique.length; start += 1000) {
    const batch = unique.slice(start, start + 1000);
    const result = await getR2Client()
      .send(new DeleteObjectsCommand({ Bucket: requireEnv('R2_BUCKET'), Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }))
      .catch(() => null);
    if (!result) {
      failed.push(...batch);
      continue;
    }
    failed.push(...(result.Errors ?? []).flatMap((error) => (error.Key ? [error.Key] : [])));
  }
  return failed;
}

function clampSignedUrlTtl(expiresInSeconds: number) {
  return Math.max(1, Math.min(MAX_SIGNED_R2_URL_TTL_SECONDS, Math.floor(expiresInSeconds)));
}

export async function getSignedR2ObjectUrl(key: string, expiresInSeconds: number) {
  const safeExpiresInSeconds = clampSignedUrlTtl(expiresInSeconds);
  if (!isR2Configured()) {
    return localSignedUrl('GET', key, safeExpiresInSeconds);
  }

  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
    }),
    {
      expiresIn: safeExpiresInSeconds,
    }
  );
}

/**
 * A signed GET that stays the same for a while, for image routes that redirect to the file: signed
 * as of the start of the current window and valid for two windows. Every request in one window gets
 * the same URL, so browsers (and a CDN) can cache the file under it, and a URL handed out at the end
 * of a window still works for a whole window more. `freshFor` is how long a response pointing at it
 * may be cached: until the window ends.
 */
export async function getWindowedSignedR2ObjectUrl(
  key: string,
  windowSeconds: number,
  options: { filename?: string } = {}
): Promise<{ url: string; freshFor: number }> {
  const span = Math.max(60, Math.min(Math.floor(MAX_SIGNED_R2_URL_TTL_SECONDS / 2), Math.floor(windowSeconds)));
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % span);
  const freshFor = start + span - now;
  if (!isR2Configured()) {
    // Local files: valid to the same moment (the local signer counts from now).
    return { url: localSignedUrl('GET', key, start + 2 * span - now), freshFor };
  }
  // Plain ASCII in the header R2 sends back (other characters become `_`).
  const filename = options.filename ? contentDispositionFilename(options.filename).replace(/[^\x20-\x7e]/g, '_') : '';
  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
      ...(filename ? { ResponseContentDisposition: `inline; filename="${filename}"` } : {}),
    }),
    { expiresIn: 2 * span, signingDate: new Date(start * 1000) }
  );
  return { url, freshFor };
}

/**
 * Lifetime of the URLs handed to sync clients so they can talk to R2 directly.
 *
 * Short on purpose: a presigned URL works for whoever holds it, so it is only meant to cover the
 * one transfer the client is about to make. This is unrelated to the preview TTLs — lesson preview
 * links, the group asset cache and /media each keep their own, much longer, lifetimes.
 */
export const SYNC_ASSET_URL_TTL_SECONDS = 60 * 5;

/** Strips anything that would break out of a quoted `filename="…"` header value. */
function contentDispositionFilename(filename: string) {
  return filename.replace(/["\\\r\n]/g, '');
}

/**
 * A presigned GET the client can fetch straight from R2, with the same `Content-Disposition` and
 * `Content-Type` the byte-proxying route would have sent. Bytes never pass through the function.
 */
export async function getSignedR2DownloadUrl(
  key: string,
  expiresInSeconds: number,
  options: { filename?: string; contentType?: string | null } = {}
) {
  if (!isR2Configured()) {
    return localSignedUrl('GET', key, clampSignedUrlTtl(expiresInSeconds), options);
  }
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
      ...(options.filename
        ? {
            ResponseContentDisposition: `attachment; filename="${contentDispositionFilename(options.filename)}"`,
          }
        : {}),
      ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
    }),
    { expiresIn: clampSignedUrlTtl(expiresInSeconds) }
  );
}

/**
 * A presigned PUT the client uploads to directly. The signature pins the content type, so the URL
 * can't be used to store something other than the kind of file it was issued for.
 *
 * Content length is deliberately *not* signed: the Obsidian client uploads through Electron's
 * `requestUrl`, which does not reliably reproduce a `Content-Length` header byte-for-byte, and a
 * mismatch there surfaces as an opaque signature error. Size is still enforced — the declared size
 * is checked against the cap when the URL is issued, and the completion step compares what R2
 * actually received against that declaration before the asset becomes usable.
 */
export async function getSignedR2UploadUrl(
  key: string,
  expiresInSeconds: number,
  { contentType }: { contentType: string }
) {
  if (!isR2Configured()) {
    return localSignedUrl('PUT', key, clampSignedUrlTtl(expiresInSeconds), { contentType });
  }
  return getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      CacheControl: 'public, max-age=31536000, immutable',
      ContentType: contentType,
      Key: key,
    }),
    { expiresIn: clampSignedUrlTtl(expiresInSeconds), signableHeaders: new Set(['content-type']) }
  );
}

type R2ObjectHead = {
  contentLength: number | null;
  contentType: string | null;
};

/** Confirms an object landed in R2 and reports what actually arrived, without fetching the bytes. */
export async function headObjectInR2(key: string): Promise<R2ObjectHead | null> {
  if (!isR2Configured()) {
    return headLocalObject(key);
  }
  try {
    const response = await getR2Client().send(
      new HeadObjectCommand({ Bucket: requireEnv('R2_BUCKET'), Key: key })
    );
    return {
      contentLength: response.ContentLength ?? null,
      contentType: response.ContentType ?? null,
    };
  } catch {
    return null;
  }
}

/** The message of an SVG refused because nothing safe is left in it (see `safeImageBuffer`). */
export const UNSAFE_SVG_MESSAGE = 'This SVG has nothing to show once its scripts and outside links are taken out.';

/** An image refused as unsafe to show: a client's mistake to fix, not a failure. */
export class UnsafeImageError extends Error {}

/**
 * An image's bytes as they're safe to store and show: an SVG keeps only its drawing (`sanitizeSvg`:
 * no scripts, handlers, outside links or HTML), and one with nothing left is refused. Other images
 * are as they came.
 */
export function safeImageBuffer(buffer: Buffer, mimeType: string | null | undefined, filename?: string | null): Buffer {
  if (!buffer.byteLength || !isSvgUpload(mimeType, filename)) return buffer;
  const clean = sanitizeSvg(buffer.toString('utf8'));
  if (!clean) throw new UnsafeImageError(UNSAFE_SVG_MESSAGE);
  return Buffer.from(clean, 'utf8');
}

export async function uploadImageToR2(
  file: File,
  key: string
): Promise<UploadedR2Image> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image uploads are supported.');
  }

  const fileBuffer = safeImageBuffer(Buffer.from(await file.arrayBuffer()), file.type, file.name);

  if (!fileBuffer.byteLength) {
    throw new Error('Cannot upload an empty file.');
  }

  const mimeType = file.type || 'application/octet-stream';

  if (!isR2Configured()) {
    await writeLocalObject(key, fileBuffer, {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  } else await getR2Client().send(
    new PutObjectCommand({
      Body: fileBuffer,
      Bucket: requireEnv('R2_BUCKET'),
      CacheControl: 'public, max-age=31536000, immutable',
      ContentType: mimeType,
      Key: key,
    })
  );

  return {
    bytes: fileBuffer.byteLength,
    checksum: createHash('sha256').update(fileBuffer).digest('hex'),
    key,
    mimeType,
    originalFilename: file.name,
  };
}

type StreamedR2Object = {
  body: ReadableStream<Uint8Array>;
  cacheControl: string | null;
  contentLength: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
};

/**
 * Streaming counterpart to {@link downloadObjectFromR2}: hands back the object's body without ever
 * holding it in memory. Use this whenever the bytes are only being forwarded to a response —
 * buffering a large image just to write it straight back costs memory and function time for
 * nothing. Use `downloadObjectFromR2` when the bytes are actually inspected.
 */
export async function streamObjectFromR2(key: string): Promise<StreamedR2Object> {
  if (!isR2Configured()) {
    const local = await readLocalObject(key);
    return {
      body: new Blob([new Uint8Array(local.body)]).stream(),
      cacheControl: local.cacheControl,
      contentLength: local.body.byteLength,
      contentType: local.contentType,
      etag: null,
      lastModified: local.lastModified,
    };
  }
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error('R2 object body is missing.');
  }

  return {
    body: response.Body.transformToWebStream(),
    cacheControl: response.CacheControl ?? null,
    contentLength: response.ContentLength ?? null,
    contentType: response.ContentType ?? null,
    etag: response.ETag ?? null,
    lastModified: response.LastModified ?? null,
  };
}

export async function downloadObjectFromR2(key: string): Promise<DownloadedR2Object> {
  if (!isR2Configured()) {
    const local = await readLocalObject(key);
    return { ...local, etag: null };
  }
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error('R2 object body is missing.');
  }

  return {
    body: Buffer.from(await response.Body.transformToByteArray()),
    cacheControl: response.CacheControl ?? null,
    contentType: response.ContentType ?? null,
    etag: response.ETag ?? null,
    lastModified: response.LastModified ?? null,
  };
}
