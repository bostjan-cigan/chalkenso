/**
 * Where to go after signing in, and what the sign-in page says when it didn't work: shared by the
 * page (errors other pages send it with `?error=`) and its form (Better Auth's answers). The words
 * are in `auth.signInErrors`, in the visitor's language.
 */

/**
 * Only same-site paths are followed after sign-in (no open redirects). Browsers read `/\host` and
 * paths with tabs or line breaks as another site, so the path must resolve to this one.
 */
export function safeNext(value: unknown): string | null {
  const next = String(value ?? '');
  if (!next.startsWith('/') || /[\\\u0000-\u001f]/.test(next)) {
    return null;
  }
  const url = new URL(next, 'http://same.invalid');
  return url.origin === 'http://same.invalid' ? `${url.pathname}${url.search}${url.hash}` : null;
}

/**
 * Why signing in didn't work: the codes other pages send the sign-in page with (`?error=totp-expired`),
 * each with the key of its message in `auth.signInErrors` (the page and its forms translate it).
 */
const SIGN_IN_ERRORS = {
  missing: 'missing',
  invalid: 'invalid',
  'totp-expired': 'totpExpired',
  'totp-invalid': 'totpInvalid',
  'totp-locked': 'totpLocked',
  locked: 'locked',
  'locked-here': 'lockedHere',
  'too-many': 'tooMany',
  'switched-off': 'switchedOff',
  // Vercel BotID took the request for a bot's (Better Auth's captcha plugin, where it is turned on).
  bot: 'bot',
  // Refused for another reason (from another site's page, say).
  refused: 'refused',
} as const;

export type SignInError = (typeof SIGN_IN_ERRORS)[keyof typeof SIGN_IN_ERRORS];

/** A code from the address (`?error=`) as its message's key; null for one we don't know (nothing is shown). */
export function signInErrorFromCode(code: unknown): SignInError | null {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(SIGN_IN_ERRORS, code)
    ? SIGN_IN_ERRORS[code as keyof typeof SIGN_IN_ERRORS]
    : null;
}

/** Better Auth's error, as one of the messages above. */
export function signInError(error: { status?: number; code?: string } | null | undefined): SignInError {
  const code = error?.code ?? '';
  if (code === 'LOCKED') return 'locked';
  if (code === 'LOCKED_HERE') return 'lockedHere';
  if (code === 'BANNED_USER' || code.includes('BANNED')) return 'switchedOff';
  if (code === 'VERIFICATION_FAILED') return 'bot';
  if (error?.status === 403) return 'refused';
  if (error?.status === 429) return 'tooMany';
  return 'invalid';
}
