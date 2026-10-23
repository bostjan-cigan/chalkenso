'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { TbCheck, TbCircleCheck, TbListCheck, TbMessageReply } from 'react-icons/tb';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';
import { INTL_LOCALES } from '@/i18n/config';
import LinkFeedbackModal, { type FeedbackRoster } from '@/app/admin/courses/groups/components/LinkFeedbackModal';
import {
  deleteCommentAction,
  reopenCommentAction,
  resolveCommentAction,
  respondToCommentAction,
  takeUpFeedbackAction,
} from '@/app/admin/courses/comments/actions';
import AdminBadge from '../ui/AdminBadge';
import AdminButton from '../ui/AdminButton';
import AdminMenu, { type AdminMenuItem } from '../ui/AdminMenu';
import type { FeedbackItemView } from './feedback-view';
import styles from './feedback.module.css';

/** Each stage's badge (its words: `app.feedback.stage`). */
const STAGE_VARIANT: Record<FeedbackItemView['stage'], 'accent' | 'warning' | 'muted'> = {
  new: 'accent',
  replied: 'muted',
  task: 'warning',
  done: 'muted',
};

/**
 * One piece of feedback: who sent it, on which passage, and what happened to it. Two actions: Use
 * (the main one: it joins its lesson's improvement, which plans and changes the lesson once for all
 * the feedback used there; the list stays, to go through the rest) and Reply (a reply on its own
 * answers it: it's marked done). The rest is in the "⋯" menu: Mark done (no change needed) or
 * Reopen, Link to a learner… (feedback that isn't on its learner's current link), Delete. Used
 * feedback links to its lesson's improvement instead of Use.
 */
