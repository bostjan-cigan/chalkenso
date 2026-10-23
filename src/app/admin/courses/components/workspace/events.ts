import type { AiProposalKind, AiProposalStatus } from '@prisma/client';
import type { AppDraftView } from '@/lib/ai-draft-progress';

/**
 * Drafts made elsewhere (e.g. by Claude through the connector) reach the editors through window
 * events, so editions can add their own AI paths without the shared editors knowing about them.
 *
 * - `REVIEW_REVISION_EVENT`, detail `ReviewRevisionDetail`: the lesson workspace opens its review
 *   with it. `base` is the text the draft was written from (null when unknown): with it, the
 *   draft's changes are applied on top of the person's edits since. The workspace answers with
 *   `REVISION_DECIDED_EVENT`, detail { proposalId, used }, when the person puts it in the editor
 *   (`used`) or discards it, and with `REVISION_UNDONE_EVENT`, detail { proposalId }, when they
 *   undo putting it in (it waits again).
 * - `AI_DRAFT_SAVED_EVENT`, detail { kind, targetId }: an editor saved (kind `lesson`, `plan`,
 *   `check` or `summary`). A draft put into it counts as used only then (a lesson's drafts are
 *   marked used by the save itself).
 * - `HANDOFF_STARTED_EVENT`, detail `HandoffStartedDetail`: someone handed the work to their own
 *   Claude ("… in your Claude ↗"). The part of the page that shows that target's drafts follows it
 *   like a draft made here (`handoffDraft`), and Claude's draft arrives there.
 */
export const REVIEW_REVISION_EVENT = 'chalkenso:review-revision';
export const REVISION_DECIDED_EVENT = 'chalkenso:revision-decided';
export const REVISION_UNDONE_EVENT = 'chalkenso:revision-undone';
export const AI_DRAFT_SAVED_EVENT = 'chalkenso:ai-draft-saved';
export const HANDOFF_STARTED_EVENT = 'chalkenso:handoff-started';

export type ReviewRevisionDetail = {
  proposalId: string;
  summary: string;
  markdown: string;
  base?: string | null;
  /** Who sent it and what for, shown above the review: "From Maja Kovač's Claude · … · for the task …". */
  from?: { by: string | null; at: string; task: string | null };
  /** The improvement it was made for: saving it in finishes that improvement. */
  taskId?: string | null;
};

export type SavedDraftKind = 'lesson' | 'plan' | 'check' | 'summary';

/** Tells drafts waiting on this editor that it was saved. */
export function announceSaved(kind: SavedDraftKind, targetId: string) {
  window.dispatchEvent(new CustomEvent(AI_DRAFT_SAVED_EVENT, { detail: { kind, targetId } }));
}

export type HandoffStartedDetail = {
  kind: AiProposalKind;
  targetId: string;
  /** The improvement it is for, when there is one. */
  taskId: string | null;
  pending: { id: string; status: AiProposalStatus; createdAt: string; claudeUrl: string | null };
  connected: boolean;
};

export function announceHandoff(detail: HandoffStartedDetail) {
  window.dispatchEvent(new CustomEvent(HANDOFF_STARTED_EVENT, { detail }));
}

/** A hand-off just started, as the page shows a draft until Claude's tool calls say more. */
export function handoffDraft(detail: HandoffStartedDetail): AppDraftView {
  return { id: detail.pending.id, state: 'working', stage: 'waiting', text: '', share: null, error: null, startedAt: detail.pending.createdAt, by: null, source: 'claude' };
}
