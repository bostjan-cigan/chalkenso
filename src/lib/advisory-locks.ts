import 'server-only';

import type { TransactionClient } from './prisma';

/**
 * Transaction-scoped advisory locks, for work that checks something and then writes ("is there
 * another owner?", "is there a free seat?"): every such request takes the same lock first, so the
 * second one checks only after the first has committed. The lock ends with its transaction, which
 * is what makes it safe behind PgBouncer in transaction mode (a session lock would outlive the
 * connection's turn). So: only inside `prisma.$transaction(async (tx) => …)`, as its first query.
 *
 * Keys are (kind, hashtext(id)). The kind keeps one sort of lock from waiting on another, and is a
 * different key space from the single-number lock in organizations.ts; two ids that happen to share
 * a hash only make their requests wait for each other.
 */
const LOCK_KINDS = {
  /** Owners, seats and classes of one organisation. */
  organization: 7316101,
  /** What one person creates for themselves (their own organisations). */
  user: 7316102,
  /** A group's access links. */
  group: 7316103,
  /** Turning one comment into a task. */
  comment: 7316104,
  /** One organisation's spend on the platform's AI key. */
  hostedAi: 7316105,
  /** The order of one curriculum version's sections. */
  version: 7316106,
  /** One lesson's open improvement (feedback joining it, or starting it). */
  lessonImprovement: 7316107,
  booking: 7316108,
} as const;

export type LockKind = keyof typeof LOCK_KINDS;

/** Waits for, then holds until the transaction ends, the lock on `id` of this kind. */
export async function lockFor(tx: TransactionClient, kind: LockKind, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KINDS[kind]}::int, hashtext(${id}))`;
}
