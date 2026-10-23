'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { INTL_LOCALES } from '@/i18n/config';
import AccessLinkModalPortal from '@/app/admin/courses/groups/components/AccessLinkModalPortal';
import modalStyles from '@/app/admin/courses/groups/components/MemberLinkModal.module.css';
import AdminButton from './ui/AdminButton';

/** "Are you still there?" this long before the session ends without activity. */
const WARN_IDLE_MS = 2 * 60_000;
/** "Sign in again soon" this long before its hard end, to leave time to save. */
const WARN_MAX_MS = 5 * 60_000;
/** Someone working on the page counts as activity, told to the server at most this often. */
const PING_EVERY_MS = 5 * 60_000;
const TICK_MS = 15_000;
/** While asking, the server is asked again this often (another tab may have answered). */
const LOOK_EVERY_MS = 10_000;
/** Other tabs of the app hear when one of them keeps the session going. */
const CHANNEL = 'chalkenso-session';

type Ends = { idle: number; max: number };
type Status = { active: true; expiresAt: string; maxExpiresAt: string } | { active: false };

const toEnds = (status: { expiresAt: string; maxExpiresAt: string }): Ends => ({
  idle: Date.parse(status.expiresAt),
  max: Date.parse(status.maxExpiresAt),
});

/** null: the request failed (offline, a deploy): nothing is decided on it. */
async function sessionStatus(method: 'GET' | 'POST'): Promise<Status | null> {
  try {
    const response = await fetch('/admin/session', { method, cache: 'no-store', credentials: 'same-origin' });
    return response.ok ? ((await response.json()) as Status) : null;
  } catch {
    return null;
  }
}

function countdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The sign-in page, back here after: saying the session ended, unless it is still open ("Sign in now"). */
function signInAgain({ ended = true }: { ended?: boolean } = {}) {
  const here = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/admin/login?${ended ? 'signedout=1&' : ''}next=${here}`);
}

/**
 * Keeps an eye on the session for the open page (src/lib/admin-auth.ts has the limits). Working on
 * the page — clicks, typing, scrolling — counts as activity, as visits do. Shortly before the
 * session would end without activity it asks "Are you still there?" (Stay signed in moves it on);
 * before its hard end it says to save, as only signing in again goes past it. When it ends, the
 * sign-in page opens, coming back here after. Never during "log in as" (that visit keeps its hour).
 */
export default function SessionKeeper({ expiresAt, maxExpiresAt }: { expiresAt: string; maxExpiresAt: string }) {
  const t = useTranslations('app.session');
  const locale = useLocale();
  const titleId = useId();
  const descriptionId = useId();
  const [ends, setEnds] = useState<Ends>(() => toEnds({ expiresAt, maxExpiresAt }));
  const [prompt, setPrompt] = useState<'idle' | 'max' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(false);
  const lastPing = useRef(Date.now());
  // The hard-end notice shows once; "OK" is the answer.
  const maxNoticeSeen = useRef(false);
  const endsRef = useRef(ends);
  const promptRef = useRef(prompt);
  endsRef.current = ends;
  promptRef.current = prompt;

  // A new page from the server (after an action) brings fresh end times.
  useEffect(() => {
    setEnds(toEnds({ expiresAt, maxExpiresAt }));
  }, [expiresAt, maxExpiresAt]);

  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const opened = new BroadcastChannel(CHANNEL);
    opened.onmessage = (event: MessageEvent<{ expiresAt: string; maxExpiresAt: string }>) => {
      setEnds(toEnds(event.data));
      setPrompt((current) => (current === 'idle' ? null : current));
    };
    channel.current = opened;
    return () => opened.close();
  }, []);

  const keepGoing = useCallback(async () => {
    lastPing.current = Date.now();
    const status = await sessionStatus('POST');
    if (status?.active) {
      setEnds(toEnds(status));
      channel.current?.postMessage({ expiresAt: status.expiresAt, maxExpiresAt: status.maxExpiresAt });
    }
    return status;
  }, []);

  // Working on the page is activity.
  useEffect(() => {
    const onActivity = () => {
      if (promptRef.current || document.hidden || Date.now() - lastPing.current < PING_EVERY_MS) return;
      void keepGoing();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, onActivity));
  }, [keepGoing]);

  // Every few seconds (every second while asking, for the countdown), and whenever the tab comes back.
  const lastLook = useRef(0);
  useEffect(() => {
    let checking = false;
    const check = async () => {
      const time = Date.now();
      setNow(time);
      const { idle, max } = endsRef.current;
      const ended = Math.min(idle, max) <= time;
      const due = idle - time <= WARN_IDLE_MS || (max - time <= WARN_MAX_MS && !maxNoticeSeen.current);
      if (checking || (!ended && !due) || (promptRef.current && !ended && time - lastLook.current < LOOK_EVERY_MS)) return;
      checking = true;
      lastLook.current = time;
      try {
        // Another tab, or a visit, may have moved the end on.
        const status = await sessionStatus('GET');
        if (!status) return;
        if (!status.active) {
          signInAgain();
          return;
        }
        const fresh = toEnds(status);
        setEnds(fresh);
        const at = Date.now();
        if (fresh.idle - at <= WARN_IDLE_MS && fresh.idle < fresh.max) {
          setPrompt('idle');
        } else if (fresh.max - at <= WARN_MAX_MS && !maxNoticeSeen.current) {
          setPrompt('max');
        } else if (promptRef.current === 'idle') {
          setPrompt(null);
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(check, prompt ? 1000 : TICK_MS);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [prompt]);

  const stay = async () => {
    setExtending(true);
    const status = await keepGoing();
    setExtending(false);
    if (status && !status.active) {
      signInAgain();
      return;
    }
    setPrompt(null);
  };

  const dismissMax = () => {
    maxNoticeSeen.current = true;
    setPrompt(null);
  };

  if (!prompt) {
    return null;
  }
  const end = prompt === 'idle' ? ends.idle : ends.max;
  // The sentence names the time once (screen readers read it as the dialog opens); the countdown
  // under it is for the eyes, so it isn't read out every second. In this browser's time zone.
  const at = new Date(end).toLocaleTimeString(INTL_LOCALES[locale], { hour: 'numeric', minute: '2-digit' });
  return (
    <AccessLinkModalPortal open onClose={prompt === 'idle' ? () => void stay() : dismissMax} titleId={titleId} descriptionId={descriptionId}>
      <header className={modalStyles.modalHeader} data-testid="session-prompt">
        <h2 id={titleId} className={modalStyles.modalTitle}>
          {prompt === 'idle' ? t('idleTitle') : t('maxTitle')}
        </h2>
        <p id={descriptionId} className={modalStyles.modalDescription}>
          {prompt === 'idle' ? t('idleText', { time: at }) : t('maxText', { time: at })}
        </p>
        <p aria-hidden="true" data-testid="session-countdown" style={{ margin: '0.75rem 0 0', fontSize: '1.75rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {countdown(end - now)}
        </p>
      </header>
      <footer className={modalStyles.modalFooter}>
        <div className={modalStyles.actions}>
          {prompt === 'idle' ? (
            <>
              <AdminButton type="button" tone="secondary" onClick={() => window.location.assign('/admin/logout')} disabled={extending}>
                {t('signOut')}
              </AdminButton>
              <AdminButton type="button" onClick={() => void stay()} disabled={extending} autoFocus>
                {extending ? t('working') : t('stay')}
              </AdminButton>
            </>
          ) : (
            <>
              <AdminButton type="button" tone="secondary" onClick={() => signInAgain({ ended: false })}>
                {t('signInNow')}
              </AdminButton>
              <AdminButton type="button" onClick={dismissMax} autoFocus>
                {t('ok')}
              </AdminButton>
            </>
          )}
        </div>
      </footer>
    </AccessLinkModalPortal>
  );
}
