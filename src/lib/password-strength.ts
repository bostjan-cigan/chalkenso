/**
 * Whether a new password is safe enough, as one rule for the sign-up form (as they type) and the server
 * (which checks again). Client-safe, no dependencies. Not a strength meter: it only says when a password
 * is easy to guess, and why.
 *
 * - `short`: under the minimum length.
 * - `common`: one of the passwords people pick most, a run like "12345678" or "aaaaaaaa", a keyboard row,
 *   or the name from their own email.
 * - `simple`: shorter than 12 characters and only one kind of character (only letters, or only digits).
 */
export type PasswordProblem = 'short' | 'common' | 'simple';

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'iloveyou', 'sunshine',
  'princess', 'football', 'baseball', 'welcome', 'welcome1', 'welcome123', 'letmein', 'monkey', 'dragon', 'master',
  'shadow', 'superman', 'trustno1', 'whatever', 'computer', 'starwars', 'admin123', 'administrator', 'login123',
  'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r', '1qaz2wsx', 'abc12345', 'abcd1234', 'aa123456',
  '11111111', '12345678', '123456789', '1234567890', '87654321', '00000000', 'geslo123', 'chalkenso', 'chalkenso1',
]);

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwertzuiop', 'yxcvbnm', '1234567890'];

/** Every character the same, or each one step up or down from the last ("abcdefgh", "98765432"). */
function isRun(text: string) {
  if (new Set(text).size === 1) return true;
  const steps = new Set(Array.from(text).slice(1).map((char, index) => char.charCodeAt(0) - text.charCodeAt(index)));
  return steps.size === 1 && [1, -1].includes(steps.values().next().value as number);
}

export function passwordProblem(password: string, options: { email?: string; min?: number } = {}): PasswordProblem | null {
  const min = options.min ?? 8;
  if (password.length < min) return 'short';
  const lower = password.toLowerCase();
  const letters = lower.replace(/[^a-z0-9]/g, '');
  // The email's name, with and without a "+tag": "ana.novak+news@…" gives "ananovaknews" and "ananovak".
  const local = (options.email ?? '').trim().toLowerCase().split('@')[0];
  const emailNames = [local, local.split('+')[0]].map((name) => name.replace(/[^a-z0-9]/g, '')).filter((name) => name.length >= 3);
  if (
    COMMON.has(lower) ||
    isRun(lower) ||
    ROWS.some((row) => row.includes(lower) || row.split('').reverse().join('').includes(lower)) ||
    emailNames.some((name) => letters.includes(name) && letters.length < name.length + 4)
  ) {
    return 'common';
  }
  const kinds = [/[a-z]/i, /\d/, /[^a-z\d]/i].filter((kind) => kind.test(password)).length;
  if (password.length < 12 && kinds < 2) return 'simple';
  return null;
}
