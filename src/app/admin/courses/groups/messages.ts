import { getTranslations } from 'next-intl/server';

/** The `?status=` codes the group pages are sent back with, each with its message's key in `groups.flash.status`. */
const GROUP_STATUS_KEYS = {
  'group-created': 'groupCreated',
  'group-deleted': 'groupDeleted',
  'group-link-created': 'groupLinkCreated',
  'group-link-revoked': 'groupLinkRevoked',
  'group-updated': 'groupUpdated',
  'member-link-created': 'memberLinkCreated',
  'member-link-revoked': 'memberLinkRevoked',
  'member-links-created': 'memberLinksCreated',
} as const;

/** The `?error=` codes, each with its message's key in `groups.flash.error`. */
const GROUP_ERROR_KEYS = {
  'group-course': 'groupCourse',
  'group-course-locked': 'groupCourseLocked',
  'group-expiry': 'groupExpiry',
  'group-members': 'groupMembers',
  'group-name': 'groupName',
  'group-not-found': 'groupNotFound',
  'group-partner': 'groupPartner',
  'group-roster': 'groupRoster',
  'group-schedule-invalid': 'groupScheduleInvalid',
  'group-schedule-range': 'groupScheduleRange',
  'group-version': 'groupVersion',
  'group-version-draft': 'groupVersionDraft',
  // The organisation's plan (`serverExtensions.limits.classes`); the local edition never sends these.
  'plan-classes': 'planClasses',
  'plan-trial-classes': 'planTrialClasses',
  'plan-trial-ended': 'planTrialEnded',
  'plan-ended': 'planEnded',
  'plan-paused': 'planPaused',
} as const;

function keyOf<T extends Record<string, string>>(keys: T, code: string): T[keyof T] | null {
  return Object.prototype.hasOwnProperty.call(keys, code) ? keys[code as keyof T] : null;
}

/** The error code for a refused plan check (`plan-<code>`). */
export function planErrorCode(code: string) {
  return `plan-${code}` in GROUP_ERROR_KEYS ? `plan-${code}` : 'plan-classes';
}

/** A refusal's message key in `groups.flash.error`, for a sheet's form that says it in place. */
export function groupErrorKey(code: string) {
  return keyOf(GROUP_ERROR_KEYS, code) ?? 'groupNotFound';
}

/** The banner for a page's `?error=` or `?status=`, in the request's language (nothing for a code we don't know). */
export async function getGroupFlashMessage(params: {
  error?: string;
  status?: string;
}) {
  const t = await getTranslations('groups.flash');

  if (params.error) {
    const key = keyOf(GROUP_ERROR_KEYS, params.error);
    return key ? t(`error.${key}`) : undefined;
  }

  if (params.status) {
    const key = keyOf(GROUP_STATUS_KEYS, params.status);
    return key ? t(`status.${key}`) : undefined;
  }

  return undefined;
}
