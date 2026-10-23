'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { AiProposalKind } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FiZap } from 'react-icons/fi';
import AdminButton from '../../components/ui/AdminButton';
import AdminNotice from '../../components/ui/AdminNotice';
import { POLL_MS, type AppDraftView } from '@/lib/ai-draft-progress';
import {
  moveTaskAction,
  settleTaskPlanDraftAction,
  startTaskPlanDraftAction,
  stopTaskPlanDraftAction,
  taskPlanDraftAction,
  updateTaskPlanAction,
} from '../actions';
import { announceSaved, handoffDraft } from '../../courses/components/workspace/events';
import { useHandoffStarted } from '../../courses/components/workspace/useHandoffStarted';
import PlanDraftStatus from './PlanDraftStatus';
import type { ImprovementMove } from '@/lib/task-flow';
import { parsePlanScope, planBody, withPlanScope, type PlanScope } from '@/lib/plan-scope';

const textareaStyle = {
  width: '100%',
  minHeight: 140,
  padding: '0.6rem 0.75rem',
  borderRadius: 9,
  border: '1px solid rgba(var(--foreground-rgb), 0.15)',
  background: 'rgba(var(--foreground-rgb), 0.03)',
  color: 'inherit',
  font: 'inherit',
  lineHeight: 1.55,
  resize: 'vertical' as const,
};

/**
 * Where the change goes. The plan's last line says it ("Scope: group only"), in English whatever the
 * page's language, for the vault, the AI and MCP (`plan-scope.ts`); here the box hides that line and
 * this choice sets it.
 */
const SCOPES = [
  { value: 'group only', key: 'groupOnly' },
  { value: 'group and core', key: 'groupAndCore' },
] as const satisfies ReadonlyArray<{ value: PlanScope; key: string }>;

/**
 * The revision plan: written here or in the Obsidian feedback note (same field). With AI on,
 * "Draft with AI" drafts it from the lesson's open feedback and instructor notes, in the background:
 * the page shows what AI is doing and the plan as it is written, and the person may leave (the
 * draft waits here, `initialDraft`). Done while they watch, it goes into the box; otherwise it waits
 * with Use this plan, as does a plan someone's Claude sent. Where the app has no AI, the plan handed
 * to someone's own Claude ("… in your Claude ↗", `aiExtra`) is followed here the same way. Nothing
 * is saved until the person saves; saving keeps the draft that went in.
 * A saved plan opens in the lesson's Revise, attached. A group's improvement also says where the
 * change goes: this group's copy only, or the main course's lesson too.
 */
