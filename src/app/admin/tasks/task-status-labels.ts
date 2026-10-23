import { TaskStatus } from '@prisma/client';

/**
 * Each status's message key (`tasks.status`), in the viewer's language. Plain module on purpose:
 * server components read these too, and anything exported from a `'use client'` module reaches the
 * server as a client reference, not a real value — which renders an empty status badge instead of
 * its text.
 */
export const TASK_STATUS_KEYS = {
  TODO: 'todo',
  IN_PROGRESS: 'inProgress',
  DONE: 'done',
  IGNORED: 'ignored',
} as const satisfies Record<TaskStatus, string>;
