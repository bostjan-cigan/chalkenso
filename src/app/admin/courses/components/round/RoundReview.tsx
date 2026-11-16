'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { TbChevronLeft, TbSparkles } from 'react-icons/tb';
import type { AppDraftView } from '@/lib/ai-draft-progress';
import type { LessonDraftView } from '@/lib/ai-drafts';
import type { SavedLessonChange } from '@/lib/lesson-changes';
import type { RoundDecisions, RoundPlan } from '@/lib/version-round-rules';
import { updateLessonInlineAction } from '../../actions';
import { undoLessonChangeAction } from '../../lesson-change-actions';
import { discardRoundAction, draftRoundAction, saveRoundAction, settleRoundAction, startRoundAction, stopRoundAction } from '../../round-actions';
import AdminMenu from '../../../components/ui/AdminMenu';
import AiWorking from '../../../components/ui/AiWorking';
import SegmentedChoice from '../../../components/ui/SegmentedChoice';
import Switch from '../../../components/ui/Switch';
import LessonPart from '../improvements-view/LessonPart';
import CompareSheet from '../workspace/CompareSheet';
import { lessonSaveForm } from '../workspace/lesson-save';
import {
  actionable,
  applyOnto,
  changeSteps,
  nameOfChange,
  placeChanges,
  plainText,
  proposeChanges,
  type ChangeDecision,
  type ChangeState,
  type ProposedChange,
} from '../workspace/revision';
import { useDraftProgress } from '../workspace/useDraftProgress';
import workspace from '../workspace/workspace.module.css';
import type { RoundLessonReview } from './data';
import styles from './round.module.css';

export type RoundNoteView = { id: string; lessonId: string; body: string; passage: string; who: string };
export type RoundLessonView = { id: string; position: number; title: string; reachesCourse: boolean };

type Mode = 'changes' | 'whole';
/** A lesson's draft against the lesson as it is: its changes, where each stands, and the steps they're decided in. */
type Review = { draft: LessonDraftView; base: string; changes: ProposedChange[]; states: Record<string, ChangeState>; steps: ProposedChange[][]; assets: Map<string, string> };
/** A lesson this Publish saved: what Undo puts back. */
type Published = { review: RoundLessonReview; before: string; changes: SavedLessonChange[]; revision: number };

const MODE_KEY = 'chalkenso.round.view';
const rememberedMode = (): Mode => {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'whole' ? 'whole' : 'changes';
  } catch {
    return 'changes';
  }
};

/**
 * "Improve" for a course version or a group's copy, on one page. AI sorts all new feedback into
 * what changes each lesson and what only needs an answer; the lessons' changes are then drafted,
 * and the person works through them here: Keep or Skip for each change (none is decided to start
 * with; "Keep all" for the whole round), read as the changed passages alone or in the whole lesson,
 * with the plan and the notes it answers beside them ("Also to the main course" on a group's copy).
 * A note moves between a lesson's change and the answers; a plan edited or a note moved is drafted
 * again. Publish puts the kept changes into their lessons and sends the replies confirmed or
 * written, with Undo; lessons left undecided stay for later. Edits and decisions save as they're made.
 */
