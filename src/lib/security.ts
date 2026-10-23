import 'server-only';

import {
  createHmac,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const PASSWORD_PREFIX = 'scrypt';
const PASSWORD_KEY_LENGTH = 64;

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('hex');

  return `${PASSWORD_PREFIX}:${salt}:${hash}`;
}

/**
 * `hashPassword` without blocking the server: the same scrypt and stored format, worked out on
 * Node's thread pool. Hash before a transaction opens, so it doesn't hold its connection meanwhile.
 */
export function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(`${PASSWORD_PREFIX}:${salt}:${key.toString('hex')}`);
      }
    });
  });
}

export function verifyPassword(password: string, storedHash: string) {
  const [prefix, salt, hash] = storedHash.split(':');

  if (prefix !== PASSWORD_PREFIX || !salt || !hash) {
    return false;
  }

  const candidate = scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');

  if (candidate.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(candidate, expected);
}

export function createPublicAccessToken() {
  return randomBytes(24).toString('hex');
}

export function hashSessionToken(token: string) {
  const secret = requireEnv('SESSION_SECRET');

  return createHmac('sha256', secret).update(token).digest('hex');
}

const API_TOKEN_DISPLAY_SECRET_CHARS = 8;

/**
 * Mints a raw API token: a caller-chosen readable prefix (e.g. `crs`) plus 24 random bytes of hex
 * secret. The full value is shown to the admin exactly once; only its hash and a display prefix are
 * persisted.
 */
export function createApiTokenValue(prefix: string) {
  const secret = randomBytes(24).toString('hex');

  return `${prefix}_${secret}`;
}

/** Leading, non-secret fragment (`<prefix>_` + 8 hex chars) stored to identify a token in the admin list. */
export function getApiTokenDisplayPrefix(token: string) {
  const underscore = token.indexOf('_');

  if (underscore === -1) {
    return token.slice(0, API_TOKEN_DISPLAY_SECRET_CHARS);
  }

  return token.slice(0, underscore + 1 + API_TOKEN_DISPLAY_SECRET_CHARS);
}

export function hashApiToken(token: string) {
  const secret = requireEnv('SESSION_SECRET');

  return createHmac('sha256', secret).update(token).digest('hex');
}
