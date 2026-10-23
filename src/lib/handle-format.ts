import { createTranslator } from 'next-intl';
import englishCommon from '@/i18n/messages/en/common.json';
import { createSlugCandidate } from './slugs';

/**
 * What a handle looks like (client-safe: forms suggest and check it as people type). Whether it's free
 * is `handleTaken` in `handles.ts`.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
const PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Words that are pages, products or would mislead. */
export const RESERVED_HANDLES = new Set([
  'about', 'account', 'accounts', 'admin', 'administrator', 'api', 'app', 'apps', 'assets', 'auth', 'billing', 'blog',
  'call', 'chalkenso', 'contact', 'courses', 'dashboard', 'docs', 'embed', 'help', 'home', 'info', 'invite', 'join', 'l',
  'learn', 'legal', 'local', 'login', 'logout', 'mail', 'mcp', 'media', 'new', 'null', 'oauth', 'pilot', 'platform',
  'pricing', 'privacy', 'register', 'reports', 'root', 'security', 'settings', 'signup', 'static', 'status',
  'support', 'system', 'team', 'terms', 'tools', 'undefined', 'waitlist', 'www',
]);

/** A handle from what someone typed or a name: lowercase letters, digits and single hyphens. */
export function normalizeHandle(value: string) {
  return createSlugCandidate(value, '').slice(0, HANDLE_MAX).replace(/-+$/, '');
}

/** What can be wrong with a handle: its form, or (`taken`) that someone has it. Its words are in `common.handle.problems`. */
export type HandleProblem = 'length' | 'format' | 'reserved' | 'taken';

/** Why a handle can't be used as written (null: its form is fine; whether it's free is `handleTaken`). */
export function handleProblemKey(handle: string): Exclude<HandleProblem, 'taken'> | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return 'length';
  }
  if (!PATTERN.test(handle) || handle.includes('--')) {
    return 'format';
  }
  if (RESERVED_HANDLES.has(handle)) {
    return 'reserved';
  }
  return null;
}

const english = createTranslator({ locale: 'en', messages: { common: englishCommon }, namespace: 'common.handle.problems' });

/**
 * A problem in English, for what isn't translated yet (the app's profile page, an edition's handle
 * check); pages in the visitor's language word `handleProblemKey` with `common.handle.problems`.
 */
export function handleProblemText(problem: HandleProblem) {
  return english(problem, { min: HANDLE_MIN, max: HANDLE_MAX });
}

/** Why a handle can't be used as written, in English (null: its form is fine). */
export function handleProblem(handle: string): string | null {
  const problem = handleProblemKey(handle);
  return problem ? handleProblemText(problem) : null;
}


/** A handle as it's being typed: like `normalizeHandle`, but a hyphen at the end stays (the next letter follows). */
export function typingHandle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, HANDLE_MAX);
}
