'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type CSSProperties, useMemo, useState, useTransition } from 'react';
import AdminSearchableSelectField from '../../components/ui/AdminSearchableSelectField';
import UserAvatar from '../../components/ui/UserAvatar';
import { setTaskAssigneeAction } from '../actions';

type AssignableUser = { id: string; name: string; avatarUrl: string | null; teachesGroup?: boolean };

type TaskAssigneeControlProps = {
  taskId: string;
  assignee: AssignableUser | null;
  users: AssignableUser[];
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: '0.6rem',
};

export default function TaskAssigneeControl({
  taskId,
  assignee,
  users,
}: TaskAssigneeControlProps) {
  const t = useTranslations('tasks.controls.assignee');
  const router = useRouter();
  const [value, setValue] = useState(assignee?.id ?? '');
  const [pending, startTransition] = useTransition();

  const options = useMemo(
    () => [
      { label: t('unassigned'), value: '' },
      ...users.map((user) => ({ label: user.name, value: user.id, ...(user.teachesGroup ? { hint: t('teachesGroup') } : {}) })),
    ],
    [users, t]
  );

  // Reflect the selection immediately (before the router refresh) in the avatar.
  const selected = value ? users.find((user) => user.id === value) ?? null : null;

  function onChange(next: string) {
    setValue(next);
    startTransition(async () => {
      await setTaskAssigneeAction(taskId, next);
      router.refresh();
    });
  }

  return (
    <div style={rowStyle}>
      <div style={{ paddingBottom: 6 }}>
        <UserAvatar
          name={selected?.name ?? t('unassigned')}
          imageUrl={selected?.avatarUrl ?? null}
          size={36}
        />
      </div>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <AdminSearchableSelectField
          id={`task-assignee-${taskId}`}
          label={t('label')}
          name="assignee"
          options={options}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={pending}
          placeholder={t('unassigned')}
          searchPlaceholder={t('search')}
        />
      </div>
    </div>
  );
}
