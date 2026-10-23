import { getLocale, getTranslations } from 'next-intl/server';
import AdminSectionCard from '@/app/admin/components/ui/AdminSectionCard';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import { getCurrentUserSession } from '@/lib/admin-auth';
import { SESSION_LIMITS } from '@/lib/session-limits';
import { listOpenSessions, type OpenSession } from '@/lib/sessions';
import styles from '@/app/admin/admin.module.css';
import SessionsList, { type SessionRow } from './SessionsList';

const ACTIVE_NOW_MS = 1000 * 60 * 5;

const words = () => getTranslations('account.profile.sessions');
type Words = Awaited<ReturnType<typeof words>>;

function day(date: Date, locale: Locale) {
  return date.toLocaleDateString(INTL_LOCALES[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "Now", "5 min ago", "3 h ago", "yesterday", "12 days ago", and whether that's now. */
function lastActive(session: OpenSession, now: number, t: Words): { word: string; now: boolean } {
  const seen = session.current ? now : (session.lastSeenAt ?? session.createdAt).getTime();
  const minutes = Math.round((now - seen) / 60_000);
  if (now - seen < ACTIVE_NOW_MS) return { word: t('lastActive', { unit: 'now', count: 0 }), now: true };
  if (minutes < 60) return { word: t('lastActive', { unit: 'minutes', count: minutes }), now: false };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { word: t('lastActive', { unit: 'hours', count: hours }), now: false };
  const days = Math.round(hours / 24);
  return { word: t('lastActive', { unit: days === 1 ? 'yesterday' : 'days', count: days }), now: false };
}

/** "Chrome on Mac" in the reader's words, from the names the user agent gave. */
function deviceName(device: OpenSession['device'], t: Words) {
  if (device.browser && device.system) return t('device.on', { browser: device.browser, system: device.system });
  return device.browser ?? device.system ?? t('device.unknown');
}

const days = (ms: number) => Math.round(ms / 86_400_000);
const hours = (ms: number) => Math.round(ms / 3_600_000);

/** Profile: "Where you're signed in", every open session of yours, with a way to sign each out. */
export default async function SessionsSection() {
  const session = await getCurrentUserSession();
  if (!session) {
    return null;
  }
  const [t, locale] = await Promise.all([words(), getLocale() as Promise<Locale>]);
  const now = Date.now();
  const sessions = await listOpenSessions(session.sessionId);
  const { kept, short } = SESSION_LIMITS;
  const rows: SessionRow[] = sessions.map((entry) => {
    const active = lastActive(entry, now, t);
    return {
      id: entry.id,
      kind: entry.device.kind,
      device: deviceName(entry.device, t),
      place: entry.location,
      lastActive: active.word,
      active: active.now ? t('activeNow') : t('active', { when: active.word }),
      signedInOn: day(entry.createdAt, locale),
      stays: entry.persistent ? t('staysKept', { days: days(kept.maxMs) }) : t('staysShort'),
      current: entry.current,
    };
  });
  const policy = t('policy', {
    idle: hours(short.idleMs),
    max: hours(short.maxMs),
    keptIdle: days(kept.idleMs),
    keptMax: days(kept.maxMs),
  });

  return (
    <section className={styles.editorPageSection}>
      <AdminSectionCard kicker={t('kicker')} title={t('title')}>
        <SessionsList rows={rows} policy={policy} readOnly={session.user.impersonator ? t('readOnly') : null} />
      </AdminSectionCard>
    </section>
  );
}
