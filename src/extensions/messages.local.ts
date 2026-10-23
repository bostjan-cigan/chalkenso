import type { Locale } from '@/i18n/config';

/**
 * The local edition adds no words of its own: it has no website or free tools. An empty object type
 * (not `Record<string, never>`, which would make every shared namespace `never` in `Messages`).
 */
export type LocalMessages = Record<never, never>;

export const localMessages: Record<Locale, LocalMessages> = { en: {}, sl: {} };
