import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Secrets kept in the database (an organisation's AI key): AES-256-GCM with a key derived from a
 * server secret and the secret's purpose, so one purpose's ciphertext is useless for another.
 *
 * Two formats:
 * - `v2:<base64>` — keyed by `SECRETS_KEY` (32 random bytes, base64), used whenever it is set, so
 *   rotating `SESSION_SECRET` (sessions, invite links) no longer makes stored keys unreadable.
 * - legacy `<base64>` — keyed by `SESSION_SECRET`; still read, and written only without SECRETS_KEY.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const V2 = 'v2:';

function secretsKey(): Buffer | null {
  const value = process.env.SECRETS_KEY?.trim();
  if (!value) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32) {
    throw new Error('SECRETS_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32).');
  }
  return bytes;
}

function legacyKey(purpose: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing required environment variable: SESSION_SECRET');
  }
  return createHash('sha256').update(`${purpose}:${secret}`).digest();
}

function v2Key(purpose: string, master: Buffer) {
  return createHash('sha256').update(purpose).update(':').update(master).digest();
}

function seal(plain: string, key: Buffer) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function unseal(sealed: string, key: Buffer) {
  const combined = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, combined.subarray(0, IV_LENGTH));
  decipher.setAuthTag(combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  return Buffer.concat([decipher.update(combined.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
}

export function encryptSecret(plain: string, purpose: string) {
  const master = secretsKey();
  if (!master && process.env.VERCEL_ENV === 'production') {
    // Production must not tie stored keys to SESSION_SECRET (rotating it would lose them).
    throw new Error('Missing required environment variable: SECRETS_KEY');
  }
  return master ? `${V2}${seal(plain, v2Key(purpose, master))}` : seal(plain, legacyKey(purpose));
}

/** The plain secret, or null when it can't be read (its server secret changed or is missing). */
export function decryptSecret(stored: string, purpose: string): string | null {
  try {
    if (stored.startsWith(V2)) {
      const master = secretsKey();
      return master ? unseal(stored.slice(V2.length), v2Key(purpose, master)) : null;
    }
    return unseal(stored, legacyKey(purpose));
  } catch {
    return null;
  }
}
