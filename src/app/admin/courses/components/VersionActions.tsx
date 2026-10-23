'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { CurriculumVersionStatus } from '@prisma/client';
import { FiEye } from 'react-icons/fi';
import AdminButton from '../../components/ui/AdminButton';
import ActionNotice from '../../components/ui/ActionNotice';
import { useActionNotice } from '../../components/ui/useActionNotice';
import {
  deleteVersionAction,
  publishVersionAction,
  unpublishVersionAction,
} from '../versions/actions';
import ConfirmDialog from './ConfirmDialog';
import styles from '../../admin.module.css';

interface VersionActionsProps {
  courseId: string;
  versionId: string;
  status: CurriculumVersionStatus;
  /** Whether delete is offered (no groups assigned, draft, not the only version). */
  canDelete: boolean;
}

type OpenDialog = 'toggle' | 'delete' | null;

/** Publish / preview / delete actions, shown at the bottom of the version's lessons. */
export default function VersionActions({
  courseId,
  versionId,
  status,
  canDelete,
}: VersionActionsProps) {
  const t = useTranslations('courses.versions');
  const isPublished = status === CurriculumVersionStatus.PUBLISHED;
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const { notice, isPending, run } = useActionNotice();
  // Delete redirects to the course page on success, so it keeps a plain transition.
  const [isDeleting, startDelete] = useTransition();

  function versionFormData() {
    const formData = new FormData();
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    return formData;
  }

  function runToggle() {
    const action = isPublished ? unpublishVersionAction : publishVersionAction;
    run(() => action(versionFormData()), { onSuccess: () => setDialog(null) });
  }

  function runDelete() {
    startDelete(() => {
      void deleteVersionAction(versionFormData());
    });
  }

  return (
    <>
      <ActionNotice notice={notice} />

      <div className={styles.versionActionsRow}>
        <AdminButton
          href={`/admin/courses/${courseId}/versions/${versionId}/preview`}
          tone="secondary"
          size="compact"
          target="_blank"
          rel="noreferrer"
        >
          <FiEye size={14} />
          {t('preview')}
        </AdminButton>

        {/* Publishing is the main thing to do with a draft; unpublishing isn't. */}
        <AdminButton
          type="button"
          tone={isPublished ? 'secondary' : 'primary'}
          size="compact"
          disabled={isPending}
          onClick={() => setDialog('toggle')}
        >
          {isPublished ? t('unpublish') : t('publish')}
        </AdminButton>

        {canDelete ? (
          <AdminButton
            type="button"
            tone="dangerText"
            size="compact"
            disabled={isDeleting}
            onClick={() => setDialog('delete')}
          >
            {t('delete')}
          </AdminButton>
        ) : null}
      </div>

      <ConfirmDialog
        open={dialog === 'toggle'}
        tone="primary"
        title={isPublished ? t('unpublishTitle') : t('publishTitle')}
        description={isPublished ? t('unpublishDescription') : t('publishDescription')}
        confirmLabel={isPublished ? t('unpublish') : t('publish')}
        pending={isPending}
        onConfirm={runToggle}
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        tone="danger"
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={t('delete')}
        pending={isDeleting}
        onConfirm={runDelete}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
