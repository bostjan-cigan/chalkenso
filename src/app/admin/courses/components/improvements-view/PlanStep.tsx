'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { AiProposalKind } from '@prisma/client';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { AppDraftView } from '@/lib/ai-draft-progress';
import { parsePlanScope, planBody, withPlanScope, type PlanScope } from '@/lib/plan-scope';
import {
  settleTaskPlanDraftAction,
  startTaskPlanDraftAction,
  stopTaskPlanDraftAction,
  updateTaskPlanAction,
} from '../../../tasks/actions';
import PlanDraftStatus from '../../../tasks/components/PlanDraftStatus';
import { announceSaved, handoffDraft } from '../workspace/events';
import { useDraftProgress } from '../workspace/useDraftProgress';
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
 * a group's copy, the plan keeps where the change goes as AI named it (its "Scope:" line, which the
 * box doesn't show); it's chosen at Publish. The plan reads as formatted text and is edited in the lesson's visual editor
 * (or its Markdown). The column places the pieces: the step in its body, starting it in its foot.
 */
export function usePlanStep(
  improvement: ViewImprovement | null,
  {
    aiEnabled,
    aiSlot,
    onStarted,
    onSaved,
  }: {
    /** AI runs in the app (a plan can be drafted). */
    aiEnabled: boolean;
    /** The edition's part of the step (see `PlanStepState.slot`). */
    aiSlot?: ReactNode;
    /** The improvement moved (To do → In progress) when its plan was saved or drafted. */
    onStarted: (title: string) => void;
    /** The plan was saved by the person (edited by hand): the changes may be written again from it. */
    onSaved?: () => void;
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
  }
  const box = useRef<TextEditorHandle>(null);
  const textRef = useRef(text);
  textRef.current = text;

  /** A finished plan goes into the box, to edit and save. */
  const takeDraft = (ready: AppDraftView) => {
    setText(planBody(ready.text));
    const named = parsePlanScope(ready.text);
    if (named && improvement?.choosesScope) setScope(named);
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

  // Where it goes changed elsewhere (at Publish): the box starts from that.
  useEffect(() => {
    setScope(improvement?.scope ?? null);
  }, [improvement?.scope]);

  // While AI writes: how far it is, about once a second.
  useDraftProgress<AppDraftView>(draft?.state === 'working' && draft.id ? [draft.id] : [], (_id, next) => {
    if (next?.state === 'ready' && textRef.current === null) takeDraft(next);
    else setDraft(next);
  });

  const planWithAi = (update = false) => {
    if (!improvement) return;
    setError(null);
    // Shown at once: the server's answer only fills in which draft it is.
    setDraft({ id: '', state: 'working', stage: 'reading', text: '', live: null, error: null, startedAt: new Date().toISOString(), by: null, source: 'app' });
    startTransition(async () => {
      const result = await startTaskPlanDraftAction(improvement.id, { update });
      if (!result.ok) {
        setDraft(null);
        setError(result.message);
        return;
      }
      setDraft(result.draft);
      if (result.moved) onStarted(result.moved.title);
    });
  };

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
      onSaved?.();
      // A plan that arrived while the box was open is the next to decide on.
      if (draft?.state === 'ready') takeDraft(draft);
      router.refresh();
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


  let view: ReactNode = null;
  if (improvement && !improvement.canWork) {
    view = improvement.plan ? <PlanText plan={improvement.plan} /> : null;
  } else if (improvement && text !== null) {
    view = (
      <div className={styles.planEdit}>
        {draftInBox ? <p className={styles.quiet}>{draftInBox.claude ? t('draftedByClaude') : t('drafted')}</p> : null}
        {/* A new key for each text put in the box (AI's plan, Claude's), so the editor starts from it. */}
        <div data-testid="plan-box">
          <TextEditor key={`${draftInBox?.id ?? 'own'}:${text.length}`} ref={box} initial={text} assets={NO_ASSETS} label={t('label')} placeholder={t('placeholder')} />
        </div>
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
        onRetry={() => planWithAi(stale)}
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
        <button type="button" className={`${workspace.textButton} ${styles.planEditButton}`} onClick={() => setText(improvement.plan)} data-testid="edit-plan">
          {t('editPlan')}
        </button>
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
