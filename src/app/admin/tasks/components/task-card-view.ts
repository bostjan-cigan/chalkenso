import { type TaskListItem, taskAge, taskStaleness } from '@/lib/tasks';
import type { TaskCardView } from './TaskBoardClient';

/**
 * Maps a server task to the board's client-safe card. Age and staleness are resolved here, on the
 * server, so the board never computes a clock-dependent value during hydration.
 */
export function toTaskCardView(task: TaskListItem, now: Date = new Date()): TaskCardView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    proposerName: task.proposerName,
    context: task.context,
    proposal: task.proposal,
    assignee: task.assignee,
    hasPlan: task.hasPlan,
    aiReady: task.aiReady,
    commentCount: task.commentCount,
    age: taskAge(task.createdAt, now),
    staleness: taskStaleness(task, now),
  };
}
