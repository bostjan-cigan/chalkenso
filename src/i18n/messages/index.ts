import 'server-only';

import { editionMessages, type EditionMessages } from '@/extensions/messages';
import type { Locale } from '../config';
import enAccount from './en/account.json';
import enApp from './en/app.json';
import enAuth from './en/auth.json';
import enCommon from './en/common.json';
import enCourses from './en/courses.json';
import enEditor from './en/editor.json';
import enEmail from './en/email.json';
import enGroups from './en/groups.json';
import enLearner from './en/learner.json';
import enTasks from './en/tasks.json';
import slAccount from './sl/account.json';
import slApp from './sl/app.json';
import slAuth from './sl/auth.json';
import slCommon from './sl/common.json';
import slCourses from './sl/courses.json';
import slEditor from './sl/editor.json';
import slEmail from './sl/email.json';
import slGroups from './sl/groups.json';
import slLearner from './sl/learner.json';
import slTasks from './sl/tasks.json';

/**
 * The shared app's words, one JSON file per namespace and language (ICU message syntax:
 * `{name}`, `{count, plural, one {…} two {…} few {…} other {…}}`; Slovenian has all four forms).
 * `common`: pieces every page uses (the language menu, dropdowns, handles); `auth`: signing in and
 * up, passwords, invites; `learner`: the learner pages; `email`: the emails those pages send. The
 * app: `app` (its frame, shared components and Home), `courses` (courses, versions, partners, arcs),
 * `editor` (the lesson workspace and the course's own components), `groups`, `tasks`, `account`
 * (team, profile, settings, sync tokens). An edition adds its own through
 * `src/extensions/messages.ts`.
 */
const en = {
  common: enCommon,
  auth: enAuth,
  learner: enLearner,
  email: enEmail,
  app: enApp,
  courses: enCourses,
  editor: enEditor,
  groups: enGroups,
  tasks: enTasks,
  account: enAccount,
};

/** Typed as English: a message missing in Slovenian fails the type check (`yarn i18n:check` also finds extra ones). */
const sl: typeof en = {
  common: slCommon,
  auth: slAuth,
  learner: slLearner,
  email: slEmail,
  app: slApp,
  courses: slCourses,
  editor: slEditor,
  groups: slGroups,
  tasks: slTasks,
  account: slAccount,
};

const shared: Record<Locale, typeof en> = { en, sl };

export type Messages = typeof en & EditionMessages;

/** Top-level namespaces, and the nested ones a provider may pick (`'tools.readingTime'`). */
export type Namespace = string;

/** Every message in a language: the shared ones and the edition's. */
export function loadMessages(locale: Locale): Messages {
  return { ...shared[locale], ...editionMessages[locale] } as Messages;
}

/**
 * Only the namespaces a client component under a provider needs (dotted for nested ones), so a
 * page ships the words its interactive parts use and nothing else. Server components translate on
 * the server (`getTranslations`) and need nothing here.
 */
export function pickMessages(messages: Messages, namespaces: readonly Namespace[]) {
  const picked: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    const path = namespace.split('.');
    let source: unknown = messages;
    for (const key of path) source = (source as Record<string, unknown> | undefined)?.[key];
    // Not in this edition (a shared page listing another edition's words for its own pieces): nothing to give.
    if (source === undefined) continue;
    let target = picked;
    path.slice(0, -1).forEach((key) => {
      target = (target[key] ??= {}) as Record<string, unknown>;
    });
    target[path[path.length - 1]] = source;
  }
  return picked;
}