export default function FeedbackItem({
  item,
  canWork,
  canDelete,
  roster = null,
}: {
  item: FeedbackItemView;
  /** Reply, make a task, mark done, reopen (Feedback & tasks on). */
  canWork: boolean;
  /** Delete (Lessons "Can edit"). */
  canDelete: boolean;
  /** The roster to link it to, when it isn't on its learner's current link (the group's Feedback tab). */
  roster?: FeedbackRoster | null;
}) {
  const router = useRouter();
  const t = useTranslations('app.feedback');
  const locale = useLocale();
  // "17 Oct", "17. okt.": the language's own date style (`INTL_LOCALES`, not next-intl's bare `en`).
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(INTL_LOCALES[locale], { day: 'numeric', month: 'short' }), [locale]);
  const [reply, setReply] = useState(item.adminResponse ?? '');
  const [draft, setDraft] = useState(item.adminResponse ?? '');
  const [composing, setComposing] = useState(false);
  const [task, setTask] = useState(item.task);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = item.status === 'OPEN';
  // A note's author by name; a learner stays "this learner".
  const replyShown = item.isInstructorNote ? t('replyShownName', { name: item.proposerName }) : t('replyShownLearner');
  const replyTo = item.isInstructorNote ? t('replyToName', { name: item.proposerName }) : t('replyToLearner');

  function run(work: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        router.refresh();
      } catch {
        setError(t('failed'));
      }
    });
  }

  function sendReply() {
    run(async () => {
      await respondToCommentAction(item.id, draft);
      setReply(draft.trim());
      setComposing(false);
    });
  }

  /** Use: the feedback joins its lesson's improvement; the list stays where it is. */
  function use() {
    setError(null);
    startTransition(async () => {
      const result = await takeUpFeedbackAction(item.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTask({ id: result.taskId, title: '', status: result.created ? 'TODO' : (task?.status ?? 'TODO'), changedAt: null });
      router.refresh();
    });
  }

  function setDone(done: boolean) {
    const formData = new FormData();
    formData.set('commentId', item.id);
    run(async () => {
      await (done ? resolveCommentAction(formData) : reopenCommentAction(formData));
    });
  }

  function remove() {
    const formData = new FormData();
    formData.set('commentId', item.id);
    run(async () => {
      await deleteCommentAction(formData);
      setConfirmDelete(false);
    });
  }

  const menu: AdminMenuItem[] = [
    ...(canWork ? [open ? { label: t('markDone'), onSelect: () => setDone(true) } : { label: t('reopen'), onSelect: () => setDone(false) }] : []),
    ...(roster ? [{ label: t('linkToLearner'), onSelect: () => setLinking(true) }] : []),
    ...(canDelete ? [{ label: t('delete'), danger: true, onSelect: () => setConfirmDelete(true) }] : []),
  ];

  const stage = task && open && (task.status === 'TODO' || task.status === 'IN_PROGRESS') ? 'task' : item.stage;

  return (
    <article id={`comment-${item.id}`} className={open ? styles.item : `${styles.item} ${styles.itemDone}`}>
      <header className={styles.itemHead}>
        <strong className={styles.itemWho}>{item.proposerName}</strong>
        {item.isInstructorNote ? <AdminBadge variant="warning">{t('note')}</AdminBadge> : null}
        <span className={styles.itemMeta}>·</span>
        {item.lessonHref ? (
          <Link href={item.lessonHref} className={styles.itemLesson}>
            {t('lesson', { position: item.lessonPosition, title: item.lessonTitle })}
          </Link>
        ) : (
          <span className={styles.itemMeta}>{t('lesson', { position: item.lessonPosition, title: item.lessonTitle })}</span>
        )}
        {item.copyLabel ? <span className={styles.itemMeta}>({item.copyLabel})</span> : null}
        <span className={styles.itemMeta}>· {dateFormat.format(new Date(item.createdAt))}</span>
        <span className={styles.itemHeadEnd}>
          <AdminBadge variant={STAGE_VARIANT[stage]}>{t(`stage.${stage}`)}</AdminBadge>
          {menu.length ? <AdminMenu label={t('actions')} items={menu} /> : null}
        </span>
      </header>

      <blockquote className={styles.itemPassage}>“{item.selectedText}”</blockquote>
      <p className={styles.itemBody}>{item.body}</p>

      {reply && !composing ? (
        <div className={styles.itemReply}>
          <p className={styles.itemReplyLabel}>{replyShown}</p>
          <p className={styles.itemReplyText}>{reply}</p>
        </div>
      ) : null}

      {composing ? (
        <div className={styles.itemComposer}>
          <label className={styles.itemComposerLabel} htmlFor={`reply-${item.id}`}>
            {reply ? t('editYourReply') : replyTo}
          </label>
          <textarea
            id={`reply-${item.id}`}
            className={styles.itemTextarea}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={item.isInstructorNote ? t('notePlaceholder') : t('learnerPlaceholder')}
            maxLength={4000}
            autoFocus
          />
          {/* Not used in an improvement, a reply is its answer. */}
          {open && !task ? <p className={styles.itemMeta}>{t('replyMarksDone')}</p> : null}
          <div className={styles.itemActions}>
            <AdminButton type="button" size="compact" onClick={sendReply} disabled={pending || !draft.trim()}>
              {pending ? t('sending') : reply ? t('updateReply') : t('sendReply')}
            </AdminButton>
            <AdminButton
              type="button"
              size="compact"
              tone="secondary"
              disabled={pending}
              onClick={() => {
                setDraft(reply);
                setComposing(false);
              }}
            >
              {t('cancel')}
            </AdminButton>
          </div>
        </div>
      ) : null}

      {task?.status === 'DONE' && task.changedAt ? (
        <p className={styles.itemChanged} data-testid="feedback-changed">
          <TbCircleCheck size={15} aria-hidden /> {t('changedOn', { date: dateFormat.format(new Date(task.changedAt)) })}
        </p>
      ) : null}

      {canWork && !composing ? (
        <div className={styles.itemActions}>
          {task?.status === 'DONE' && task.changedAt ? (
            <Link href={item.improvementsHref ? `${item.improvementsHref}?i=${task.id}` : `/admin/tasks/${task.id}`} className={styles.itemAction} data-testid="feedback-see-changes">
              <TbListCheck size={15} aria-hidden /> {t('seeWhatChanged')}
            </Link>
          ) : task ? (
            <Link href={item.improvementsHref ? `${item.improvementsHref}?i=${task.id}` : `/admin/tasks/${task.id}`} className={styles.itemAction}>
              <TbListCheck size={15} aria-hidden /> {t('used', { status: t(`taskStatus.${task.status}`) })}
            </Link>
          ) : open ? (
            <button type="button" className={`${styles.itemAction} ${styles.itemActionPrimary}`} onClick={use} disabled={pending} data-testid="feedback-use">
              <TbCheck size={15} aria-hidden /> {t('use')}
            </button>
          ) : null}
          <button type="button" className={styles.itemAction} onClick={() => setComposing(true)} disabled={pending}>
            <TbMessageReply size={15} aria-hidden /> {reply ? t('editReply') : t('reply')}
          </button>
        </div>
      ) : null}
      {error ? <p className={styles.itemError}>{error}</p> : null}

      {roster && linking ? (
        <LinkFeedbackModal open={linking} onClose={() => setLinking(false)} commentId={item.id} memberId={item.memberId} roster={roster} />
      ) : null}

      {canDelete ? (
        <ConfirmDialog
          open={confirmDelete}
          tone="danger"
          title={t('deleteTitle')}
          description={t('deleteText')}
          confirmLabel={t('deleteConfirm')}
          pending={pending}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </article>
  );
}
