'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { deleteCommentAction, leaveOutFeedbackAction, resolveCommentAction, respondToCommentAction } from '../../comments/actions';
import AdminMenu from '../../../components/ui/AdminMenu';
import ConfirmDialog from '../ConfirmDialog';
import { TickMark } from './Column';
import type { ViewFeedback } from './data';
import workspace from '../workspace/workspace.module.css';
import styles from './improvements-view.module.css';

/**
 * A piece of feedback, whole, in the column: the passage and what was said, then a reply. The
 * lesson's feedback is in its next change by default; **Leave out** takes it out of that, with the
 * reply saying why (required: whoever gave it hears back), and it's done. On feedback already in
 * the change, **Reply** only answers it. In the "⋯" menu: Mark done without a reply, Delete. Where
 * `onTick` is given (no AI: feedback is picked by hand), its tick picks it.
 */
export default function FeedbackDetail({
  feedback,
  used,
  canWork,
  afterDraft,
  pending: deciding,
  onTick,
  onAnswered,
  onNotice,
}: {
  feedback: ViewFeedback;
  /** Ticked: the lesson's improvement uses it. */
  used: boolean;
  canWork: boolean;
  /** The lesson's improvement has its changes drafted: what's ticked now waits for the next draft. */
  afterDraft: boolean;
  /** Ticking is under way. */
  pending: boolean;
  /** Without it the feedback isn't decided here (an earlier improvement's, another lesson's). */
  onTick?: () => void;
  /** It's decided without being used (replied to, marked done, deleted): the line to show, and the column goes back. */
  onAnswered: (text: string) => void;
  /** A line to show for anything else. */
  onNotice: (text: string) => void;
}) {
  const t = useTranslations('editor.improvements.feedback');
  const tc = useTranslations('editor.improvements.column');
  const router = useRouter();
  const replyId = useId();
  const [pending, startTransition] = useTransition();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const form = () => {
    const data = new FormData();
    data.set('commentId', feedback.id);
    return data;
  };
  const busy = pending || deciding;
  const send = () =>
    startTransition(async () => {
      if (!reply.trim()) {
        setError(t('replyFirst'));
        return;
      }
      const { done } = await respondToCommentAction(feedback.id, reply);
      setReply('');
      if (done) onAnswered(t('repliedDone'));
      else onNotice(t('replied'));
      router.refresh();
    });
  /** Out of the change, with the reply saying why. */
  const leaveOut = () =>
    startTransition(async () => {
      if (!reply.trim()) {
        setError(t('replyFirst'));
        return;
      }
      const result = await leaveOutFeedbackAction([feedback.id], reply);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReply('');
      onAnswered(result.left ? t('leftOut') : t('notLeftOut'));
      router.refresh();
    });

  return (
    <div className={styles.feedbackDetail}>
      <blockquote className={styles.quote}>
        {feedback.passage ? <span className={styles.passage}>“{feedback.passage}”</span> : null}
        <span>{feedback.body}</span>
        <cite className={styles.who}>{feedback.who}</cite>
      </blockquote>
      {feedback.lessonHref ? (
        <Link href={feedback.lessonHref} className={workspace.textButton}>
          {tc('openOtherLesson')}
        </Link>
      ) : null}
      {onTick ? (
        <>
          <button type="button" className={styles.tickRow} aria-pressed={used} disabled={busy} onClick={onTick} data-testid="feedback-tick">
            <span>{tc('fixWithAi')}</span>
            <TickMark on={used} />
          </button>
          {used && afterDraft ? <p className={styles.quiet}>{t('waitsForDraft')}</p> : null}
        </>
      ) : null}
      {canWork && !feedback.lessonHref ? (
        <div className={styles.reply}>
          <label className={styles.label} htmlFor={replyId}>
            {t('reply')}
          </label>
          <textarea
            id={replyId}
            className={styles.replyBox}
            value={reply}
            onChange={(event) => {
              setReply(event.target.value);
              setError(null);
            }}
            data-testid="feedback-reply-box"
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            {!used ? (
              <AdminMenu
                label={t('more')}
                items={[
                  {
                    label: t('markDone'),
                    onSelect: () =>
                      startTransition(async () => {
                        await resolveCommentAction(form());
                        onAnswered(t('markedDone'));
                        router.refresh();
                      }),
                  },
                  { label: t('delete'), danger: true, onSelect: () => setDeleting(true) },
                ]}
              />
            ) : null}
            <span className={styles.spacer} />
            {/* In the change: a reply only answers it. Leave out takes it out, with the reply. */}
            {used ? (
              <button type="button" className={workspace.textButton} disabled={busy} onClick={send} data-testid="feedback-send-reply">
                {t('send')}
              </button>
            ) : null}
            <button type="button" className={workspace.ghostButton} disabled={busy} onClick={leaveOut} data-testid="feedback-leave-out">
              {t('leaveOut')}
            </button>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={deleting}
        tone="danger"
        title={t('deleteTitle')}
        description={t('deleteText')}
        confirmLabel={t('delete')}
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            await deleteCommentAction(form());
            setDeleting(false);
            onAnswered(t('deleted'));
            router.refresh();
          })
        }
        onClose={() => setDeleting(false)}
      />
    </div>
  );
}
