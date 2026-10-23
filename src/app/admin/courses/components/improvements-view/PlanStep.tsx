'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { AiProposalKind } from '@prisma/client';
import { TbArrowUp } from 'react-icons/tb';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { POLL_MS, type AppDraftView } from '@/lib/ai-draft-progress';
import { parsePlanScope, planBody, withPlanScope, type PlanScope } from '@/lib/plan-scope';
import {
  settleTaskPlanDraftAction,
  startTaskPlanDraftAction,
  stopTaskPlanDraftAction,
  taskPlanDraftAction,
  updateTaskPlanAction,
} from '../../../tasks/actions';
import PlanDraftStatus from '../../../tasks/components/PlanDraftStatus';
import { announceSaved, handoffDraft } from '../workspace/events';
import { useHandoffStarted } from '../workspace/useHandoffStarted';
import type { ViewImprovement } from './data';
import TextEditor, { type TextEditorHandle } from './TextEditor';
import workspace from '../workspace/workspace.module.css';
import styles from './improvements-view.module.css';

const NO_ASSETS = new Map<string, string>();

/** A plan as a person reads it: its Markdown (headings, lists, emphasis) rendered, not shown as code. */
export function PlanText({ plan }: { plan: string }) {
  return <div className={styles.planText} data-testid="plan-text" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(plan) }} />;
}

const SCOPES = [
  { value: 'group only', key: 'groupOnly' },
  { value: 'group and core', key: 'groupAndCore' },
] as const satisfies ReadonlyArray<{ value: PlanScope; key: string }>;

/** What an improvement's plan step gives the Improve view's column. */
export type PlanStepState = {
  /** The step as the column shows it: AI writing the plan, the box, or the plan; null while there's no plan and nothing under way. */
  view: ReactNode;
  /**
   * The edition's part of the step: "Draft the plan in your Claude ↗" where the app has no AI (or
   * the warning to connect Claude), and following the plans Claude sends. The column keeps it at
   * one place while the plan shows, so a hand-off under way stays followed.
   */
  slot: ReactNode;
  /** The slot is for now: the plan is empty or to update, and nothing is under way. */
  slotOpen: boolean;
  /** AI is writing the plan, or a plan waits in the box: the column shows the step instead of the feedback. */
  busy: boolean;
  /** Feedback was used after the plan was written: update it, or keep it as it is, before changes are drafted. */
  stale: boolean;
  pending: boolean;
  /** Why starting or keeping the plan didn't work, for the column's foot. */
  error: string | null;
  /** AI writes the plan from all the feedback used (`update`: keeps the plan, adds what the newer feedback needs). */
  planWithAi: (update?: boolean) => void;
  /** The empty box, for the person's own plan. */
  write: () => void;
  /** The plan saved as it is: it covers the feedback used so far. */
  keepAsItIs: () => void;
};

/**
 * An improvement's plan, the step before any change: empty at first, then Plan with AI (AI reads
 * the lesson and all the feedback used and writes one short plan, as it goes) or the person's own
 * words. Feedback used after the plan was written asks for Update plan (AI keeps the plan and adds
 * what the newer feedback needs) or Keep the plan as it is; a plan AI wrote goes into the box to
 * edit, and only Save plan keeps it. A plan handed to the person's own Claude ("Draft the plan in
 * your Claude ↗", `aiSlot`) is followed the same way, and Claude's plan goes into the box too. For
 * a group's copy, where the change goes is chosen here too (it's the plan's "Scope:" line, which the
 * box doesn't show). The plan reads as formatted text and is edited in the lesson's visual editor
 * (or its Markdown). The column places the pieces: the step in its body, starting it in its foot.
 */
