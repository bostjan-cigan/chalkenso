import 'server-only';

import { AiProposalKind, AiProposalStatus } from '@prisma/client';
import { accessScope, canWorkOnFeedback, commentScopeWhere, loadTaskRef, type CrmViewer } from '@/lib/crm-access';
import type { NewLessonChange } from '@/lib/lesson-changes';
import { prisma } from '@/lib/prisma';
import { isImprovementTarget } from '@/lib/improvement-targets';
import { coveredFeedback } from '@/lib/feedback-rounds';
import { improvementFeedbackLinks } from '@/lib/task-flow';
import { proposeChanges } from './components/workspace/revision';

/** One improvement's part of a save, as recorded, with the text it changed (to carry to the main course). */
export type LessonChangeInput = Omit<NewLessonChange, 'lessonId' | 'revision'> & {
  /** The lesson's text just before and after this improvement's changes went in (the Improvements view). */
  carry: { before: string; after: string } | null;
  /** The improvement's feedback used after its changes were drafted: not answered by this save, it starts the next improvement. */
  later: string[];
};

/** Long enough for any lesson; anything longer isn't carried anywhere. */
const MAX_TEXT = 400_000;

/**
 * What a save says it carries (the `lessonChange` form field: one entry, from the lesson editor, or
 * a list, one per improvement, from the lesson's Improvements view): drafts applied, notes used, the
 * improvement worked on. Checked here with the person's rights: drafts for this lesson still waiting,
 * notes on this lesson they may see, an improvement that changes this lesson (its own, or the main
 * course's part of a group's improvement) they may work on. Each draft and improvement counts once.
 * Empty when there is nothing to record.
 */
export async function lessonChangesFromForm(formData: FormData, lessonId: string, viewer: CrmViewer, userId: string): Promise<LessonChangeInput[]> {
  const raw = String(formData.get('lessonChange') ?? '');
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, 20);
  const changes: LessonChangeInput[] = [];
  const seenProposals = new Set<string>();
  const seenTasks = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const change = await lessonChangeEntry(entry as EntryValue, lessonId, viewer, userId, seenProposals, seenTasks);
    if (change) changes.push(change);
  }
  return changes;
}

type EntryValue = { proposalIds?: unknown; noteIds?: unknown; taskId?: unknown; applied?: unknown; skipped?: unknown; before?: unknown; after?: unknown };

async function lessonChangeEntry(
  value: EntryValue,
  lessonId: string,
  viewer: CrmViewer,
  userId: string,
  seenProposals: Set<string>,
  seenTasks: Set<string>
): Promise<LessonChangeInput | null> {
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string').slice(0, 50) : []);
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(999, Math.round(n))) : 0);

  const proposals = (
    await prisma.aiProposal.findMany({
      where: { id: { in: ids(value.proposalIds) }, kind: AiProposalKind.LESSON_REVISION, targetId: lessonId, status: AiProposalStatus.OPEN },
      select: { id: true, taskId: true, payload: true, createdAt: true },
    })
  ).filter((proposal) => !seenProposals.has(proposal.id));
  proposals.forEach((proposal) => seenProposals.add(proposal.id));

  // The improvement: the one worked on, or the one a draft was made for.
  let taskId: string | null = null;
  const candidates = [typeof value.taskId === 'string' ? value.taskId : null, ...proposals.map((proposal) => proposal.taskId)].filter(
    (id): id is string => Boolean(id) && !seenTasks.has(id as string)
  );
  for (const candidate of candidates) {
    const ref = await loadTaskRef(candidate);
    if (!ref || !canWorkOnFeedback(viewer, ref, 'tasks')) continue;
    if (await isImprovementTarget(prisma, candidate, lessonId)) {
      taskId = candidate;
      seenTasks.add(candidate);
      break;
    }
  }

  // The feedback it answers: notes the revisions used, and the improvement's own feedback.
  const draftNotes = (proposal: (typeof proposals)[number]) => (proposal.payload as { why?: { noteIds?: unknown } } | null)?.why?.noteIds;
  const noteIds = [...ids(value.noteIds), ...proposals.flatMap((proposal) => ids(draftNotes(proposal)))];
  const notes = noteIds.length
    ? await prisma.curriculumComment.findMany({
        where: { AND: [commentScopeWhere(accessScope(viewer, 'comments')), { id: { in: noteIds }, lessonId }] },
        select: { id: true },
      })
    : [];
  // The improvement's feedback its drafts were written for; the rest came after them and waits for
  // the next improvement.
  const links = taskId ? await improvementFeedbackLinks(prisma, taskId, lessonId) : [];
  const { covered: fromImprovement, later } = coveredFeedback(
    links,
    proposals.map((proposal) => ({ noteIds: draftNotes(proposal), createdAt: proposal.createdAt }))
  );
  const commentIds = Array.from(new Set([...notes.map((note) => note.id), ...fromImprovement])).filter((id) => !later.includes(id));

  if (!proposals.length && !taskId && !commentIds.length) return null;
  const text = (value_: unknown) => (typeof value_ === 'string' && value_.length <= MAX_TEXT ? value_ : null);
  const before = text(value.before);
  const after = text(value.after);
  // What it changed, kept with it ("What changed" on the improvement later).
  const changed = before !== null && after !== null ? proposeChanges(before, after).slice(0, 100) : null;
  return {
    taskId,
    proposalIds: proposals.map((proposal) => proposal.id),
    commentIds,
    applied: count(value.applied),
    skipped: count(value.skipped),
    createdById: userId,
    ...(changed?.length ? { changes: changed } : {}),
    carry: taskId && before !== null && after !== null ? { before, after } : null,
    later,
  };
}
