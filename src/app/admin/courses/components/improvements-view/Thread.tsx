'use client';

import { useTranslations } from 'next-intl';
import { TbArrowUp, TbPlayerStopFilled } from 'react-icons/tb';
import type { ThreadAttempt } from '@/lib/improvement-thread';
import workspace from '../workspace/workspace.module.css';
import styles from './improvements-view.module.css';

/**
 * An improvement's thread, above the changes waiting now: each earlier attempt as one line (what
 * it did, how many changes, Use this one), and what the person asked for the next, in their words.
 * The attempt waiting now is the changes below it; what was asked for it ends the thread. Without
 * `onUse` it's a finished improvement's, read-only: every attempt, the one used among them.
 */
export function Thread({ attempts, pending = false, onUse }: { attempts: ThreadAttempt[]; pending?: boolean; onUse?: (attempt: ThreadAttempt) => void }) {
  const t = useTranslations('editor.improvements.thread');
  const tc = useTranslations('editor.improvements');
  // A thread of one attempt, written from the plan: nothing to show beyond its changes.
  if (attempts.length < 2 && !attempts.some((attempt) => attempt.request)) return null;
  return (
    <ol className={styles.thread} aria-label={t('label')} data-testid="thread">
      {attempts.map((attempt, index) => (
        <li key={attempt.id} className={styles.threadItem}>
          {attempt.request ? (
            <p className={styles.threadAsked} data-testid="thread-request">
              {attempt.request}
            </p>
          ) : null}
          {attempt.current && onUse ? null : (
            <div className={styles.threadAttempt} data-testid="thread-attempt">
              <span className={styles.threadAttemptText}>
                <span className={styles.changeLabel}>
                  {t('attempt', { number: index + 1 })} · {tc('changeCount', { count: attempt.changes })}
                </span>
                {attempt.summary ? <span className={styles.who}>{attempt.summary}</span> : null}
              </span>
              {onUse ? (
                <button type="button" className={workspace.textButton} disabled={pending} onClick={() => onUse(attempt)} data-testid="thread-use">
                  {t('use')}
                </button>
              ) : attempt.current ? (
                <span className={styles.who}>{t('used')}</span>
              ) : null}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The thread's message field: what to change in the attempt waiting now ("shorter", "keep the
 * example"). AI answers with a new attempt that goes on from it, as kept; while it writes, Stop.
 */
export function Composer({
  value,
  error,
  working,
  disabled,
  onChange,
  onSend,
  onStop,
}: {
  value: string;
  error: string | null;
  working: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const t = useTranslations('editor.improvements.thread');
  return (
    <div className={styles.composer}>
      <form
        className={styles.askRow}
        onSubmit={(event) => {
          event.preventDefault();
          if (working) onStop();
          else onSend();
        }}
      >
        <input
          className={styles.askInput}
          value={value}
          maxLength={1000}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('ask')}
          disabled={disabled || working}
          data-testid="thread-ask"
        />
        {working ? (
          <button type="submit" className={styles.askSend} aria-label={t('stop')} title={t('stop')} data-testid="thread-stop">
            <TbPlayerStopFilled aria-hidden size={14} />
          </button>
        ) : (
          <button type="submit" className={styles.askSend} disabled={disabled} aria-label={t('send')} title={t('send')} data-testid="thread-send">
            <TbArrowUp aria-hidden size={16} />
          </button>
        )}
      </form>
      {error ? (
        <p className={styles.error} data-testid="thread-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
