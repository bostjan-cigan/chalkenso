'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { TbChevronLeft, TbSparkles } from 'react-icons/tb';
import type { AppDraftView } from '@/lib/ai-draft-progress';
import { leftToAnswer, type RoundPlan } from '@/lib/version-round-rules';
import { approveRoundAction, discardRoundAction, saveRoundAction, startRoundAction, stopRoundAction } from '../../round-actions';
import AdminMenu from '../../../components/ui/AdminMenu';
import AiWorking from '../../../components/ui/AiWorking';
import Switch from '../../../components/ui/Switch';
import { useDraftProgress } from '../workspace/useDraftProgress';
import workspace from '../workspace/workspace.module.css';
import styles from './round.module.css';

export type RoundNoteView = { id: string; lessonId: string; body: string; passage: string; who: string };
export type RoundLessonView = { id: string; position: number; title: string; reachesCourse: boolean };

/**
 * "Sort with AI" for a course version or a group's copy, on one page: AI sorts all new feedback,
 * then the person edits it here: each lesson's plan and the notes it answers ("Also to the main
 * course" on a group's copy), and the notes left out, each with a reply box AI only suggests for
 * (Use takes the suggestion; typing writes your own). Approve drafts the lessons' changes and sends
 * the replies written; notes left without one stay open. Edits save as they're made.
 */
