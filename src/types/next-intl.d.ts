import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/messages';

/** Typed messages and languages: `useTranslations('auth')` and its keys are checked. */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
