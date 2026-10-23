import type { Locale } from '@/i18n/config';
import { type LocalMessages, localMessages } from '@/extensions/messages.local';

/** The local edition's words beyond the shared ones: none (it has no website or free tools). */
export type EditionMessages = LocalMessages;

export const editionMessages: Record<Locale, EditionMessages> = localMessages;
