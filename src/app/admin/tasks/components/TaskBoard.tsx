import type { ComponentProps } from 'react';
import IntlProvider from '@/i18n/IntlProvider';
import TaskBoardClient from './TaskBoardClient';

export type { TaskCardView, TaskLaneView } from './TaskBoardClient';

/**
 * The task board with its own words (`tasks.board`, `tasks.status`), wherever it shows: a course's
 * Feedback tab and a group's page too, whose providers don't give `tasks`. The Tasks page, whose
 * layout gives them, uses `TaskBoardClient` directly.
 */
export default function TaskBoard(props: ComponentProps<typeof TaskBoardClient>) {
  return (
    <IntlProvider namespaces={['common', 'app', 'tasks.board', 'tasks.status']}>
      <TaskBoardClient {...props} />
    </IntlProvider>
  );
}
