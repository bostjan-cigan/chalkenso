import { INTL_LOCALES, type Locale } from '@/i18n/config';

const DEFAULT_ACCESS_LINK_DAYS = 30;

/** Where the token goes in an organisation's own learner link address. */
export const LEARNER_LINK_TOKEN = '{token}';

/**
 * A learner (or preview) link as people get it: the organisation's own address when it has one (a
 * URL template with `{token}`, see `serverExtensions.learnerLinkTemplate`), otherwise this
 * installation's `/l/course/<token>`, absolute when `origin` is given.
 */
export function learnerLinkUrl(token: string, options: { template?: string | null; origin?: string } = {}) {
  if (options.template) {
    return options.template.replaceAll(LEARNER_LINK_TOKEN, encodeURIComponent(token));
  }
  return `${options.origin ?? ''}/l/course/${token}`;
}

export function getDefaultAccessExpiry(now = new Date()) {
  const expiry = new Date(now);

  expiry.setDate(expiry.getDate() + DEFAULT_ACCESS_LINK_DAYS);
  expiry.setSeconds(0, 0);

  return expiry;
}

export function formatDateTimeLocalValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDateTimeLocalValue(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const parsedValue = new Date(trimmedValue);

  if (Number.isNaN(parsedValue.getTime())) {
    return null;
  }

  return parsedValue;
}

export function isActiveAccessLink(link: {
  expiresAt: Date;
  revokedAt: Date | null;
}, now = new Date()) {
  return !link.revokedAt && link.expiresAt > now;
}

/** "18 Oct 2026, 14:30" (English), "18. okt. 2026, 14:30" (Slovenian): pass the page's language (`useLocale()`). */
export function formatAccessDate(value: Date, locale: Locale = 'en') {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}