export default function RoundReview({
  versionId,
  courseId,
  backHref,
  backLabel,
  round,
  notes,
  lessons,
  reviews,
}: {
  versionId: string;
  courseId: string;
  backHref: string;
  backLabel: string;
  round:
    | { state: 'none' }
    | { state: 'working' | 'failed'; id: string; draft: AppDraftView }
    | { state: 'ready'; id: string; updatedAt: string; plan: RoundPlan; more: number; decisions: RoundDecisions; drafted: Record<string, string> };
  notes: Record<string, RoundNoteView>;
  lessons: Record<string, RoundLessonView>;
  reviews: Record<string, RoundLessonReview>;
}) {
  const t = useTranslations('courses.round');
  const tc = useTranslations('editor.improvements.column');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const [plan, setPlan] = useState<RoundPlan | null>(round.state === 'ready' ? round.plan : null);
  const [decisions, setDecisions] = useState<RoundDecisions>(round.state === 'ready' ? round.decisions : {});
  // Lessons whose plan or notes changed since their changes were drafted: "Draft again".
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [defaultMode, setDefaultMode] = useState<Mode>('changes');
  const [comparing, setComparing] = useState<{ lessonId: string; index: number } | null>(null);
  const updatedAt = useRef(round.state === 'ready' ? round.updatedAt : '');
  const [draft, setDraft] = useState<AppDraftView | null>(round.state === 'working' || round.state === 'failed' ? round.draft : null);
  const roundId = round.state === 'none' ? null : round.id;
  const drafted = round.state === 'ready' ? round.drafted : {};

  // The plan and decisions as they are now, for what's saved or sent between renders.
  const latest = useRef({ plan, decisions });
  latest.current = { plan, decisions };

  useEffect(() => setDefaultMode(rememberedMode()), []);

  // The round as the page brings it: taken over what's here only when it isn't our own last save.
  useEffect(() => {
    setDraft(round.state === 'working' || round.state === 'failed' ? round.draft : null);
    if (round.state !== 'ready') {
      setPlan(null);
      updatedAt.current = '';
      return;
    }
    if (round.updatedAt === updatedAt.current) return;
    setPlan(round.plan);
    setDecisions(round.decisions);
    setChanged(new Set());
    updatedAt.current = round.updatedAt;
    // What's sent from here on is this round, at once: the drafting below starts in this same pass,
    // before the state above has rendered.
    latest.current = { plan: round.plan, decisions: round.decisions };
  }, [round]);

  // While AI sorts: how far it is; sorted, the page brings the round.
  useDraftProgress<AppDraftView>(draft?.state === 'working' && roundId ? [roundId] : [], (_id, next) => {
    setDraft(next);
    if (next?.state === 'ready' || !next) router.refresh();
  });
  // While the lessons' changes are written: the page brings each one as it's ready.
  const writing = Object.values(reviews).flatMap((review) => (review.draft?.state === 'working' ? [review.draft.id] : []));
  useDraftProgress<LessonDraftView>(writing, (_id, next) => {
    if (!next || next.state !== 'working') router.refresh();
  });

  // Edits and decisions save shortly after they're made, only over the round as it was loaded.
  const saving = useRef<number>(0);
  const edited = () => ({ ...(latest.current.plan ?? { lessons: [], leaveOut: [] }), decisions: latest.current.decisions });
  const saveSoon = () => {
    if (!roundId) return;
    window.clearTimeout(saving.current);
    saving.current = window.setTimeout(async () => {
      const result = await saveRoundAction(roundId, edited(), updatedAt.current);
      if (result.ok) updatedAt.current = result.updatedAt;
      else setError(result.stale ? t('stale') : t('saveFailed'));
    }, 700);
  };
  const edit = (next: RoundPlan, lessonId?: string) => {
    setPlan(next);
    latest.current = { ...latest.current, plan: next };
    if (lessonId && drafted[lessonId]) setChanged((all) => new Set(all).add(lessonId));
    saveSoon();
  };
  const decide = (keys: string[], decision: ChangeDecision | null) => {
    const next = { ...latest.current.decisions };
    for (const key of keys) {
      if (decision) next[key] = decision;
      else delete next[key];
    }
    setDecisions(next);
    latest.current = { ...latest.current, decisions: next };
    saveSoon();
  };

  const start = (again = false) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      if (again && roundId) await discardRoundAction(roundId);
      const result = await startRoundAction(versionId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });

  /** Drafts the lessons not drafted yet (ten at a time), or one lesson again. */
  const draftLessons = (only?: string) =>
    startTransition(async () => {
      if (!roundId) return;
      window.clearTimeout(saving.current);
      setError(null);
      const result = await draftRoundAction(roundId, edited(), updatedAt.current, only);
      if (!result.ok) {
        setError(result.message);
        if (result.stale) router.refresh();
        return;
      }
      // The page brings the round with what was drafted.
      if (only) setChanged((all) => new Set(Array.from(all).filter((id) => id !== only)));
      router.refresh();
    });
  // Sorted: the lessons' changes are drafted without asking, once.
  const drafting = useRef<string | null>(null);
  useEffect(() => {
    if (round.state !== 'ready' || drafting.current === round.id) return;
    if (!round.plan.lessons.length || Object.keys(round.drafted).length) return;
    drafting.current = round.id;
    draftLessons();
    // Runs when the page brings a round, not when its edits change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  // Moving a note: out of its lesson's change into the answers (its suggestion, if any, comes along), or back.
  const answerIt = (noteId: string) => {
    if (!plan) return;
    edit(
      {
        lessons: plan.lessons.map((card) => ({ ...card, noteIds: card.noteIds.filter((id) => id !== noteId) })),
        leaveOut: [...plan.leaveOut, { noteId, suggestion: '', reply: '', duplicateOf: null }],
      },
      notes[noteId]?.lessonId
    );
  };
  const changeIt = (noteId: string) => {
    if (!plan) return;
    const lessonId = notes[noteId]?.lessonId;
    if (!lessonId) return;
    const has = plan.lessons.some((card) => card.lessonId === lessonId);
    const cards = has
      ? plan.lessons.map((card) => (card.lessonId === lessonId ? { ...card, noteIds: [...card.noteIds, noteId] } : card))
      : [...plan.lessons, { lessonId, plan: '', scope: null, noteIds: [noteId] }].sort((a, b) => (lessons[a.lessonId]?.position ?? 0) - (lessons[b.lessonId]?.position ?? 0));
    edit({ lessons: cards, leaveOut: plan.leaveOut.filter((item) => item.noteId !== noteId) }, lessonId);
  };

  // Each drafted lesson's changes, against the lesson as it is now.
  const found = useMemo(() => {
    const map = new Map<string, Review>();
    for (const [lessonId, review] of Object.entries(reviews)) {
      const lessonDraft = review.draft;
      if (!lessonDraft || lessonDraft.state !== 'ready') continue;
      const base = lessonDraft.base || review.lesson.markdown;
      const changes = proposeChanges(base, lessonDraft.markdown);
      const assets = new Map<string, string>();
      for (const asset of Object.values(review.uploadedAssets)) if (asset?.publicUrl) assets.set(asset.sourcePath, asset.publicUrl);
      for (const path of lessonDraft.diagrams) if (!assets.has(path)) assets.set(path, `/admin/api/drafts/${lessonDraft.id}/${path}`);
      map.set(lessonId, { draft: lessonDraft, base, changes, states: placeChanges(base, review.lesson.markdown, changes), steps: changeSteps(changes), assets });
    }
    return map;
  }, [reviews]);

  const keyOf = (review: Review, change: ProposedChange) => `${review.draft.id}:${change.id}`;
  const open = (review: Review, step: ProposedChange[]) => step.filter((change) => actionable(review.states[change.id]));
  /** A step's decision: keep or skip when all it can decide agree, null while it's undecided. */
  const stepDecision = (review: Review, step: ProposedChange[]): ChangeDecision | null => {
    const choosable = open(review, step);
    if (!choosable.length) return null;
    const first = decisions[keyOf(review, choosable[0])];
    return first && choosable.every((change) => decisions[keyOf(review, change)] === first) ? first : null;
  };
  const cards = plan?.lessons ?? [];
  const reviewOf = (lessonId: string) => (cards.some((card) => card.lessonId === lessonId) ? found.get(lessonId) : undefined);
  const decidable = cards.flatMap((card) => {
    const review = reviewOf(card.lessonId);
    return review ? review.steps.filter((step) => open(review, step).length).map((step) => ({ review, step })) : [];
  });
  const kept = decidable.filter(({ review, step }) => stepDecision(review, step) === 'keep').length;
  const replies = plan ? plan.leaveOut.filter((item) => item.reply.trim()).length : 0;
  const undrafted = cards.filter((card) => !drafted[card.lessonId]).length;

  const keepAll = () => decide(decidable.flatMap(({ review, step }) => open(review, step).map((change) => keyOf(review, change))), 'keep');
  const useAll = () => plan && edit({ ...plan, leaveOut: plan.leaveOut.map((item) => (item.reply.trim() || !item.suggestion ? item : { ...item, reply: item.suggestion })) });

  const nameOfStep = (step: ProposedChange[]) => {
    const name = nameOfChange(step);
    return name.kind === 'reworded' ? tc('changeName.reworded', { from: name.from, to: name.to }) : tc(`changeName.${name.kind}`, { text: name.text });
  };

  /**
   * Publish: each lesson with changes kept is saved through its own save (published, on a published
   * lesson; a group's copy also changes the main course where its switch says so), one after
   * another; then the replies are sent and the lessons done leave the round. A lesson that couldn't
   * be saved says why and stays.
   */
  const publish = () =>
    startTransition(async () => {
      if (!plan || !roundId) return;
      window.clearTimeout(saving.current);
      setError(null);
      setNotice(null);
      const published: Published[] = [];
      let changes = 0;
      const failed: string[] = [];
      for (const card of plan.lessons) {
        const review = reviewOf(card.lessonId);
        const source = reviews[card.lessonId];
        if (!review || !source) continue;
        const keep = (change: ProposedChange) => actionable(review.states[change.id]) && decisions[keyOf(review, change)] === 'keep';
        const openChanges = review.changes.filter((change) => actionable(review.states[change.id]));
        const result = applyOnto(review.base, source.lesson.markdown, review.changes, keep, (change) => review.states[change.id] === 'conflict');
        if (!result.applied) continue;
        const form = lessonSaveForm(
          source.lesson,
          result.text,
          source.lesson.revision,
          {
            taskId: source.taskId,
            draftId: review.draft.id,
            before: source.lesson.markdown,
            after: result.text,
            applied: result.applied,
            skipped: openChanges.length - result.applied,
            noteIds: [],
            ...(lessons[card.lessonId]?.reachesCourse ? { toCourse: card.scope === 'group and core' } : {}),
          },
          source.uploadedAssets,
          review.draft.diagrams.map((path) => `${review.draft.id}/${path}`)
        );
        const saved = await updateLessonInlineAction(form);
        if (!saved.ok) {
          failed.push(t('notPublished', { title: source.lesson.title, message: saved.message }));
          continue;
        }
        changes += result.applied;
        published.push({ review: source, before: source.lesson.markdown, changes: saved.changes ?? [], revision: saved.revision ?? source.lesson.revision + 1 });
      }
      const settled = await settleRoundAction(roundId, edited(), updatedAt.current);
      if (settled.ok) updatedAt.current = settled.updatedAt;
      else failed.push(settled.message);
      if (failed.length) setError(failed.join(' '));
      const said = [
        published.length ? t('published', { changes, lessons: published.length }) : '',
        settled.ok && settled.replied ? t('repliesSent', { count: settled.replied }) : '',
      ].filter(Boolean);
      if (said.length) setNotice({ text: said.join(' · '), undo: published.length ? () => undo(published) : undefined });
      router.refresh();
    });

  /** Undo for a Publish: each lesson's text from before saved again, and what its save finished put back. Replies sent stay sent. */
  const undo = (published: Published[]) =>
    startTransition(async () => {
      setNotice(null);
      for (const item of published) {
        const result = await updateLessonInlineAction(lessonSaveForm(item.review.lesson, item.before, item.revision, null, item.review.uploadedAssets, []));
        if (!result.ok) {
          setError(t('notPublished', { title: item.review.lesson.title, message: result.message }));
          continue;
        }
        await Promise.all(item.changes.map((change) => undoLessonChangeAction(change.id, change.task?.from ?? null)));
      }
      setNotice({ text: t('undone') });
      router.refresh();
    });

  const quote = (note: RoundNoteView | undefined) =>
    note ? (
      <blockquote className={styles.note}>
        {note.passage ? <span className={styles.passage}>“{note.passage}”</span> : null}
        <span>{note.body}</span>
        <cite className={styles.who}>{note.who}</cite>
      </blockquote>
    ) : null;

  /** One step as its changed passage alone: what goes struck through, what comes marked. */
  const passage = (step: ProposedChange[]) =>
    step.map((change) =>
      change.kind === 'edit' && change.words ? (
        <p key={change.id} className={styles.passageText}>
          {change.words.map((word, index) => (word.kind === 'same' ? <span key={index}>{word.text}</span> : word.kind === 'added' ? <ins key={index}>{word.text}</ins> : <del key={index}>{word.text}</del>))}
        </p>
      ) : (
        <div key={change.id} className={styles.passageText}>
          {change.before.map((block, index) => (
            <p key={`b${index}`}>
              <del>{plainText(block)}</del>
            </p>
          ))}
          {change.after.map((block, index) => (
            <p key={`a${index}`}>
              <ins>{plainText(block)}</ins>
            </p>
          ))}
        </div>
      )
    );

  const stateOf = (review: Review, step: ProposedChange[]) => {
    const states = step.map((change) => review.states[change.id]);
    if (states.includes('conflict')) return t('state.conflict');
    if (states.every((state) => state === 'done')) return t('state.done');
    if (states.every((state) => state === 'gone')) return t('state.gone');
    return null;
  };

  const changesOf = (lessonId: string, review: Review) => {
    const mode = modes[lessonId] ?? defaultMode;
    return (
      <>
        <div className={styles.viewRow}>
          <SegmentedChoice
            label={t('view')}
            value={mode}
            options={[
              { value: 'changes', label: t('viewChanges'), testId: 'round-view-changes' },
              { value: 'whole', label: t('viewWhole'), testId: 'round-view-whole' },
            ]}
            onChange={(value) => {
              setModes((all) => ({ ...all, [lessonId]: value }));
              setDefaultMode(value);
              try {
                window.localStorage.setItem(MODE_KEY, value);
              } catch {
                // Remembered only where the browser lets it.
              }
            }}
          />
        </div>
        {review.draft.summary ? <p className={styles.quiet}>{review.draft.summary}</p> : null}
        {!review.steps.length ? <p className={styles.quiet}>{t('noChanges')}</p> : null}
        {mode === 'whole' ? (
          <div className={styles.whole} data-testid="round-whole">
            <LessonPart
              text={reviews[lessonId].lesson.markdown}
              focus={[]}
              assets={review.assets}
              changes={{
                list: review.changes,
                states: review.states,
                decisionOf: (change) => decisions[keyOf(review, change)] ?? 'keep',
                onDecide: (change, decision) => decide([keyOf(review, change)], decision),
                isLooked: (change) => Boolean(decisions[keyOf(review, change)]),
              }}
            />
          </div>
        ) : (
          <ol className={styles.changes} data-testid="round-changes">
            {review.steps.map((step, index) => {
              const choosable = open(review, step);
              const decision = stepDecision(review, step);
              const keys = choosable.map((change) => keyOf(review, change));
              const state = stateOf(review, step);
              return (
                <li key={step[0].id} className={styles.change} data-decision={decision ?? undefined} data-testid="round-change">
                  <div className={styles.changeBody}>
                    {step[0].section || state ? <span className={styles.who}>{[step[0].section, state].filter(Boolean).join(' · ')}</span> : null}
                    {passage(step)}
                    <button type="button" className={workspace.textButton} onClick={() => setComparing({ lessonId, index })} aria-label={`${t('sideBySide')}: ${nameOfStep(step)}`}>
                      {t('sideBySide')}
                    </button>
                  </div>
                  {choosable.length ? (
                    <div className={styles.decide} role="group" aria-label={nameOfStep(step)}>
                      <button type="button" className={styles.choice} aria-pressed={decision === 'keep'} onClick={() => decide(keys, decision === 'keep' ? null : 'keep')} data-testid="round-keep">
                        {t('keep')}
                      </button>
                      <button type="button" className={styles.choice} aria-pressed={decision === 'skip'} onClick={() => decide(keys, decision === 'skip' ? null : 'skip')} data-testid="round-skip">
                        {t('skip')}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </>
    );
  };

  const comparingReview = comparing ? reviewOf(comparing.lessonId) : undefined;
  const primary = kept ? (kept === decidable.length ? t('publish', { count: kept }) : t('publishOf', { count: kept, total: decidable.length })) : replies ? t('sendReplies', { count: replies }) : null;

  return (
    <div className={styles.view} data-testid="round-view">
      <header className={styles.head}>
        <Link href={backHref} className={styles.back}>
          <TbChevronLeft aria-hidden size={16} /> {backLabel}
        </Link>
        <h1 className={styles.title}>{t('title')}</h1>
        {plan && decidable.length > kept ? (
          <button type="button" className={workspace.ghostButton} disabled={pending} onClick={keepAll} data-testid="round-keep-all">
            {t('keepAll')}
          </button>
        ) : null}
        {plan && primary ? (
          <button type="button" className={workspace.primaryButton} disabled={pending} onClick={publish} data-testid="round-publish">
            {primary}
          </button>
        ) : null}
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
      {notice ? (
        <p className={styles.notice} role="status" data-testid="round-notice">
          {notice.text}{' '}
          {notice.undo ? (
            <button type="button" className={workspace.textButton} disabled={pending} onClick={notice.undo} data-testid="round-undo">
              {t('undo')}
            </button>
          ) : null}
        </p>
      ) : null}

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
          {cards.length ? (
            cards.map((card) => {
              const lesson = lessons[card.lessonId];
              const source = reviews[card.lessonId];
              const review = found.get(card.lessonId);
              const title = t('lesson', { position: lesson?.position ?? 0, title: lesson?.title ?? '' });
              const again = changed.has(card.lessonId) || (drafted[card.lessonId] && (!source?.draft || source.draft.state === 'failed'));
              return (
                <section key={card.lessonId} className={styles.card} data-testid="round-lesson">
                  <div className={styles.cardHead}>
                    <h2 className={styles.cardTitle}>{title}</h2>
                    {source ? (
                      <Link href={`/admin/courses/${courseId}/lessons/${card.lessonId}/improvements?i=${source.taskId}`} className={workspace.textButton} prefetch={false}>
                        {t('openLesson')}
                      </Link>
                    ) : null}
                  </div>
                  <ul className={styles.notes}>
                    {card.noteIds.map((noteId) => (
                      <li key={noteId} className={styles.noteRow} data-testid="round-note">
                        {quote(notes[noteId])}
                        <button type="button" className={workspace.textButton} onClick={() => answerIt(noteId)} data-testid="round-leave-out">
                          {t('leaveOut')}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <textarea
                    className={styles.plan}
                    value={card.plan}
                    aria-label={t('plan')}
                    onChange={(event) => edit({ ...plan, lessons: plan.lessons.map((one) => (one.lessonId === card.lessonId ? { ...one, plan: event.target.value } : one)) }, card.lessonId)}
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
                  {again ? (
                    <div>
                      <button type="button" className={workspace.ghostButton} disabled={pending} onClick={() => draftLessons(card.lessonId)} data-testid="round-draft-again">
                        {t('draftAgain')}
                      </button>
                    </div>
                  ) : null}
                  {source?.draft?.state === 'working' ? (
                    <AiWorking label={t('drafting')} startedAt={source.draft.startedAt} timeLabel={(time) => t('elapsed', { time })} testId="round-drafting" />
                  ) : null}
                  {source?.draft?.state === 'failed' ? <p className={styles.error}>{source.draft.error ?? t('failed')}</p> : null}
                  {review ? changesOf(card.lessonId, review) : null}
                </section>
              );
            })
          ) : (
            <p className={styles.quiet}>{t('nothingToChange')}</p>
          )}

          {plan.leaveOut.length ? (
            <section className={styles.card} data-testid="round-left-out">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{t('leftOut')}</h2>
                {plan.leaveOut.some((item) => item.suggestion && !item.reply.trim()) ? (
                  <button type="button" className={workspace.textButton} onClick={useAll} data-testid="round-use-all">
                    {t('useAll')}
                  </button>
                ) : null}
              </div>
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

          {undrafted && Object.keys(drafted).length ? (
            <div>
              <button type="button" className={workspace.ghostButton} disabled={pending} onClick={() => draftLessons()} data-testid="round-draft-more">
                {t('draftMore', { count: undrafted })}
              </button>
            </div>
          ) : null}
          {round.state === 'ready' && round.more ? <p className={styles.quiet}>{t('more', { count: round.more })}</p> : null}
        </>
      ) : null}

      {comparing && comparingReview ? (
        <CompareSheet
          steps={comparingReview.steps}
          index={comparing.index}
          onIndex={(index) => setComparing({ lessonId: comparing.lessonId, index })}
          onClose={() => setComparing(null)}
          assets={comparingReview.assets}
        />
      ) : null}
    </div>
  );
}
