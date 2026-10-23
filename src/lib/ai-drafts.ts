import 'server-only';

import { after } from 'next/server';
import { AiProposalKind, AiProposalStatus, type Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { AiError, type AiErrorKey, type AiProgress } from './ai';
import { CONNECTOR_READ, GIVE_UP_MS, handoffStage, PROGRESS_MS, stillWorking, WAIT_FOR_MS, type AppDraftView, type DraftStage } from './ai-draft-progress';
import type { DraftDiagram } from './draft-diagrams';
import { withOrgScope } from './org-context';
import { prisma } from './prisma';
import { proposeChanges } from '@/app/admin/courses/components/workspace/revision';

/**
 * Drafts made in the app, in the background: starting one saves a proposal row (`via: 'app'`,
 * WORKING) and returns at once; AI runs after the response (`after`, within the page's
 * `maxDuration`) and writes how far it is into the row, then the draft (OPEN) or why not
 * (FAILED). The page polls the row, so the person can leave and find the draft waiting. Stopping
 * it (DISCARDED) stops the call too, at the next progress write. Nothing is applied by itself.
 *
 * A hand-off to someone's own Claude (through an edition's connector, `via: 'connector'`) is waited on
 * the same way: the page shows it with the drafts made here, its stage moved on by Claude's tool calls
 * (PENDING until Claude reads the brief, then WORKING), and its draft arrives in the same row (OPEN).
 */

type DraftPayload = {
  stage?: DraftStage;
  text?: string;
  share?: number;
  error?: string;
  /** A finished plan draft. */
  plan?: string;
  /** A finished lesson revision: the revised lesson, and the text it was written from. */
  markdown?: string;
  base?: string;
  /** New diagrams the revised lesson embeds, cleaned (`cleanDraftDiagrams`); stored on Save. */
  diagrams?: DraftDiagram[];
  /** What it was asked to do: the request, the notes and the task's plan it was made from. */
  why?: { instruction?: string; noteIds?: string[]; taskId?: string | null; planTitle?: string | null };
};

export type DraftRun = (
  progress: (progress: AiProgress) => void,
  signal: AbortSignal
) => Promise<{ payload: Prisma.InputJsonValue; summary?: string | null }>;

/** Starts a draft for one target; an earlier one this person started there and is still running stops (or no longer waits on their Claude). */
export async function startAppDraft(input: {
  organizationId: string;
  userId: string;
  kind: AiProposalKind;
  targetType: 'lesson' | 'task' | 'report' | 'course';
  targetId: string;
  taskId?: string | null;
  /** A lesson revision: the lesson's revision the draft is written against. */
  baseRevision?: number | null;
  /** The AI call, with the request's key and context already in hand (nothing in it reads the request). */
  run: DraftRun;
}) {
  await prisma.aiProposal.updateMany({
    where: { kind: input.kind, targetId: input.targetId, createdById: input.userId, status: { in: [AiProposalStatus.WORKING, AiProposalStatus.PENDING] } },
    data: { status: AiProposalStatus.DISCARDED, decidedAt: new Date() },
  });
  const draft = await prisma.aiProposal.create({
    data: {
      organizationId: input.organizationId,
      kind: input.kind,
      status: AiProposalStatus.WORKING,
      targetType: input.targetType,
      targetId: input.targetId,
      taskId: input.taskId ?? null,
      baseRevision: input.baseRevision ?? null,
      payload: { stage: 'reading' },
      via: 'app',
      createdById: input.userId,
    },
    select: DRAFT_SELECT,
  });
  after(() => withOrgScope(input.organizationId, () => runDraft(draft.id, input.run)));
  return draft;
}

async function runDraft(id: string, run: DraftRun) {
  const controller = new AbortController();
  let lastWrite = 0;
  let lastStage: DraftStage = 'reading';
  let writes = Promise.resolve();
  const write = (payload: DraftPayload) => {
    writes = writes
      .then(async () => {
        // Only while it is still wanted: stopped or replaced, the call stops too.
        const { count } = await prisma.aiProposal.updateMany({ where: { id, status: AiProposalStatus.WORKING }, data: { payload } });
        if (!count) controller.abort();
      })
      .catch((error) => console.error('Could not save AI draft progress', error));
  };
  const progress = (next: AiProgress) => {
    const now = Date.now();
    // A new stage is written at once; text as it grows, and signs of life while thinking, less often.
    const every = next.stage === lastStage ? (next.stage === 'writing' ? PROGRESS_MS : 5_000) : 0;
    if (now - lastWrite < every) return;
    lastWrite = now;
    lastStage = next.stage;
    write(next.stage === 'writing' ? { stage: 'writing', text: next.text, ...(next.share !== undefined ? { share: next.share } : {}) } : { stage: 'thinking' });
  };

  try {
    progress({ stage: 'thinking' });
    const { payload, summary } = await run(progress, controller.signal);
    await writes;
    await prisma.aiProposal.updateMany({
      where: { id, status: AiProposalStatus.WORKING },
      data: { status: AiProposalStatus.OPEN, payload, ...(summary !== undefined ? { summary } : {}) },
    });
  } catch (error) {
    await writes;
    if (controller.signal.aborted) return;
    if (!(error instanceof AiError)) console.error('AI draft failed', error);
    await prisma.aiProposal.updateMany({
      where: { id, status: AiProposalStatus.WORKING },
      data: { status: AiProposalStatus.FAILED, payload: { error: error instanceof AiError ? error.key : 'generic' }, decidedAt: new Date() },
    });
  }
}

const DRAFT_SELECT = {
  id: true,
  status: true,
  payload: true,
  summary: true,
  taskId: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  createdBy: { select: { firstName: true, lastName: true, identifier: true } },
  via: true,
} as const satisfies Prisma.AiProposalSelect;

type DraftRow = Prisma.AiProposalGetPayload<{ select: typeof DRAFT_SELECT }>;

/** A draft row as the page shows it (null once it was used or discarded); `text` is the payload field the finished draft is in. */
export async function draftView(row: DraftRow, viewerId: string, field: 'plan' | 'markdown'): Promise<AppDraftView | null> {
  const payload = (row.payload ?? {}) as DraftPayload;
  const by =
    row.createdById && row.createdById !== viewerId && row.createdBy
      ? [row.createdBy.firstName, row.createdBy.lastName].filter(Boolean).join(' ') || row.createdBy.identifier
      : null;
  const source = row.via === 'app' ? 'app' : 'claude';
  const stage = source === 'claude' ? handoffStage(row.status, payload.stage) : payload.stage ?? 'reading';
  const base = { id: row.id, stage, share: payload.share ?? null, startedAt: row.createdAt.toISOString(), by, source } as const;
  if (row.status === AiProposalStatus.OPEN) {
    return { ...base, state: 'ready', text: String(payload[field] ?? ''), error: null };
  }
  const waiting = row.status === AiProposalStatus.WORKING || row.status === AiProposalStatus.PENDING;
  if (waiting && stillWorking(row)) {
    return { ...base, state: 'working', text: payload.text ?? '', error: null };
  }
  // Claude only read it (no hand-off) and sent nothing: nothing to say.
  if (row.via === CONNECTOR_READ) return null;
  if (waiting || row.status === AiProposalStatus.FAILED) {
    const t = await getTranslations('editor.ai.errors');
    const key = waiting ? (source === 'claude' ? 'claudeStopped' : 'stopped') : payload.error;
    return { ...base, state: 'failed', text: '', error: t(isErrorKey(key) ? key : 'generic') };
  }
  return null;
}

type ErrorKey = AiErrorKey | 'stopped' | 'claudeStopped';
const ERROR_KEYS: ReadonlyArray<ErrorKey> = ['noKey', 'cap', 'keyInvalid', 'paused', 'plan', 'declined', 'tooLong', 'noRequest', 'unreadable', 'stopped', 'claudeStopped'];
const isErrorKey = (key: unknown): key is ErrorKey => ERROR_KEYS.includes(key as ErrorKey);

/** One draft of this kind the page follows (made here, or a hand-off to someone's Claude); null when there is none (or it is another kind). */
export async function loadDraft(id: string, kind: AiProposalKind) {
  return prisma.aiProposal.findFirst({ where: { id, kind }, select: { ...DRAFT_SELECT, targetId: true } });
}

/**
 * Rows still being written: here, or by someone's Claude for a hand-off, within the last hour; one
 * Claude started by reading, while it is still heard from.
 */
const recentlyWorking = (): Prisma.AiProposalWhereInput[] => [
  { via: 'app', status: AiProposalStatus.WORKING, updatedAt: { gte: new Date(Date.now() - WAIT_FOR_MS) } },
  { via: 'connector', status: { in: [AiProposalStatus.PENDING, AiProposalStatus.WORKING] }, createdAt: { gte: new Date(Date.now() - WAIT_FOR_MS) } },
  { via: CONNECTOR_READ, status: AiProposalStatus.WORKING, updatedAt: { gte: new Date(Date.now() - GIVE_UP_MS) } },
];

/**
 * The draft a target's page picks up: the newest still being written (here, or by someone's Claude),
 * or finished and waiting for review (made here, or sent by someone's Claude: a plan goes into the
 * plan box either way). One that stopped long ago isn't brought back.
 */
export async function currentDraft(kind: AiProposalKind, targetId: string) {
  return prisma.aiProposal.findFirst({
    where: { kind, targetId, OR: [{ status: AiProposalStatus.OPEN }, ...recentlyWorking()] },
    orderBy: { createdAt: 'desc' },
    select: DRAFT_SELECT,
  });
}

/** Undo a Discard, for a few minutes: the draft waits again. */
export async function reopenDraft(id: string) {
  const { count } = await prisma.aiProposal.updateMany({
    where: { id, via: 'app', status: AiProposalStatus.DISCARDED, decidedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    data: { status: AiProposalStatus.OPEN, decidedAt: null },
  });
  return count > 0;
}

/**
 * Stop a running draft (a hand-off: no longer waited for, and what Claude sends later arrives as a
 * new draft), or decide a finished one: used (it went into the editor and was saved) or discarded.
 */
export async function settleDraft(id: string, outcome: 'stopped' | 'used' | 'discarded') {
  const { count } = await prisma.aiProposal.updateMany({
    where: {
      id,
      status:
        outcome === 'stopped' ? { in: [AiProposalStatus.WORKING, AiProposalStatus.PENDING] } : { in: [AiProposalStatus.OPEN, AiProposalStatus.FAILED] },
    },
    data: { status: outcome === 'used' ? AiProposalStatus.USED : AiProposalStatus.DISCARDED, decidedAt: new Date() },
  });
  return count > 0;
}

/** A lesson revision drafted here, as the lesson's page reviews it. */
export type LessonDraftView = AppDraftView & {
  /** The revised lesson, and the text it was written from (empty while it is written). */
  markdown: string;
  base: string;
  /** The paths of the new diagrams it embeds (each shown from `/admin/api/drafts/<id>/<path>`). */
  diagrams: string[];
  summary: string;
  /** When it was finished (or last heard of). */
  at: string;
  taskId: string | null;
  /** The feedback it was written for, when it says (drafts made here do; null: not said). */
  noteIds: string[] | null;
};

/**
 * Changes carried from a group's copy that put nothing into the main course's lesson: an earlier
 * carry could leave one behind (only blank lines differed). Nothing to review, so not a draft.
 */
export function isEmptyCarriedDraft(payload: Prisma.JsonValue | null) {
  const value = (payload ?? {}) as DraftPayload & { why?: { fromCopy?: unknown } };
  return Boolean(value.why?.fromCopy) && typeof value.markdown === 'string' && !proposeChanges(String(value.base ?? ''), value.markdown).length;
}

export async function lessonDraftView(row: DraftRow, viewerId: string): Promise<LessonDraftView | null> {
  const view = await draftView(row, viewerId, 'markdown');
  if (!view) return null;
  if (view.state === 'ready' && isEmptyCarriedDraft(row.payload)) return null;
  const payload = (row.payload ?? {}) as DraftPayload;
  return {
    ...view,
    markdown: view.state === 'ready' ? String(payload.markdown ?? '') : '',
    base: view.state === 'ready' ? String(payload.base ?? '') : '',
    diagrams: view.state === 'ready' ? draftDiagrams(row.payload).map((diagram) => diagram.path) : [],
    summary: row.summary ?? '',
    at: row.updatedAt.toISOString(),
    taskId: row.taskId,
    noteIds: Array.isArray(payload.why?.noteIds) ? payload.why.noteIds.filter((id): id is string => typeof id === 'string') : null,
  };
}

/**
 * Every revision of one lesson waiting for review, drafted here or sent by someone's Claude, and the
 * ones still being written (here, or by someone's Claude for a hand-off); newest first. The lesson's
 * Improve mode shows them all.
 */
export async function openLessonRevisions(lessonId: string) {
  return prisma.aiProposal.findMany({
    where: { kind: AiProposalKind.LESSON_REVISION, targetId: lessonId, OR: [{ status: AiProposalStatus.OPEN }, ...recentlyWorking()] },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: DRAFT_SELECT,
  });
}

/** A lesson revision's diagrams, as its payload holds them. */
export function draftDiagrams(payload: Prisma.JsonValue | null): DraftDiagram[] {
  const list = (payload as DraftPayload | null)?.diagrams;
  return Array.isArray(list) ? list.filter((item) => typeof item?.path === 'string' && typeof item?.svg === 'string') : [];
}

/** The diagram paths of a lesson's other revisions waiting for review: a new draft's diagrams get names of their own. */
export async function openDiagramPaths(lessonId: string) {
  const rows = await prisma.aiProposal.findMany({
    where: { kind: AiProposalKind.LESSON_REVISION, targetId: lessonId, status: AiProposalStatus.OPEN },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { payload: true },
  });
  return rows.flatMap((row) => draftDiagrams(row.payload).map((diagram) => diagram.path));
}

/** A lesson revision from anywhere (here or someone's Claude), with the lesson it's for. */
export async function loadLessonRevision(id: string) {
  return prisma.aiProposal.findFirst({ where: { id, kind: AiProposalKind.LESSON_REVISION }, select: { ...DRAFT_SELECT, targetId: true } });
}

/** Discard a lesson revision, wherever it came from (a running one here stops too). */
export async function discardLessonRevision(id: string) {
  const { count } = await prisma.aiProposal.updateMany({
    where: { id, kind: AiProposalKind.LESSON_REVISION, status: { in: [AiProposalStatus.OPEN, AiProposalStatus.PENDING, AiProposalStatus.WORKING, AiProposalStatus.FAILED] } },
    data: { status: AiProposalStatus.DISCARDED, decidedAt: new Date() },
  });
  return count > 0;
}

/** Undo a Discard, for a few minutes, wherever the revision came from. */
export async function reopenLessonRevision(id: string) {
  const { count } = await prisma.aiProposal.updateMany({
    where: { id, kind: AiProposalKind.LESSON_REVISION, status: AiProposalStatus.DISCARDED, decidedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    data: { status: AiProposalStatus.OPEN, decidedAt: null },
  });
  return count > 0;
}


/**
 * The drafts about one lesson's Improve mode (its revisions, and its improvements' plans) that are
 * waiting or being written, by id: the page compares them with the ones it has, to bring in what
 * arrived meanwhile (a draft someone's Claude sent, work started in another tab or by someone else).
 */
export async function lessonDraftIds(lessonId: string, taskIds: string[]) {
  const rows = await prisma.aiProposal.findMany({
    where: {
      OR: [
        { kind: AiProposalKind.LESSON_REVISION, targetId: lessonId },
        ...(taskIds.length ? [{ kind: AiProposalKind.TASK_PLAN, targetId: { in: taskIds } }] : []),
      ],
      AND: [{ OR: [{ status: AiProposalStatus.OPEN }, ...recentlyWorking()] }],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
