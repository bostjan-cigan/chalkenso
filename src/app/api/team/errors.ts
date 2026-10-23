import 'server-only';

import { getTranslations } from 'next-intl/server';
import enLearner from '@/i18n/messages/en/learner.json';

/**
 * The team routes' errors in the person's language (the app shows them as they come): the routes'
 * own (`editor.teamApi`), and the shared comment helpers' English ones, which are in `learner.errors`.
 */

export type TeamErrorKey =
  | 'signInToAddNotes'
  | 'signInFirst'
  | 'invalidJson'
  | 'lessonNotFound'
  | 'notesNotAllowed'
  | 'selectAndWrite'
  | 'writeNote'
  | 'noteNotFound';

export async function teamError(key: TeamErrorKey) {
  return (await getTranslations('editor.teamApi'))(key);
}

type SharedKey = keyof typeof enLearner.errors;

/** `curriculum-comments.ts`'s messages, by their text. */
const SHARED = new Map(Object.entries(enLearner.errors).map(([key, text]) => [text, key as SharedKey]));

/** A shared helper's English message, translated; one without a translation stays as it is. */
export async function sharedError(message: string) {
  const key = SHARED.get(message);
  return key ? (await getTranslations('learner.errors'))(key) : message;
}
