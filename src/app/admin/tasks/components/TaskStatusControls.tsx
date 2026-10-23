'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { TaskStatus } from '@prisma/client';
import AdminSearchableSelectField from '../../components/ui/AdminSearchableSelectField';
import { moveTaskAction } from '../actions';
import { TASK_STATUS_KEYS } from '../task-status-labels';

const STATUS_ORDER: TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.DONE,
  TaskStatus.IGNORED,
];

function isTaskStatus(value: string): value is TaskStatus {
  return (STATUS_ORDER as string[]).includes(value);
}

/** Status switcher rendered as a styled dropdown; changing it moves the task. */
export default function TaskStatusControls({
  taskId,
  status,
}: {
  taskId: string;
  status: TaskStatus;
}) {
  const t = useTranslations('tasks');
  const router = useRouter();
  const [value, setValue] = useState<TaskStatus>(status);
  const [pending, startTransition] = useTransition();

  const options = useMemo(
    () => STATUS_ORDER.map((option) => ({ label: t(`status.${TASK_STATUS_KEYS[option]}`), value: option })),
    [t]
  );

  function onChange(next: string) {
    if (!isTaskStatus(next)) {
      return;
    }
    setValue(next);
    startTransition(async () => {
      await moveTaskAction(taskId, next);
      router.refresh();
    });
  }

  return (
    <AdminSearchableSelectField
      id={`task-status-${taskId}`}
      label={t('controls.status')}
      name="status"
      options={options}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={pending}
    />
  );
}
