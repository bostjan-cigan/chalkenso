'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import ActionNotice from '@/app/admin/components/ui/ActionNotice';
import { SheetActionRow, SheetRows } from '@/app/admin/components/ui/Sheet';
import { useActionNotice } from '@/app/admin/components/ui/useActionNotice';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';
import {
  closeGroupCurriculumAction,
  disableGroupCurriculumAction,
  enableGroupCurriculumAction,
  reopenGroupCurriculumAction,
} from '../curriculum-actions';

type PendingConfirm = 'enable' | 'disable' | 'close' | null;

/**
 * The group's lessons in its Settings, as one group of rows: the row saying what it reads
 * (`children`), then what can happen to its own copy of the lessons: make one (`start`, a group that
 * reads the course's lessons), or close it when the group has finished, reopen it, or go back to the
 * course's lessons while it is untouched (`manage`). Each asks first; going back is in red.
 */
export default function GroupCopyActions({
  mode,
  groupId,
  groupName,
  readsLabel,
  closed = false,
  title,
  footer,
  children,
}: {
  /** null: nothing to do with a copy (a group that reads no lessons yet). */
  mode: 'start' | 'manage' | null;
  groupId: string;
  groupName: string;
  /** The course version the group reads now (or its copy came from). */
  readsLabel: string | null;
  closed?: boolean;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('groups.copyActions');
  const { notice, isPending, run } = useActionNotice();
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  const submit = useCallback(
    (action: (formData: FormData) => Promise<{ ok: boolean; message: string }>) => {
      const formData = new FormData();
      formData.set('groupId', groupId);
      run(() => action(formData), {
        fallbackError: t('failed'),
        onSuccess: () => setConfirm(null),
        onError: () => setConfirm(null),
      });
    },
    [groupId, run, t]
  );

  return (
    <>
      {notice ? <ActionNotice notice={notice} /> : null}
      <SheetRows title={title} footer={footer} testId="group-lessons">
        {children}
        {mode === 'start' ? (
          <SheetActionRow label={t('start')} disabled={isPending || !readsLabel} onClick={() => setConfirm('enable')} testId="group-copy-start" />
        ) : null}
        {mode === 'manage' ? (
          <>
            {closed ? (
              <SheetActionRow label={t('reopen')} disabled={isPending} onClick={() => submit(reopenGroupCurriculumAction)} testId="group-copy-reopen" />
            ) : (
              <SheetActionRow label={t('close')} disabled={isPending} onClick={() => setConfirm('close')} testId="group-copy-close" />
            )}
            <SheetActionRow label={t('useCourse')} destructive disabled={isPending} onClick={() => setConfirm('disable')} testId="group-copy-use-course" />
          </>
        ) : null}
      </SheetRows>

      <ConfirmDialog
        open={confirm === 'enable'}
        title={t('enable.title')}
        description={
          readsLabel ? t('enable.text', { name: groupName, version: readsLabel }) : t('enable.textLessons', { name: groupName })
        }
        confirmLabel={t('enable.confirm')}
        pending={isPending}
        onConfirm={() => submit(enableGroupCurriculumAction)}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'close'}
        title={t('closeConfirm.title')}
        description={t('closeConfirm.text')}
        confirmLabel={t('closeConfirm.confirm')}
        pending={isPending}
        onConfirm={() => submit(closeGroupCurriculumAction)}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'disable'}
        title={t('disable.title')}
        description={t('disable.text')}
        confirmLabel={t('disable.confirm')}
        tone="danger"
        pending={isPending}
        onConfirm={() => submit(disableGroupCurriculumAction)}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