export default function RoundView({
  versionId,
  backHref,
  backLabel,
  round,
  notes,
  lessons,
}: {
  versionId: string;
  backHref: string;
  backLabel: string;
  round:
    | { state: 'none' }
    | { state: 'working' | 'failed'; id: string; draft: AppDraftView }
    | { state: 'ready'; id: string; updatedAt: string; plan: RoundPlan; more: number };
  notes: Record<string, RoundNoteView>;
  lessons: Record<string, RoundLessonView>;
}) {
  const t = useTranslations('courses.round');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<RoundPlan | null>(round.state === 'ready' ? round.plan : null);
  const updatedAt = useRef(round.state === 'ready' ? round.updatedAt : '');
  const [draft, setDraft] = useState<AppDraftView | null>(round.state === 'working' || round.state === 'failed' ? round.draft : null);
  const roundId = round.state === 'none' ? null : round.id;

  // A new round from the page (sorted again, approved elsewhere): start from it.
  useEffect(() => {
    setPlan(round.state === 'ready' ? round.plan : null);
    updatedAt.current = round.state === 'ready' ? round.updatedAt : '';
    setDraft(round.state === 'working' || round.state === 'failed' ? round.draft : null);
  }, [round]);

  // While AI sorts: how far it is; sorted, the page brings the round.
  useDraftProgress<AppDraftView>(draft?.state === 'working' && roundId ? [roundId] : [], (_id, next) => {
    setDraft(next);
    if (next?.state === 'ready' || !next) router.refresh();
  });

  // Edits save shortly after they're made, only over the round as it was loaded.
  const saving = useRef<number>(0);
  const edit = (next: RoundPlan) => {
    setPlan(next);
    if (!roundId) return;
    window.clearTimeout(saving.current);
    saving.current = window.setTimeout(async () => {
      const result = await saveRoundAction(roundId, next, updatedAt.current);
      if (result.ok) updatedAt.current = result.updatedAt;
      else setError(result.stale ? t('stale') : t('saveFailed'));
    }, 700);
  };

  const start = (again = false) =>
    startTransition(async () => {
      setError(null);
      if (again && roundId) await discardRoundAction(roundId);
      const result = await startRoundAction(versionId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });

  const approve = () =>
    startTransition(async () => {
      if (!plan || !roundId) return;
      window.clearTimeout(saving.current);
      setError(null);
      const result = await approveRoundAction(roundId, plan, updatedAt.current);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.href) router.push(result.href);
      else {
        setNotice(t('approved', { replied: result.replied }));
        router.refresh();
      }
    });

  // Moving a note: out of its lesson's change (its suggestion, if any, comes along), or back into it.
  const leaveOut = (noteId: string) => {
    if (!plan) return;
    edit({
      lessons: plan.lessons.map((card) => ({ ...card, noteIds: card.noteIds.filter((id) => id !== noteId) })),
      leaveOut: [...plan.leaveOut, { noteId, suggestion: '', reply: '', duplicateOf: null }],
    });
  };
  const changeIt = (noteId: string) => {
    if (!plan) return;
    const lessonId = notes[noteId]?.lessonId;
    if (!lessonId) return;
    const has = plan.lessons.some((card) => card.lessonId === lessonId);
    const cards = has
      ? plan.lessons.map((card) => (card.lessonId === lessonId ? { ...card, noteIds: [...card.noteIds, noteId] } : card))
      : [...plan.lessons, { lessonId, plan: '', scope: null, noteIds: [noteId] }].sort((a, b) => (lessons[a.lessonId]?.position ?? 0) - (lessons[b.lessonId]?.position ?? 0));
    edit({ lessons: cards, leaveOut: plan.leaveOut.filter((item) => item.noteId !== noteId) });
  };

  const quote = (note: RoundNoteView | undefined) =>
    note ? (
      <blockquote className={styles.note}>
        {note.passage ? <span className={styles.passage}>“{note.passage}”</span> : null}
        <span>{note.body}</span>
        <cite className={styles.who}>{note.who}</cite>
      </blockquote>
    ) : null;

  const open = plan ? leftToAnswer(plan) : 0;

  return (
    <div className={styles.view} data-testid="round-view">
      <header className={styles.head}>
        <Link href={backHref} className={styles.back}>
          <TbChevronLeft aria-hidden size={16} /> {backLabel}
        </Link>
        <h1 className={styles.title}>{t('title')}</h1>
        {round.state === 'ready' ? (
          <AdminMenu
            label={t('title')}
            items={[
              { label: t('sortAgain'), onSelect: () => start(true) },
              {
                label: t('discard'),
                danger: true,
                onSelect: () =>
                  startTransition(async () => {
                    if (roundId) await discardRoundAction(roundId);
                    router.refresh();
                  }),
              },
            ]}
          />
        ) : null}
      </header>

      {error ? <p className={styles.error} data-testid="round-error">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      {round.state === 'none' ? (
        <div className={styles.start}>
          <button type="button" className={workspace.primaryButton} disabled={pending} onClick={() => start()} data-testid="round-start">
            <TbSparkles aria-hidden size={16} /> {t('sort')}
          </button>
        </div>
      ) : null}

      {draft && draft.state === 'working' ? (
        <AiWorking
          label={t('working')}
          startedAt={draft.startedAt}
          timeLabel={(time) => t('elapsed', { time })}
          actions={
            <button
              type="button"
              className={workspace.ghostButton}
              onClick={() =>
                startTransition(async () => {
                  if (roundId) await stopRoundAction(roundId);
                  router.refresh();
                })
              }
            >
              {t('stop')}
            </button>
          }
          testId="round-working"
        />
      ) : null}
      {draft && draft.state === 'failed' ? (
        <p className={styles.error}>
          {draft.error ?? t('failed')}{' '}
          <button type="button" className={workspace.textButton} onClick={() => start(true)}>
            {t('tryAgain')}
          </button>
        </p>
      ) : null}

      {plan ? (
        <>
          {plan.lessons.length ? (
            plan.lessons.map((card) => {
              const lesson = lessons[card.lessonId];
              return (
                <section key={card.lessonId} className={styles.card} data-testid="round-lesson">
                  <h2 className={styles.cardTitle}>{t('lesson', { position: lesson?.position ?? 0, title: lesson?.title ?? '' })}</h2>
                  <textarea
                    className={styles.plan}
                    value={card.plan}
                    aria-label={t('lesson', { position: lesson?.position ?? 0, title: lesson?.title ?? '' })}
                    onChange={(event) => edit({ ...plan, lessons: plan.lessons.map((one) => (one.lessonId === card.lessonId ? { ...one, plan: event.target.value } : one)) })}
                    rows={Math.min(10, Math.max(3, card.plan.split('\n').length + 1))}
                    data-testid="round-plan"
                  />
                  {lesson?.reachesCourse ? (
                    <div className={styles.switchRow}>
                      <span>{t('alsoCourse')}</span>
                      <Switch
                        on={card.scope === 'group and core'}
                        label={t('alsoCourse')}
                        onChange={() =>
                          edit({ ...plan, lessons: plan.lessons.map((one) => (one.lessonId === card.lessonId ? { ...one, scope: one.scope === 'group and core' ? 'group only' : 'group and core' } : one)) })
                        }
                      />
                    </div>
                  ) : null}
                  <ul className={styles.notes}>
                    {card.noteIds.map((noteId) => (
                      <li key={noteId} className={styles.noteRow} data-testid="round-note">
                        {quote(notes[noteId])}
                        <button type="button" className={workspace.textButton} onClick={() => leaveOut(noteId)} data-testid="round-leave-out">
                          {t('leaveOut')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          ) : (
            <p className={styles.quiet}>{t('nothingToChange')}</p>
          )}

          {plan.leaveOut.length ? (
            <section className={styles.card} data-testid="round-left-out">
              <h2 className={styles.cardTitle}>{t('leftOut')}</h2>
              <ul className={styles.notes}>
                {plan.leaveOut.map((item) => (
                  <li key={item.noteId} className={styles.noteRow} data-testid="round-left">
                    {quote(notes[item.noteId])}
                    {item.duplicateOf && notes[item.duplicateOf] ? <p className={styles.quiet}>{t('sameAs', { text: notes[item.duplicateOf].body.slice(0, 80) })}</p> : null}
                    <textarea
                      className={styles.reply}
                      value={item.reply}
                      placeholder={item.suggestion}
                      aria-label={t('reply')}
                      maxLength={1000}
                      onChange={(event) => edit({ ...plan, leaveOut: plan.leaveOut.map((one) => (one.noteId === item.noteId ? { ...one, reply: event.target.value } : one)) })}
                      data-testid="round-reply"
                    />
                    <div className={styles.noteActions}>
                      {item.suggestion && !item.reply.trim() ? (
                        <button
                          type="button"
                          className={workspace.textButton}
                          onClick={() => edit({ ...plan, leaveOut: plan.leaveOut.map((one) => (one.noteId === item.noteId ? { ...one, reply: one.suggestion } : one)) })}
                          data-testid="round-use"
                        >
                          {t('use')}
                        </button>
                      ) : null}
                      <button type="button" className={workspace.textButton} onClick={() => changeIt(item.noteId)} data-testid="round-change-it">
                        {t('changeIt')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className={styles.foot}>
            {round.state === 'ready' && round.more ? <span className={styles.quiet}>{t('more', { count: round.more })}</span> : <span />}
            <button type="button" className={workspace.primaryButton} disabled={pending} onClick={approve} data-testid="round-approve">
              {open ? t('approveOpen', { count: open }) : t('approve')}
            </button>
          </footer>
        </>
      ) : null}
    </div>
  );
}
