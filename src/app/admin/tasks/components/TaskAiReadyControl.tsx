'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import AdminCheckbox from '../../components/ui/AdminCheckbox';
import { setTaskAiReadyAction } from '../actions';

/**
 * The handoff switch: with it on, whoever picks this task up in the vault may let the local agent
 * execute the revision on its own. Saves as soon as it is ticked, like the rest of Workflow.
 */
export default function TaskAiReadyControl({
  taskId,
  aiReady,
}: {
  taskId: string;
  aiReady: boolean;
}) {
  const t = useTranslations('tasks.controls.aiReady');
  const router = useRouter();
  const [value, setValue] = useState(aiReady);
  const [pending, startTransition] = useTransition();

  return (
    <AdminCheckbox
      name="aiReady"
      label={t('label')}
      hint={t('hint')}
      checked={value}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.checked;
        setValue(next);
        startTransition(async () => {
          await setTaskAiReadyAction(taskId, next);
          router.refresh();
        });
      }}
    />
  );
}
