'use client';

import { useTranslations } from 'next-intl';
import AdminButton from '../../components/ui/AdminButton';
import { deleteLessonFeedbackAction } from '../../tasks/actions';

/** Submits the feedback item's form to delete it, after a confirmation that says what goes. */
export default function DeleteFeedbackButton({ fromFeedback }: { fromFeedback: boolean }) {
  const t = useTranslations('courses.deleteTask');
  return (
    <AdminButton
      type="submit"
      formAction={deleteLessonFeedbackAction}
      size="compact"
      tone="dangerText"
      onClick={(event) => {
        if (!window.confirm(fromFeedback ? t('confirmWithFeedback') : t('confirm'))) {
          event.preventDefault();
        }
      }}
    >
      {t('button')}
    </AdminButton>
  );
}
