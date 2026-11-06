import 'server-only';

import { AiProposalKind, AiProposalStatus } from '@prisma/client';
import { proposeChanges } from '@/app/admin/courses/components/workspace/revision';
import { prisma } from './prisma';

/**
 * An improvement's thread on one lesson, attempt by attempt: each AI draft of its changes there
 * since its last change was saved (the one waiting, and the earlier ones it went on from), with
 * what the person asked for each in their words, and what it did. Earlier ones can be taken back
 * up ("Use this one"). Oldest first.
 */
export type ThreadAttempt = {
  id: string;
  /** What was asked for it ("shorter"); null for the first, written from the plan. */
  request: string | null;
  summary: string;
  changes: number;
  /** The one waiting for review now. */
  current: boolean;
  /** From someone's own Claude (the connector), not the app's AI. */
  claude: boolean;
};

const MAX_ATTEMPTS = 20;

/**
 * The threads of these improvements on this lesson, in two queries; markdown is read here, never
 * sent. `finished`: the round that ended with its last save here (for the lesson's history).
 */
export async function improvementAttempts(lessonId: string, taskIds: string[], { finished = false }: { finished?: boolean } = {}): Promise<Map<string, ThreadAttempt[]>> {
  const result = new Map<string, ThreadAttempt[]>();
  if (!taskIds.length) return result;
  const [rows, saved] = await Promise.all([
    prisma.aiProposal.findMany({
      where: {
        kind: AiProposalKind.LESSON_REVISION,
        targetId: lessonId,
        taskId: { in: taskIds },
        status: { in: finished ? [AiProposalStatus.USED, AiProposalStatus.DISCARDED] : [AiProposalStatus.OPEN, AiProposalStatus.DISCARDED] },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_ATTEMPTS * taskIds.length,
      select: { id: true, taskId: true, status: true, payload: true, summary: true, request: true, via: true, createdAt: true },
    }),
    prisma.lessonChange.findMany({
      where: { lessonId, taskId: { in: taskIds } },
      orderBy: { createdAt: 'desc' },
      select: { taskId: true, createdAt: true },
    }),
  ]);
  for (const taskId of taskIds) {
    // One round: what was drafted since the improvement's last change here was saved (or, finished,
    // up to that save since the one before it).
    const changes = saved.filter((change) => change.taskId === taskId).map((change) => change.createdAt);
    const since = (finished ? changes[1] : changes[0]) ?? null;
    const until = finished ? (changes[0] ?? null) : null;
    if (finished && !until) continue;
    const own = rows
      .filter((row) => row.taskId === taskId && (!since || row.createdAt > since) && (!until || row.createdAt <= until))
      .slice(0, MAX_ATTEMPTS)
      .reverse()
      .flatMap((row): ThreadAttempt[] => {
        const payload = (row.payload ?? {}) as { markdown?: unknown; base?: unknown };
        if (typeof payload.markdown !== 'string') return [];
        return [
          {
            id: row.id,
            request: row.request,
            summary: row.summary ?? '',
            changes: proposeChanges(String(payload.base ?? ''), payload.markdown).length,
            current: row.status === (finished ? AiProposalStatus.USED : AiProposalStatus.OPEN),
            claude: row.via === 'connector',
          },
        ];
      });
    // Only the newest waiting (or, finished, used) one is current; an older one counts as earlier.
    const newest = own.map((attempt) => attempt.current).lastIndexOf(true);
    own.forEach((attempt, index) => (attempt.current = index === newest));
    if (own.length) result.set(taskId, own);
  }
  return result;
}

/**
 * The lesson's published edits that no improvement made (Edit mode, an Obsidian upload): each
 * publication whose revision no recorded change reached, with what it changed against the one
 * before. The newest first, at most `limit`.
 */
export async function lessonEdits(lessonId: string, limit = 10) {
  const [publications, changes] = await Promise.all([
    prisma.lessonPublication.findMany({
      where: { lessonId },
      orderBy: { revision: 'desc' },
      take: 40,
      select: { id: true, revision: true, markdownContent: true, publishedAt: true, publisherName: true },
    }),
    prisma.lessonChange.findMany({ where: { lessonId }, select: { revision: true } }),
  ]);
  const edits: Array<{ id: string; at: Date; by: string | null; changes: ReturnType<typeof proposeChanges> }> = [];
  for (let index = 0; index < publications.length - 1 && edits.length < limit; index += 1) {
    const next = publications[index];
    const previous = publications[index + 1];
    // An improvement's save between the two: that publication is its change, not an edit.
    if (changes.some((change) => change.revision > previous.revision && change.revision <= next.revision)) continue;
    const changed = proposeChanges(previous.markdownContent, next.markdownContent).slice(0, 100);
    if (changed.length) edits.push({ id: next.id, at: next.publishedAt, by: next.publisherName, changes: changed });
  }
  return edits;
}
