'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '../../components/ui/AdminButton';
import AdminNotice from '../../components/ui/AdminNotice';
import AiWorking from '../../components/ui/AiWorking';
import { QUIET_MS, type AppDraftView } from '@/lib/ai-draft-progress';
import { planBody } from '@/lib/plan-scope';

const boxStyle = {
  margin: 0,
  padding: '0.6rem 0.75rem',
  borderRadius: 9,
  border: '1px solid var(--line-strong)',
  background: 'rgba(var(--foreground-rgb), 0.03)',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap' as const,
  maxHeight: 240,
  overflowY: 'auto' as const,
};

/**
 * A plan draft AI writes in the background, here or in someone's own Claude (a hand-off): while it
 * works, what it is doing, for how long, and the plan as it is written (the person may leave; it
 * waits here); once it is done and not in the box yet, the draft with Use this plan and Discard; if
 * it failed, why.
 */
export default function PlanDraftStatus({
  draft,
  onStop,
  onUse,
  onDiscard,
}: {
  draft: AppDraftView;
  onStop: () => void;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('tasks.plan.aiDraft');
  const live = useRef<HTMLDivElement>(null);
  // The newest words stay in view as they arrive.
  useEffect(() => {
    if (live.current) live.current.scrollTop = live.current.scrollHeight;
  }, [draft.text]);

  if (draft.state === 'failed') {
    return <AdminNotice>{draft.error}</AdminNotice>;
  }

  const claude = draft.source === 'claude';
  if (draft.state === 'ready') {
    const ready = claude ? (draft.by ? t('readyClaudeBy', { name: draft.by }) : t('readyClaude')) : draft.by ? t('readyBy', { name: draft.by }) : t('ready');
    return (
      <div style={{ display: 'grid', gap: '0.5rem' }} data-testid="plan-draft-ready">
        <p style={{ margin: 0, fontWeight: 600 }}>{ready}</p>
        <div style={boxStyle}>{planBody(draft.text)}</div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <AdminButton type="button" size="compact" onClick={onUse}>
            {t('use')}
          </AdminButton>
          <AdminButton type="button" size="compact" tone="dangerText" onClick={onDiscard}>
            {t('discard')}
          </AdminButton>
        </div>
      </div>
    );
  }

  // Someone's own Claude says what it does at its tool calls: waiting for it, reading, writing.
  const label = claude
    ? draft.stage === 'waiting'
      ? t(draft.by ? 'claudeStages.waitingOther' : 'claudeStages.waiting')
      : t(draft.stage === 'reading' ? 'claudeStages.reading' : 'claudeStages.writing')
    : t(`stages.${draft.stage === 'waiting' ? 'reading' : draft.stage}`);
  const quiet = Date.now() - new Date(draft.startedAt).getTime() > QUIET_MS;
  const hint = !claude ? t('leave') : draft.stage === 'waiting' ? (quiet ? t('notStarted') : t('send')) : t('inClaude');
  return (
    <AiWorking
      label={label}
      startedAt={draft.startedAt}
      timeLabel={(time) => t('elapsed', { time })}
      meta={[draft.by ? t('startedBy', { name: draft.by }) : null]}
      detail={hint}
      actions={
        draft.id ? (
          <AdminButton type="button" size="compact" tone="secondary" onClick={onStop}>
            {t('stop')}
          </AdminButton>
        ) : null
      }
      testId="plan-draft-working"
      stageTestId="plan-draft-stage"
    >
      {draft.text ? (
        <div ref={live} style={boxStyle} aria-label={t('soFar')} data-testid="plan-draft-live">
          {draft.text}
        </div>
      ) : null}
    </AiWorking>
  );
}
