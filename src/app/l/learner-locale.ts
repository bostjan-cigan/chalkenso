import 'server-only';

import { getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/config';
import enLearner from '@/i18n/messages/en/learner.json';
import { chosenLocale } from '@/i18n/request';
import { withLearnerAccess } from '@/lib/course-access';
import { withOrgScope } from '@/lib/org-context';
import { prisma } from '@/lib/prisma';

/**
 * The language of a learner page: the learner's own pick in its language menu, else the course's
 * (set in the course's settings), else English.
 */
export async function learnerLocale(courseLanguage: string | null | undefined): Promise<Locale> {
  return (await chosenLocale()) ?? (isLocale(courseLanguage) ? courseLanguage : DEFAULT_LOCALE);
}

type ErrorKey = keyof typeof enLearner.errors;

/** The shared helpers' English messages (`curriculum-comments.ts`, `lesson-notes.ts`), by their text. */
const ERROR_KEYS = new Map(Object.entries(enLearner.errors).map(([key, text]) => [text, key as ErrorKey]));

/**
 * An error for the learner page, in its language: `message` is one of the shared helpers' English
 * messages, which the website API keeps in English. The course is read only when there is an error
 * to say and the learner never picked a language. A message without a translation stays as it is.
 */
export async function learnerError(token: string, message: string): Promise<string> {
  const key = ERROR_KEYS.get(message);
  if (!key) {
    return message;
  }
  const locale =
    (await chosenLocale()) ??
    (await withLearnerAccess(token, async (access) => {
      if (access.state === 'invalid') {
        return DEFAULT_LOCALE;
      }
      const course = await withOrgScope(access.organizationId, () =>
        prisma.course.findUnique({ where: { id: access.courseId }, select: { language: true } })
      );
      const language = course?.language;
      return isLocale(language) ? language : DEFAULT_LOCALE;
    }));
  const t = await getTranslations({ locale, namespace: 'learner.errors' });
  return t(key);
}
