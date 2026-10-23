/**
 * Where Better Auth's endpoints are, and which of them Vercel BotID checks where it is turned on
 * (its captcha plugin in src/lib/auth.ts). Client-safe, and imports nothing: src/lib/auth.ts reads
 * it while it loads.
 */
export const AUTH_BASE_PATH = '/api/auth';

/** As Better Auth names them, without the base path: signing in, and "Forgot your password?". */
export const BOT_CHECKED_AUTH_ENDPOINTS = ['/sign-in/email', '/sign-in/username', '/request-password-reset'];