export default function TaskPlanEditor({
  taskId,
  initialPlan,
  canEdit,
  aiEnabled,
  initialDraft = null,
  isGroupTask = false,
  courseReachable = false,
  aiExtra,
}: {
  taskId: string;
  initialPlan: string;
  canEdit: boolean;
  aiEnabled: boolean;
  /** A draft AI is writing, or wrote while nobody watched. */
  initialDraft?: AppDraftView | null;
  /** Group tasks choose whether the change also goes into the main course. */
  isGroupTask?: boolean;
  /** The group's lessons have a main-course lesson to change (not one added in the copy only). */
  courseReachable?: boolean;
  /** The edition's other AI paths (e.g. "Send to Claude"), under the editor. */
  aiExtra?: ReactNode;
}) {
  const t = useTranslations('tasks.plan');
  // The box holds the plan without its "Scope:" line; the choice below holds the scope.
  const [plan, setPlan] = useState(() => planBody(initialPlan));
  const [scope, setScope] = useState<PlanScope | null>(() => parsePlanScope(initialPlan));
  /** A plan written elsewhere (a draft, another page) goes into the box, with the scope it names. */
  const putPlan = (next: string) => {
    setPlan(planBody(next));
    const named = parsePlanScope(next);
    if (named) setScope(named);
  };
  const fullPlan = withPlanScope(plan, scope);
  const router = useRouter();
  // A line under the buttons; a move the improvement made by itself comes with Undo.
  const [message, setMessage] = useState<{ error: boolean; text: string; moved?: ImprovementMove } | null>(null);
  const started = (moved: ImprovementMove | null | undefined, text?: string) =>
    moved ? setMessage({ error: false, text: [text, t('started', { title: moved.title })].filter(Boolean).join(' '), moved }) : null;
  const [saving, startSaving] = useTransition();
  const [starting, startStarting] = useTransition();
  const dirty = fullPlan !== withPlanScope(initialPlan, parsePlanScope(initialPlan));
  const [draft, setDraft] = useState<AppDraftView | null>(initialDraft);
  // The draft now in the box: saving the plan keeps it.
  const [draftInBox, setDraftInBox] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const working = draft?.state === 'working';
  // Clicked, the request still on its way (the feedback is being read): shown as the first stage.
  const [clickedAt, setClickedAt] = useState<string | null>(null);
  const shown: AppDraftView | null =
    draft ?? (starting && clickedAt ? { id: '', state: 'working', stage: 'reading', text: '', share: null, error: null, startedAt: clickedAt, by: null, source: 'app' } : null);

  // The plan handed to someone's own Claude: followed here, like a draft made here (an earlier one is
  // no longer waited for).
  useHandoffStarted(AiProposalKind.TASK_PLAN, taskId, (detail) => {
    if (draft?.state === 'working' && draft.id && draft.id !== detail.pending.id) void stopTaskPlanDraftAction(draft.id);
    setMessage(null);
    setDraft(handoffDraft(detail));
  });

  /** The draft goes into the box, unsaved, like a typed edit. */
  const takeDraft = (next: AppDraftView) => {
    putPlan(next.text);
    setDraftInBox(next.id);
    setDraft(null);
    setMessage({ error: false, text: t('draftReady') });
  };

  // While AI writes: ask how far it is about once a second (while the page is in view, and on return).
  const draftId = working ? draft.id : null;
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      const next = await taskPlanDraftAction(draftId);
      if (cancelled) return;
      // Finished while the person watched, with nothing of theirs in the box: it goes straight in.
      if (next?.state === 'ready' && !dirtyRef.current) takeDraft(next);
      else setDraft(next);
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
    // takeDraft only sets state; following another draft restarts the polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <textarea
        aria-label={t('label')}
        data-testid="task-plan"
        value={plan}
        onChange={(event) => setPlan(event.target.value)}
        readOnly={!canEdit}
        placeholder={t('placeholder')}
        style={textareaStyle}
      />
      {canEdit && shown ? (
        <PlanDraftStatus
          draft={shown}
          onStop={() => {
            if (shown.id) void stopTaskPlanDraftAction(shown.id);
            setDraft(null);
          }}
          onUse={() => takeDraft(shown)}
          onDiscard={() => {
            void settleTaskPlanDraftAction(shown.id, false);
            setDraft(null);
          }}
        />
      ) : null}
      {isGroupTask && canEdit ? (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <div role="radiogroup" aria-label={t('scopeLabel')} data-testid="plan-scope" style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {SCOPES.map((option) => {
              const selected = scope === option.value;
              const unavailable = option.value === 'group and core' && !courseReachable;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={unavailable && !selected}
                  onClick={() => setScope(option.value)}
                  style={{
                    textAlign: 'left',
                    minHeight: 44,
                    padding: '0.7rem 0.85rem',
                    borderRadius: 10,
                    border: selected ? '2px solid rgb(var(--accent-color))' : '1px solid var(--line-strong)',
                    background: selected ? 'rgba(var(--accent-color), 0.08)' : 'var(--card-bg)',
                    color: 'inherit',
                    font: 'inherit',
                    cursor: unavailable && !selected ? 'not-allowed' : 'pointer',
                    opacity: unavailable && !selected ? 0.55 : 1,
                  }}
                >
                  <strong style={{ display: 'block', fontSize: '0.92rem' }}>{t(`scopes.${option.key}.title`)}</strong>
                  <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>{t(`scopes.${option.key}.text`)}</span>
                </button>
              );
            })}
          </div>
          {!courseReachable ? <p style={{ margin: 0, fontSize: '0.82rem', opacity: 0.7 }}>{t('scopes.noCourseLesson')}</p> : null}
        </div>
      ) : null}
      {canEdit ? (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <AdminButton
            type="button"
            size="compact"
            disabled={saving || !dirty}
            onClick={() =>
              startSaving(async () => {
                const result = await updateTaskPlanAction(taskId, fullPlan);
                setMessage({ error: !result.ok, text: result.message });
                started(result.moved, result.message);
                if (result.ok) {
                  announceSaved('plan', taskId);
                  if (draftInBox) void settleTaskPlanDraftAction(draftInBox, true);
                  setDraftInBox(null);
                }
              })
            }
          >
            {saving ? t('saving') : t('save')}
          </AdminButton>
          {aiEnabled ? (
            <AdminButton
              type="button"
              tone="secondary"
              size="compact"
              disabled={starting || working}
              onClick={() =>
                startStarting(async () => {
                  setMessage(null);
                  setClickedAt(new Date().toISOString());
                  const result = await startTaskPlanDraftAction(taskId);
                  if (result.ok) {
                    setDraft(result.draft);
                    started(result.moved);
                  } else {
                    setMessage({ error: true, text: result.message });
                  }
                })
              }
            >
              <FiZap aria-hidden /> {starting || working ? t('drafting') : t('draft')}
            </AdminButton>
          ) : null}
        </div>
      ) : null}
      {message ? (
        message.error ? (
          <AdminNotice>{message.text}</AdminNotice>
        ) : (
          <p style={{ margin: 0, opacity: 0.75 }} role="status">
            {message.text}
            {message.moved ? (
              <>
                {' '}
                <button
                  type="button"
                  style={{ border: 0, padding: 0, background: 'none', color: 'rgb(var(--accent-color))', font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
                  onClick={() => {
                    const moved = message.moved;
                    if (!moved) return;
                    setMessage(null);
                    void moveTaskAction(moved.taskId, moved.from).then(() => router.refresh());
                  }}
                >
                  {t('undo')}
                </button>
              </>
            ) : null}
          </p>
        )
      ) : null}
      {/* Hidden while AI works on the plan: the block above shows it, wherever it runs. */}
      {canEdit && aiExtra ? <div hidden={Boolean(shown && shown.state === 'working')}>{aiExtra}</div> : null}
    </div>
  );
}
