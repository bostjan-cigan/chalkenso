'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import AdminButton from '../ui/AdminButton';
import ConfirmDialog from '../../courses/components/ConfirmDialog';
import { publishLessonsAction } from '../../courses/lesson-change-actions';

/** "Publish both": learners see the saved changes from now on (asked first; Cancel is the default). */
export default function PublishLessonsButton({
  lessonIds,
  words,
  buttonClassName,
}: {
  lessonIds: string[];
  words: { button: string; title: string; description: string; confirm: string; cancel: string };
  /** A list row's own button style (its next step), instead of the standard button. */
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {buttonClassName ? (
        <button type="button" className={buttonClassName} onClick={() => setConfirming(true)} disabled={pending} data-testid="publish-lessons">
          {words.button}
        </button>
      ) : (
        <AdminButton type="button" size="compact" onClick={() => setConfirming(true)} disabled={pending} data-testid="publish-lessons">
          {words.button}
        </AdminButton>
      )}
      <ConfirmDialog
        open={confirming}
        title={words.title}
        description={words.description}
        confirmLabel={words.confirm}
        cancelLabel={words.cancel}
        pending={pending}
        onConfirm={() => {
          setConfirming(false);
          startTransition(async () => {
            await publishLessonsAction(lessonIds);
            router.refresh();
          });
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
