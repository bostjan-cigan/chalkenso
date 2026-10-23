'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '../../components/ui/AdminButton';
import AdminMenu from '../../components/ui/AdminMenu';
import ActionNotice from '../../components/ui/ActionNotice';
import { useActionNotice } from '../../components/ui/useActionNotice';
import { deleteLessonInlineAction } from '../actions';
import ConfirmDialog from './ConfirmDialog';

interface LessonDeleteButtonProps {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  /** In the row's "⋯" menu instead of a red button. */
  inMenu?: boolean;
}

/** Delete (a red button, or an item in the row's "⋯" menu) + confirm dialog for a lesson. */
export default function LessonDeleteButton({
  courseId,
  lessonId,
  lessonTitle,
  inMenu = false,
}: LessonDeleteButtonProps) {
  const t = useTranslations('editor.deleteLesson');
  const [open, setOpen] = useState(false);
  const { notice, isPending, run } = useActionNotice();

  function handleDelete() {
    const formData = new FormData();
    formData.set('courseId', courseId);
    formData.set('lessonId', lessonId);
    run(() => deleteLessonInlineAction(formData), {
      onSuccess: () => setOpen(false),
    });
  }

  return (
    <>
      <ActionNotice notice={notice} />
      {inMenu ? (
        <AdminMenu label={t('more', { title: lessonTitle })} items={[{ label: t('menuItem'), danger: true, onSelect: () => setOpen(true) }]} />
      ) : (
        <AdminButton type="button" tone="dangerText" size="compact" onClick={() => setOpen(true)}>
          {t('button')}
        </AdminButton>
      )}

      <ConfirmDialog
        open={open}
        tone="danger"
        title={t('title')}
        description={t('description', { title: lessonTitle })}
        confirmLabel={t('confirm')}
        pending={isPending}
        onConfirm={handleDelete}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
