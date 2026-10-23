import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TaskStatus } from '@prisma/client';
import AdminButton from '../../components/ui/AdminButton';
import { proposeForCoreAction, taskDecisionAction } from '../../tasks/actions';
import type { ForkTaskRef, VersionFork } from '../versions/data';
import styles from '../../admin.module.css';

type DecisionButton = { label: string; status: TaskStatus | 'GROUP_ONLY'; primary?: boolean };

/** A task row: status, title linking to the task, and one-click decisions that stay on this page. */
function DecisionRow({
  task,
  note,
  buttons,
  propose,
  returnPath,
  labels,
}: {
  task: ForkTaskRef;
  note: string;
  buttons: DecisionButton[];
  propose?: boolean;
  returnPath: string;
  labels: { propose: string; open: string };
}) {
  return (
    <li className={styles.forkDecisionRow}>
      <div style={{ minWidth: 0 }}>
        <Link href={`/admin/tasks/${task.id}`} className={styles.forkDecisionTitle}>
          {task.title}
        </Link>
        <span className={styles.fieldHint}> · {note}</span>
      </div>
      <div className={styles.versionForkActions}>
        {propose ? (
          <form action={proposeForCoreAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnPath" value={returnPath} />
            <AdminButton type="submit" size="compact">
              {labels.propose}
            </AdminButton>
          </form>
        ) : null}
        {buttons.length > 0 ? (
          <form action={taskDecisionAction} className={styles.versionForkActions}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnPath" value={returnPath} />
            {buttons.map((button) => (
              <AdminButton
                key={button.status}
                type="submit"
                name="status"
                value={button.status}
                size="compact"
                tone={button.primary ? undefined : 'secondary'}
              >
                {button.label}
              </AdminButton>
            ))}
          </form>
        ) : null}
        <AdminButton href={`/admin/tasks/${task.id}`} tone="secondary" size="compact">
          {labels.open}
        </AdminButton>
      </div>
    </li>
  );
}

/**
 * What waits on someone for this fork: open group tasks, proposals for the core, and finished group
 * work nobody has decided about yet (propose it, or keep it group-only).
 */
export async function ForkDecisions({
  fork,
  returnPath,
  suggestionsOnly = false,
}: {
  fork: VersionFork;
  returnPath: string;
  /** Only what the course decides (suggestions, finished group work): the group's own tasks are on its page. */
  suggestionsOnly?: boolean;
}) {
  const { proposals, unproposed } = fork.pending;
  const groupTasks = suggestionsOnly ? [] : fork.pending.groupTasks;
  if (groupTasks.length + proposals.length + unproposed.length === 0) {
    return null;
  }
  const t = await getTranslations('courses.forks');
  const labels = { propose: t('propose'), open: t('open') };
  const doneButton: DecisionButton = { label: t('markDone'), status: TaskStatus.DONE };

  return (
    <div className={styles.forkDecisions}>
      <p className={styles.forkDecisionsHeading}>
        {fork.decisionCount > 0 ? t('needsDecision') : t('inProgress')}
      </p>

      {proposals.length > 0 ? (
        <section>
          <h4 className={styles.forkDecisionGroup}>{t('suggested')}</h4>
          <ul className={styles.forkDecisionList}>
            {proposals.map((task) =>
              task.status === TaskStatus.TODO ? (
                <DecisionRow
                  key={task.id}
                  task={task}
                  note={t('waitingForReview')}
                  buttons={[
                    { label: t('accept'), status: TaskStatus.IN_PROGRESS, primary: true },
                    { label: t('decline'), status: TaskStatus.IGNORED },
                  ]}
                  returnPath={returnPath}
                  labels={labels}
                />
              ) : (
                <DecisionRow
                  key={task.id}
                  task={task}
                  note={t('accepted')}
                  buttons={[doneButton]}
                  returnPath={returnPath}
                  labels={labels}
                />
              )
            )}
          </ul>
        </section>
      ) : null}

      {groupTasks.length > 0 ? (
        <section>
          <h4 className={styles.forkDecisionGroup}>{t('groupTasks')}</h4>
          <ul className={styles.forkDecisionList}>
            {groupTasks.map((task) =>
              task.status === TaskStatus.TODO ? (
                <DecisionRow
                  key={task.id}
                  task={task}
                  note={t('toDo')}
                  buttons={[
                    { label: t('start'), status: TaskStatus.IN_PROGRESS, primary: true },
                    { label: t('ignore'), status: TaskStatus.IGNORED },
                  ]}
                  returnPath={returnPath}
                  labels={labels}
                />
              ) : (
                <DecisionRow
                  key={task.id}
                  task={task}
                  note={t('taskInProgress')}
                  buttons={[doneButton]}
                  returnPath={returnPath}
                  labels={labels}
                />
              )
            )}
          </ul>
        </section>
      ) : null}

      {unproposed.length > 0 ? (
        <section>
          <h4 className={styles.forkDecisionGroup}>{t('doneInGroup')}</h4>
          <ul className={styles.forkDecisionList}>
            {unproposed.map((task) => (
              <DecisionRow
                key={task.id}
                task={task}
                note={t('done')}
                propose
                buttons={[{ label: t('keepInGroup'), status: 'GROUP_ONLY' }]}
                returnPath={returnPath}
                labels={labels}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