export function usePlanStep(
  improvement: ViewImprovement | null,
  {
    aiEnabled,
    aiSlot,
    onStarted,
  }: {
    /** AI runs in the app: a plan can be refined by asking (Ask for changes). */
    aiEnabled: boolean;
    /** The edition's part of the step (see `PlanStepState.slot`). */
    aiSlot?: ReactNode;
    /** The improvement moved (To do → In progress) when its plan was saved or drafted. */
    onStarted: (title: string) => void;
  }
): PlanStepState {
  const t = useTranslations('editor.improvements.planStep');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<AppDraftView | null>(improvement?.planDraft ?? null);
  // The box: null while the plan is only shown; the text being written or edited otherwise.
  const [text, setText] = useState<string | null>(null);
  const [scope, setScope] = useState<PlanScope | null>(improvement?.scope ?? null);
  // A draft that went into the box (AI's here, or one someone's Claude sent): saving the plan uses it, Cancel discards it.
  const [draftInBox, setDraftInBox] = useState<{ id: string; claude: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ask for changes: what to change in the plan as it is now.
  const [ask, setAsk] = useState('');
  const [askError, setAskError] = useState<string | null>(null);
  // Another improvement in the column: its own step, from the start.
  const id = improvement?.id ?? '';
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setDraft(improvement?.planDraft ?? null);
    setText(null);
    setScope(improvement?.scope ?? null);
    setDraftInBox(null);
    setError(null);
    setAsk('');
  }
  const box = useRef<TextEditorHandle>(null);
  // A plan refined by asking keeps where it goes, as chosen: only what was asked changes.
  const keepScope = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  /** A finished plan goes into the box, to edit and save. */
  const takeDraft = (ready: AppDraftView) => {
    setText(planBody(ready.text));
    const named = parsePlanScope(ready.text);
    if (named && improvement?.choosesScope && !keepScope.current) setScope(named);
    keepScope.current = false;
    setDraftInBox({ id: ready.id, claude: ready.source === 'claude' });
    setDraft(null);
  };

  // A plan that finished while nobody watched (or that someone's Claude sent) waits in the box, but
  // never over what the person is writing there: it goes in once they close it. One being written
  // that the page brings later (someone's Claude is at it) is followed.
  useEffect(() => {
    const brought = improvement?.planDraft;
    if (brought?.state === 'ready') {
      if (textRef.current === null) takeDraft(brought);
      else setDraft(brought);
    } else if (brought?.state === 'working') setDraft((current) => (current?.state === 'working' ? current : brought));
    // Only when the page brings it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [improvement?.planDraft?.id]);

  // The plan handed to the person's own Claude: followed here like a draft made here (an earlier
  // one is no longer waited for).
  useHandoffStarted(AiProposalKind.TASK_PLAN, id, (detail) => {
    if (draft?.state === 'working' && draft.id !== detail.pending.id) void stopTaskPlanDraftAction(draft.id);
    setError(null);
    setDraft(handoffDraft(detail));
  });

  // While AI writes: how far it is, about once a second.
  const draftId = draft?.state === 'working' ? draft.id : null;
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      const next = await taskPlanDraftAction(draftId);
      if (cancelled) return;
      if (next?.state === 'ready' && textRef.current === null) takeDraft(next);
      else setDraft(next);
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // takeDraft only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const planWithAi = (update = false) =>
    startTransition(async () => {
      if (!improvement) return;
      setError(null);
      const result = await startTaskPlanDraftAction(improvement.id, { update });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDraft(result.draft);
      if (result.moved) onStarted(result.moved.title);
    });

  const save = () =>
    startTransition(async () => {
      if (text === null || !improvement) return;
      const written = (box.current?.read() ?? text).trim();
      if (!written) {
        setError(t('emptyPlan'));
        return;
      }
      const result = await updateTaskPlanAction(improvement.id, withPlanScope(written, improvement.choosesScope ? scope : parsePlanScope(improvement.rawPlan)));
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (draftInBox) void settleTaskPlanDraftAction(draftInBox.id, true);
      // A drafted plan that went into the box (AI's or Claude's) counts as used now.
      announceSaved('plan', improvement.id);
      setDraftInBox(null);
      setText(null);
      if (result.moved) onStarted(result.moved.title);
      // A plan that arrived while the box was open is the next to decide on.
      if (draft?.state === 'ready') takeDraft(draft);
      router.refresh();
    });

  /**
   * Ask for changes: AI changes the plan as it is now (the box's text, or the saved plan) as asked,
   * keeping the rest; the answer goes into the box to review and save, as any drafted plan (a draft
   * that was in the box gives way to it).
   */
  const askForChanges = () =>
    startTransition(async () => {
      const request = ask.trim();
      const current = text !== null ? (box.current?.read() ?? text) : (improvement?.plan ?? '');
      if (!improvement || !request || !current.trim()) return;
      setAskError(null);
      const result = await startTaskPlanDraftAction(improvement.id, { revise: { plan: current, request } });
      if (!result.ok) {
        setAskError(result.message);
        return;
      }
      if (draftInBox) void settleTaskPlanDraftAction(draftInBox.id, false);
      keepScope.current = true;
      setDraftInBox(null);
      setText(null);
      setAsk('');
      setDraft(result.draft);
    });

  const keepAsItIs = () =>
    startTransition(async () => {
      if (!improvement) return;
      setError(null);
      const result = await updateTaskPlanAction(improvement.id, improvement.rawPlan);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });

  const cancel = () => {
    if (draftInBox) void settleTaskPlanDraftAction(draftInBox.id, false);
    setDraftInBox(null);
    setText(null);
    setError(null);
    setScope(improvement?.scope ?? null);
    // A plan that arrived while the box was open goes in now.
    if (draft?.state === 'ready') takeDraft(draft);
  };

  const stale = Boolean(improvement?.plan && improvement.newSincePlan.length > 0);
  const writing = Boolean(draft && draft.state !== 'ready');
  const busy = text !== null || writing;

  const scopeChoice = improvement?.choosesScope ? (
    <div className={styles.scope}>
      <span className={styles.label}>{t('whereLabel')}</span>
      <div role="radiogroup" aria-label={t('whereLabel')} className={styles.scopeOptions} data-testid="plan-scope">
        {SCOPES.map((option) => {
          const unavailable = option.value === 'group and core' && !improvement.courseReachable;
          const selected = scope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={unavailable && !selected}
              className={selected ? styles.scopeOn : styles.scopeOption}
              onClick={() => setScope(option.value)}
            >
              {t(`scopes.${option.key}`)}
            </button>
          );
        })}
      </div>
      {!improvement.courseReachable ? <span className={styles.quiet}>{t('noCourseLesson')}</span> : null}
    </div>
  ) : null;

  // One line under the plan (or the box): what to change, sent with the plan as it is.
  const askField =
    aiEnabled && improvement?.canWork ? (
      <form
        className={styles.askRow}
        onSubmit={(event) => {
          event.preventDefault();
          askForChanges();
        }}
      >
        <input
          className={styles.askInput}
          value={ask}
          maxLength={1000}
          onChange={(event) => {
            setAsk(event.target.value);
            setAskError(null);
          }}
          placeholder={t('askPlaceholder')}
          aria-label={t('ask')}
          data-testid="ask-plan"
        />
        <button type="submit" className={styles.askSend} disabled={pending || !ask.trim()} aria-label={t('askSend')} title={t('askSend')} data-testid="ask-plan-send">
          <TbArrowUp aria-hidden size={16} />
        </button>
      </form>
    ) : null;
  const askBlock = askField ? (
    <>
      {askField}
      {askError ? <p className={styles.error}>{askError}</p> : null}
    </>
  ) : null;

  let view: ReactNode = null;
  if (improvement && !improvement.canWork) {
    view = improvement.plan ? <PlanText plan={improvement.plan} /> : null;
  } else if (improvement && text !== null) {
    view = (
      <div className={styles.planEdit}>
        {draftInBox ? (
          <p className={styles.quiet}>{draftInBox.claude ? t('draftedByClaude') : t('drafted')}</p>
        ) : !text.trim() ? (
          <p className={styles.quiet}>{t('placeholder')}</p>
        ) : null}
        {/* A new key for each text put in the box (AI's plan, Claude's), so the editor starts from it. */}
        <div data-testid="plan-box">
          <TextEditor key={`${draftInBox?.id ?? 'own'}:${text.length}`} ref={box} initial={text} assets={NO_ASSETS} label={t('label')} />
        </div>
        {text.trim() ? askBlock : null}
        {scopeChoice}
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actionsEnd}>
          <button type="button" className={workspace.ghostButton} onClick={cancel}>
            {t('cancel')}
          </button>
          <button type="button" className={workspace.primaryButton} disabled={pending} onClick={save} data-testid="save-plan">
            {pending ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    );
  } else if (improvement && draft && writing) {
    view = (
      <PlanDraftStatus
        draft={draft}
        onStop={() => {
          void stopTaskPlanDraftAction(draft.id);
          setDraft(null);
        }}
        onUse={() => takeDraft(draft)}
        onDiscard={() => {
          void settleTaskPlanDraftAction(draft.id, false);
          setDraft(null);
        }}
      />
    );
  } else if (improvement?.plan) {
    view = (
      <div className={styles.planShown}>
        <PlanText plan={improvement.plan} />
        {/* Feedback used after it was written: update it (or keep it as it is) before changes are drafted. */}
        {stale ? (
          <p className={styles.staleNote} data-testid="plan-stale">
            {t('stale', { count: improvement.newSincePlan.length })}
          </p>
        ) : null}
        {askBlock}
        <button type="button" className={`${workspace.textButton} ${styles.planEditButton}`} onClick={() => setText(improvement.plan)} data-testid="edit-plan">
          {t('editPlan')}
        </button>
        {improvement.choosesScope ? (
          <p className={styles.quiet}>{scope ? t(`goes.${scope === 'group and core' ? 'groupAndCore' : 'groupOnly'}`) : t('goes.unset')}</p>
        ) : null}
      </div>
    );
  }

  const empty = !busy && (!improvement?.plan || stale);
  return {
    view,
    slot: aiSlot && improvement?.canWork ? aiSlot : null,
    slotOpen: empty,
    busy,
    stale,
    pending,
    error: text === null ? error : null,
    planWithAi,
    write: () => {
      setError(null);
      setText('');
    },
    keepAsItIs,
  };
}
