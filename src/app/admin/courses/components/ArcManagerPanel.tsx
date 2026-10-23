'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { FiArrowDown, FiArrowUp, FiPlus } from 'react-icons/fi';
import AdminBadge from '../../components/ui/AdminBadge';
import AdminButton from '../../components/ui/AdminButton';
import AdminCard from '../../components/ui/AdminCard';
import AdminField from '../../components/ui/AdminField';
import AdminTextareaField from '../../components/ui/AdminTextareaField';
import ActionNotice from '../../components/ui/ActionNotice';
import { useActionNotice } from '../../components/ui/useActionNotice';
import {
  createArcAction,
  deleteArcAction,
  moveArcAction,
  updateArcAction,
} from '../arcs/actions';
import ConfirmDialog from './ConfirmDialog';
import CourseListInfo from './CourseListInfo';
import { courseListMetaGroupStyle } from './courseListShared';
import styles from '../../admin.module.css';

type ArcRow = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  lessonCount: number;
};

interface ArcManagerPanelProps {
  courseId: string;
  versionId: string;
  arcs: ArcRow[];
}

/** Create, rename, describe, reorder and delete the arcs (sections) of a curriculum version. */
export default function ArcManagerPanel({ courseId, versionId, arcs }: ArcManagerPanelProps) {
  const t = useTranslations('courses.arcs');
  const { notice, isPending, run } = useActionNotice();
  const [editingArcId, setEditingArcId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ArcRow | null>(null);

  function baseFormData(extra?: Record<string, string>) {
    const formData = new FormData();
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    for (const [key, value] of Object.entries(extra ?? {})) {
      formData.set(key, value);
    }
    return formData;
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    run(() => createArcAction(formData), {
      onSuccess: () => form.reset(),
    });
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>, arcId: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('courseId', courseId);
    formData.set('versionId', versionId);
    formData.set('arcId', arcId);
    run(() => updateArcAction(formData), {
      onSuccess: () => setEditingArcId(null),
    });
  }

  function handleMove(arcId: string, direction: 'up' | 'down') {
    run(() => moveArcAction(baseFormData({ arcId, direction })));
  }

  function handleDelete() {
    if (!pendingDelete) {
      return;
    }
    const arcId = pendingDelete.id;
    run(() => deleteArcAction(baseFormData({ arcId })), {
      onSuccess: () => setPendingDelete(null),
    });
  }

  return (
    <div className={styles.profileImageStack}>
      <ActionNotice notice={notice} />

      <form onSubmit={handleCreate} className={styles.formGrid}>
        <AdminField
          id="arc-title"
          name="title"
          label={t('title')}
          placeholder={t('titlePlaceholder')}
          required
        />
        <AdminTextareaField
          id="arc-description"
          name="description"
          label={t('description')}
          hint={t('descriptionHint')}
          placeholder={t('descriptionPlaceholder')}
          fullWidth
          rows={2}
        />
        <div className={styles.inlineActions}>
          <AdminButton type="submit" size="compact" disabled={isPending}>
            <FiPlus size={14} />
            {t('add')}
          </AdminButton>
        </div>
      </form>

      {arcs.length > 0 ? (
        <div className={styles.entityList}>
          {arcs.map((arc, index) => {
            const isEditing = editingArcId === arc.id;

            return (
              <AdminCard
                key={arc.id}
                variant="compact"
                className={`${styles.entityRow} ${styles.courseListRow}`}
              >
                {isEditing ? (
                  <form
                    onSubmit={(event) => handleUpdate(event, arc.id)}
                    className={styles.formGrid}
                    style={{ width: '100%' }}
                  >
                    <AdminField
                      id={`arc-title-${arc.id}`}
                      name="title"
                      label={t('title')}
                      defaultValue={arc.title}
                      required
                    />
                    <AdminTextareaField
                      id={`arc-description-${arc.id}`}
                      name="description"
                      label={t('description')}
                      defaultValue={arc.description ?? ''}
                      fullWidth
                      rows={2}
                    />
                    <div className={styles.inlineActions}>
                      <AdminButton type="submit" size="compact" disabled={isPending}>
                        {t('save')}
                      </AdminButton>
                      <AdminButton
                        type="button"
                        tone="secondary"
                        size="compact"
                        onClick={() => setEditingArcId(null)}
                      >
                        {t('cancel')}
                      </AdminButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className={`${styles.entityRowBody} ${styles.courseListBody}`}>
                      <div className={styles.courseListTitleRow}>
                        <h3 className={styles.courseListTitle}>
                          {arc.title}
                          <AdminBadge variant="muted" className={styles.inlineBadgeSpacing}>
                            {t('lessons', { count: arc.lessonCount })}
                          </AdminBadge>
                        </h3>
                        {arc.description ? (
                          <div style={courseListMetaGroupStyle}>
                            <CourseListInfo>{arc.description}</CourseListInfo>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={`${styles.entityRowActions} ${styles.courseListActions}`}>
                      <AdminButton
                        type="button"
                        tone="plain"
                        size="compact"
                        aria-label={t('moveUp')}
                        disabled={isPending || index === 0}
                        onClick={() => handleMove(arc.id, 'up')}
                      >
                        <FiArrowUp size={14} />
                      </AdminButton>
                      <AdminButton
                        type="button"
                        tone="plain"
                        size="compact"
                        aria-label={t('moveDown')}
                        disabled={isPending || index === arcs.length - 1}
                        onClick={() => handleMove(arc.id, 'down')}
                      >
                        <FiArrowDown size={14} />
                      </AdminButton>
                      <AdminButton
                        type="button"
                        tone="plain"
                        size="compact"
                        onClick={() => setEditingArcId(arc.id)}
                      >
                        {t('edit')}
                      </AdminButton>
                      <AdminButton
                        type="button"
                        tone="dangerText"
                        size="compact"
                        onClick={() => setPendingDelete(arc)}
                      >
                        {t('delete')}
                      </AdminButton>
                    </div>
                  </>
                )}
              </AdminCard>
            );
          })}
        </div>
      ) : (
        <p className={styles.helperText}>
          {t('empty')}
        </p>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        tone="danger"
        title={t('deleteTitle')}
        description={
          pendingDelete && pendingDelete.lessonCount > 0
            ? t('deleteWithLessons', { count: pendingDelete.lessonCount })
            : t('deleteDescription')
        }
        confirmLabel={t('deleteConfirm')}
        pending={isPending}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
