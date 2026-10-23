/**
 * Drafts made in the app run in the background (ai-drafts.ts): the draft is a proposal row that
 * AI fills while the page polls it, so the person can leave and find it there later. These are
 * the pure parts, shared by the server and the page (unit-tested in tests/e2e/unit-ai-drafts.mjs).
 */

/**
 * How far a draft is: someone's own Claude hasn't picked it up yet (a hand-off), the request is
 * being put together (or Claude reads it), Claude is thinking, Claude is writing.
 */
export type DraftStage = 'waiting' | 'reading' | 'thinking' | 'writing';

/** A draft as the page shows it. */
export type AppDraftView = {
  id: string;
  state: 'working' | 'ready' | 'failed';
  stage: DraftStage;
  /** What Claude has written so far (working), or the finished draft (ready). */
  text: string;
  /** How far the writing is, 0–1, when it can be told (a revised lesson against the lesson's length). */
  share: number | null;
  /** Why it failed, in the person's language. */
  error: string | null;
  startedAt: string;
  /** Who started it, when it was someone else. */
  by: string | null;
  /** AI in the app, or someone's own Claude through the connector (a hand-off, or a draft it sent). */
  source: 'app' | 'claude';
};

/** Progress is written about this often, and the page polls about as often. */
export const PROGRESS_MS = 700;
export const POLL_MS = 1000;
/** No word from a working draft for this long: it stopped (a restart, a deploy) and won't finish. */
export const STALE_MS = 2 * 60 * 1000;

/** Whether a working draft last heard of at `updatedAt` has stopped. */
export function isStale(updatedAt: Date | string, now = Date.now()) {
  return now - new Date(updatedAt).getTime() > STALE_MS;
}

/**
 * A hand-off to someone's own Claude (through an edition's connector): the page waits on it like on a
 * draft made here, but Claude only reports at its tool calls, so it is given longer. Still no sign of
 * Claude after `QUIET_MS`: the connector is probably off in that chat. Waiting for an hour, or
 * nothing from Claude for `GIVE_UP_MS` since its last tool call: it stopped.
 */
export const QUIET_MS = 2 * 60 * 1000;
export const GIVE_UP_MS = 10 * 60 * 1000;
export const WAIT_FOR_MS = 60 * 60 * 1000;

/**
 * A row someone's Claude started by reading what a draft would be for (an improvement, a lesson's
 * brief, a report) with no hand-off from the app: the pages show Claude at it all the same. It
 * becomes a plain `connector` row when Claude sends the draft; never filled, it goes quietly after
 * `GIVE_UP_MS` (Claude may only have looked), not as "Claude stopped".
 */
export const CONNECTOR_READ = 'connector-read';

/** A draft row as far as "is it still being written?" goes. */
export type DraftRowState = { status: string; via: string; createdAt: Date | string; updatedAt: Date | string };

/** Whether a row is still being written: here (heard of lately) or by someone's Claude (a hand-off it may still take up). */
export function stillWorking(row: DraftRowState, now = Date.now()) {
  if (row.via === 'app') return row.status === 'WORKING' && !isStale(row.updatedAt, now);
  if (row.status === 'PENDING') return now - new Date(row.createdAt).getTime() <= WAIT_FOR_MS;
  return row.status === 'WORKING' && now - new Date(row.updatedAt).getTime() <= GIVE_UP_MS;
}

/** A hand-off's stage: waiting until Claude reads the brief, then what its tool calls said. */
export function handoffStage(status: string, stage: DraftStage | undefined): DraftStage {
  if (status === 'PENDING') return 'waiting';
  return stage && stage !== 'waiting' ? stage : 'reading';
}

/** Each read Claude makes for a hand-off moves it on: the first starts it (reading), the next is the last before it writes. */
export function nextHandoffStage(status: string, stage: DraftStage | undefined): DraftStage {
  if (status === 'PENDING') return 'reading';
  return handoffStage(status, stage) === 'reading' ? 'writing' : handoffStage(status, stage);
}

/**
 * The text inside `<tag>` while Claude is still writing it: from the opening tag to the closing
 * one, or to the end so far, without the start of a closing tag that hasn't fully arrived.
 */
export function partialTag(text: string, tag: string) {
  const open = text.indexOf(`<${tag}>`);
  if (open === -1) return '';
  const body = text.slice(open + tag.length + 2);
  const closing = `</${tag}>`;
  const close = body.indexOf(closing);
  if (close !== -1) return body.slice(0, close).trim();
  for (let length = Math.min(closing.length - 1, body.length); length > 0; length -= 1) {
    if (body.endsWith(closing.slice(0, length))) return body.slice(0, -length).trimStart();
  }
  return body.trimStart();
}

/**
 * How far a rewritten text is: the part written so far against the length of the text it rewrites,
 * capped below 1 (the end isn't known until it's there).
 */
export function writtenShare(written: string, original: string) {
  return Math.min(0.99, written.length / Math.max(original.length, 1));
}

/** "0:07", "1:42": how long a draft has been running. */
export function elapsed(startedAt: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
