import { getTranslations } from 'next-intl/server';
import { createElement } from 'react';
import type en from '@/i18n/messages/en/courses.json';

type StatusKey = keyof typeof en.flash.status;
type ErrorKey = keyof typeof en.flash.error;

/** `?status=` codes the course pages say something for, with their message's key in `courses.flash.status`. */
const STATUS_KEYS: Record<string, StatusKey> = {
  'course-created': 'courseCreated',
  'course-updated': 'courseUpdated',
  'lesson-created': 'lessonCreated',
  'lesson-updated': 'lessonUpdated',
  'partner-created': 'partnerCreated',
  'partner-deleted': 'partnerDeleted',
  'partner-updated': 'partnerUpdated',
  'version-created': 'versionCreated',
  'version-deleted': 'versionDeleted',
};

/** `?error=` codes, with their message's key in `courses.flash.error`. */
const ERROR_KEYS: Record<string, ErrorKey> = {
  'course-not-found': 'courseNotFound',
  'course-github-url': 'courseGithubUrl',
  'course-enrol-url': 'courseEnrolUrl',
  'course-partner': 'coursePartner',
  'course-title': 'courseTitle',
  'lesson-course': 'lessonCourse',
  'lesson-markdown': 'lessonMarkdown',
  'lesson-title': 'lessonTitle',
  'lesson-changed': 'lessonChanged',
  'partner-name': 'partnerName',
  'partner-name-taken': 'partnerNameTaken',
  'partner-not-found': 'partnerNotFound',
  'partner-url': 'partnerUrl',
  'version-not-found': 'versionNotFound',
  'version-source': 'versionSource',
  'version-in-use': 'versionInUse',
  'version-not-draft': 'versionNotDraft',
  'version-draft-empty': 'versionDraftEmpty',
};

type FlashParams = {
  error?: string;
  status?: string;
};

const known = <T>(keys: Record<string, T>, code: string) =>
  Object.prototype.hasOwnProperty.call(keys, code) ? keys[code] : null;

/** The message for the page's `?error=` (it wins) or `?status=`: its key, or null for a code we don't know. */
function flashKey(params: FlashParams): { kind: 'error'; key: ErrorKey } | { kind: 'status'; key: StatusKey } | null {
  if (params.error) {
    const key = known(ERROR_KEYS, params.error);
    return key ? { kind: 'error', key } : null;
  }
  if (params.status) {
    const key = known(STATUS_KEYS, params.status);
    return key ? { kind: 'status', key } : null;
  }
  return null;
}

/** What a course page says after an action (`?status=`, `?error=`), in the request's language. */
export async function courseFlashMessage(params: FlashParams) {
  const flash = flashKey(params);
  if (!flash) {
    return undefined;
  }
  const t = await getTranslations('courses.flash');
  return flash.kind === 'error' ? t(`error.${flash.key}`) : t(`status.${flash.key}`);
}

async function CourseFlashText({ params }: { params: FlashParams }) {
  return (await courseFlashMessage(params)) ?? null;
}

/**
 * The same as an element that renders the message, for a page that doesn't await it (nothing when
 * there is nothing to say).
 */
export function getCourseFlashMessage(params: FlashParams) {
  return flashKey(params) ? createElement(CourseFlashText, { params }) : undefined;
}
