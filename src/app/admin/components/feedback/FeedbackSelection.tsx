'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from 'react';
import { fixWithAiAction, leaveOutFeedbackAction } from '@/app/admin/courses/comments/actions';
import AdminButton from '../ui/AdminButton';
import styles from './feedback.module.css';

/**
 * Picking many pieces of feedback at once on a Feedback list ("Select"): each new piece, a lesson's
 * at once, or all. Fix with AI takes them up and has each lesson's plan and changes drafted (then
 * the first lesson opens, the rest follow with Next); Leave out answers them all with one reply
 * (required) and marks them done. Only new feedback the person may work on can be picked.
 */
type Selection = {
  on: boolean;
  can: (id: string) => boolean;
  picked: (id: string) => boolean;
  toggle: (ids: string[], on: boolean) => void;
};

const SelectionContext = createContext<Selection | null>(null);

export function useFeedbackSelection() {
  return useContext(SelectionContext);
}

export function FeedbackSelection({ selectable, aiEnabled, children }: { selectable: string[]; aiEnabled: boolean; children: ReactNode }) {
  const t = useTranslations('app.feedback.select');
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const allowed = useMemo(() => new Set(selectable), [selectable]);
  const selection: Selection = {
    on,
    can: (id) => allowed.has(id),
    picked: (id) => picked.has(id),
    toggle: (ids, value) =>
      setPicked((all) => {
        const next = new Set(all);
        for (const id of ids) if (allowed.has(id)) (value ? next.add(id) : next.delete(id));
        return next;
      }),
  };
  const ids = Array.from(picked);
  const stop = () => {
    setOn(false);
    setPicked(new Set());
    setLeaving(false);
    setReply('');
    setError(null);
  };
  const fix = () =>
    startTransition(async () => {
      setError(null);
      const result = await fixWithAiAction(ids, { draft: aiEnabled });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const first = result.lessons.find((lesson) => lesson.state !== 'skipped');
      stop();
      if (aiEnabled && first) router.push(first.href);
      else {
        setNotice(t('used', { count: ids.length }));
        router.refresh();
      }
    });
  const leaveOut = () =>
    startTransition(async () => {
      if (!reply.trim()) {
        setError(t('replyFirst'));
        return;
      }
      const result = await leaveOutFeedbackAction(ids, reply);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      stop();
      setNotice(t('leftOut', { count: result.left }));
      router.refresh();
    });

  return (
    <SelectionContext.Provider value={selection}>
      {selectable.length ? (
        <div className={styles.selectBar} data-testid="feedback-select-bar">
          {on ? (
            <>
              <label className={styles.selectAll}>
                <input
                  type="checkbox"
                  checked={ids.length > 0 && ids.length === allowed.size}
                  onChange={(event) => selection.toggle(selectable, event.target.checked)}
                  data-testid="feedback-select-all"
                />
                {t('all')}
              </label>
              <span className={styles.selectCount}>{t('picked', { count: ids.length })}</span>
              <span className={styles.selectSpacer} />
              <AdminButton type="button" size="compact" tone="secondary" disabled={pending || !ids.length} onClick={() => setLeaving(true)} data-testid="feedback-leave-out">
                {t('leaveOut')}
              </AdminButton>
              <AdminButton type="button" size="compact" disabled={pending || !ids.length} onClick={fix} data-testid="feedback-fix">
                {aiEnabled ? t('fix') : t('use')}
              </AdminButton>
              <button type="button" className={styles.selectDone} onClick={stop}>
                {t('cancel')}
              </button>
            </>
          ) : (
            <>
              {notice ? <span className={styles.selectCount}>{notice}</span> : null}
              <span className={styles.selectSpacer} />
              <button
                type="button"
                className={styles.selectDone}
                onClick={() => {
                  setNotice(null);
                  setOn(true);
                }}
                data-testid="feedback-select"
              >
                {t('select')}
              </button>
            </>
          )}
        </div>
      ) : null}
      {on && leaving ? (
        <div className={styles.selectReply}>
          <label className={styles.itemComposerLabel} htmlFor="leave-out-reply">
            {t('reply', { count: ids.length })}
          </label>
          <textarea
            id="leave-out-reply"
            className={styles.itemTextarea}
            value={reply}
            maxLength={4000}
            onChange={(event) => {
              setReply(event.target.value);
              setError(null);
            }}
            autoFocus
            data-testid="feedback-leave-out-reply"
          />
          <div className={styles.itemActions}>
            <AdminButton type="button" size="compact" disabled={pending} onClick={leaveOut} data-testid="feedback-leave-out-send">
              {t('leaveOutSend', { count: ids.length })}
            </AdminButton>
            <AdminButton type="button" size="compact" tone="secondary" disabled={pending} onClick={() => setLeaving(false)}>
              {t('cancel')}
            </AdminButton>
          </div>
        </div>
      ) : null}
      {error ? <p className={styles.itemError}>{error}</p> : null}
      {children}
    </SelectionContext.Provider>
  );
}

/** A lesson's heading in the list, with its box to pick all its new feedback at once. */
export function LessonPick({ ids, children }: { ids: string[]; children: ReactNode }) {
  const selection = useFeedbackSelection();
  const own = ids.filter((id) => selection?.can(id));
  const all = own.length > 0 && own.every((id) => selection?.picked(id));
  return (
    <h3 className={styles.lessonHead}>
      {selection?.on && own.length ? (
        <input type="checkbox" checked={all} onChange={(event) => selection.toggle(own, event.target.checked)} aria-label={String(children)} data-testid="feedback-select-lesson" />
      ) : null}
      {children}
    </h3>
  );
}

/** One piece of feedback's box, while picking. */
export function ItemPick({ id }: { id: string }) {
  const selection = useFeedbackSelection();
  if (!selection?.on || !selection.can(id)) return null;
  return <input type="checkbox" checked={selection.picked(id)} onChange={(event) => selection.toggle([id], event.target.checked)} data-testid="feedback-select-item" />;
}
