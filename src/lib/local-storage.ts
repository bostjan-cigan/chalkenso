import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { absoluteUrl } from './site';

/**
 * Disk-backed stand-in for R2, used when no bucket is configured (the local edition and
 * development). Objects live under `STORAGE_DIR` (default `.data/media`); "signed URLs" point at
 * `/api/files/<key>` with an expiring HMAC, so the rest of the app treats both stores the same.
 */

// The storage folder is data at runtime, not code: `turbopackIgnore` keeps the bundler from
// tracing the whole project because of these paths.
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR?.trim() || '.data/media');

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error('Missing required environment variable: SESSION_SECRET');
  }
  return value;
}

/** Resolves a key inside the storage root; rejects anything that would escape it. */
export function localObjectPath(key: string) {
  const resolved = path.resolve(ROOT, key);
  if (!resolved.startsWith(ROOT + path.sep)) {
    throw new Error('Invalid storage key.');
  }
  return resolved;
}

function sign(method: 'GET' | 'PUT', key: string, expires: number, extra = '') {
  return createHmac('sha256', secret()).update(`${method}\n${key}\n${expires}\n${extra}`).digest('hex');
}

function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export function localSignedUrl(
  method: 'GET' | 'PUT',
  key: string,
  expiresInSeconds: number,
  options: { contentType?: string | null; filename?: string } = {}
) {
  const expires = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresInSeconds));
  const params = new URLSearchParams({ exp: String(expires) });
  if (options.contentType) {
    params.set('ct', options.contentType);
  }
  if (options.filename) {
    params.set('fn', options.filename);
  }
  params.set('sig', sign(method, key, expires, `${options.contentType ?? ''}\n${options.filename ?? ''}`));
  return absoluteUrl(`/api/files/${encodeKey(key)}?${params.toString()}`);
}

/** Checks a signed URL's query against the method and key it is used with. */
export function verifyLocalSignature(method: 'GET' | 'PUT', key: string, params: URLSearchParams) {
  const expires = Number(params.get('exp'));
  const signature = params.get('sig') ?? '';
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) {
    return false;
  }
  const expected = sign(method, key, expires, `${params.get('ct') ?? ''}\n${params.get('fn') ?? ''}`);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

type LocalMeta = { contentType: string | null; cacheControl: string | null; updatedAt: string };

export async function writeLocalObject(
  key: string,
  body: Buffer,
  meta: { contentType: string | null; cacheControl?: string | null }
) {
  const file = localObjectPath(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ file, body);
  const record: LocalMeta = {
    contentType: meta.contentType,
    cacheControl: meta.cacheControl ?? null,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(/*turbopackIgnore: true*/ `${file}.meta.json`, JSON.stringify(record));
}

export async function readLocalObject(key: string) {
  const file = localObjectPath(key);
  const [body, meta] = await Promise.all([
    readFile(/*turbopackIgnore: true*/ file),
    readFile(/*turbopackIgnore: true*/ `${file}.meta.json`, 'utf8')
      .then((text) => JSON.parse(text) as LocalMeta)
      .catch(() => null),
  ]);
  return {
    body,
    contentType: meta?.contentType ?? null,
    cacheControl: meta?.cacheControl ?? null,
    lastModified: meta ? new Date(meta.updatedAt) : null,
  };
}

export async function headLocalObject(key: string) {
  try {
    const file = localObjectPath(key);
    const [info, meta] = await Promise.all([
      stat(/*turbopackIgnore: true*/ file),
      readFile(/*turbopackIgnore: true*/ `${file}.meta.json`, 'utf8')
        .then((text) => JSON.parse(text) as LocalMeta)
        .catch(() => null),
    ]);
    return { contentLength: info.size, contentType: meta?.contentType ?? null };
  } catch {
    return null;
  }
}

export async function deleteLocalObject(key: string) {
  const file = localObjectPath(key);
  await rm(/*turbopackIgnore: true*/ file, { force: true });
  await rm(/*turbopackIgnore: true*/ `${file}.meta.json`, { force: true });
}

/** Every object key under a prefix (a folder, e.g. `organizations/<id>/`), without the sidecars. */
export async function listLocalObjectKeys(prefix: string) {
  const keys: string[] = [];
  const walk = async (folder: string) => {
    const entries = await readdir(/*turbopackIgnore: true*/ folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && !entry.name.endsWith('.meta.json')) {
        keys.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  await walk(localObjectPath(prefix.replace(/\/+$/, '')));
  return keys;
}
