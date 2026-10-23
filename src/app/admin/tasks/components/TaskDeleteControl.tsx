'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import AdminButton from '../../components/ui/AdminButton';
import ConfirmDialog from '../../courses/components/ConfirmDialog';
import { deleteIgnoredTasksAction, deleteLessonFeedbackAction } from '../actions';

/**
 * Deletes a task from its own detail view, then goes back to the board (the task's page no longer
 * exists). An ignored one is cleared away; any other (`withFeedback`) is deleted with the feedback it
 * was made from, as the dialog says. Cancel is the default.
 */
export default function TaskDeleteControl({
  taskId,
  title,
  returnHref,
  withFeedback = false,
}: {
  taskId: string;
  title: string;
  /** Where to land afterwards: the board, keeping its kind/curriculum filter when it has one. */
  returnHref: string;
  /** A live improvement: deleted together with the feedback it came from. */
  withFeedback?: boolean;
}) {
  const t = useTranslations('tasks.board.confirm');
  const td = useTranslations('tasks.detail.delete');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <AdminButton
        type="button"
        tone="dangerText"
        size="compact"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        {withFeedback ? td('button') : t('deleteOne')}
      </AdminButton>
      <ConfirmDialog
        open={confirming}
        title={withFeedback ? td('title') : t('titleIgnored')}
        description={withFeedback ? td('description', { title }) : t('description', { what: t('quoted', { title }), mode: 'ignored', count: 1 })}
        confirmLabel={withFeedback ? td('confirm') : t('deleteOne')}
        cancelLabel={t('cancel')}
        tone="danger"
        pending={pending}
        onConfirm={() => {
          setConfirming(false);
          startTransition(async () => {
            if (withFeedback) {
              const formData = new FormData();
              formData.set('taskId', taskId);
              await deleteLessonFeedbackAction(formData);
            } else {
              await deleteIgnoredTasksAction([taskId]);
            }
            router.push(returnHref);
            router.refresh();
          });
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
