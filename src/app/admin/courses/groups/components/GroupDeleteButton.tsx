'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import AdminMenu, { type AdminMenuItem } from '@/app/admin/components/ui/AdminMenu';
import { SheetActionRow } from '@/app/admin/components/ui/Sheet';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';
import { deleteGroupAction } from '../actions';

interface GroupDeleteButtonProps {
  groupId: string;
  groupName: string;
  /** The group has its own (feedback-driven) curriculum, which is deleted with it. */
  hasGroupCurriculum?: boolean;
  /** In a "⋯" menu (with `menuItems` before it) instead of a red button. */
  inMenu?: boolean;
  menuItems?: AdminMenuItem[];
  /** A red row in a group of rows (the group's Settings), instead of a red button. */
  row?: boolean;
}

/**
 * Danger button (or menu item, or red row) + confirm dialog for deleting a group with its attendees and access links.
 * The action redirects on completion, so a plain transition is enough.
 */
export default function GroupDeleteButton({
  groupId,
  groupName,
  hasGroupCurriculum = false,
  inMenu = false,
  menuItems = [],
  row = false,
}: GroupDeleteButtonProps) {
  const t = useTranslations('groups.deleteGroup');
  const [open, setOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set('groupId', groupId);
    startDelete(() => {
      void deleteGroupAction(formData);
    });
  }

  return (
    <>
      {row ? (
        <SheetActionRow label={t('button')} destructive disabled={isDeleting} onClick={() => setOpen(true)} testId="group-delete" />
      ) : inMenu ? (
        <AdminMenu
          label={t('more', { name: groupName })}
          items={[...menuItems, { label: t('menuItem'), danger: true, onSelect: () => setOpen(true), disabled: isDeleting }]}
        />
      ) : (
        <AdminButton type="button" tone="dangerText" size="compact" disabled={isDeleting} onClick={() => setOpen(true)}>
          {t('button')}
        </AdminButton>
      )}

      <ConfirmDialog
        open={open}
        tone="danger"
        title={t('title')}
        description={hasGroupCurriculum ? t('descriptionWithCopy', { name: groupName }) : t('description', { name: groupName })}
        confirmLabel={t('button')}
        pending={isDeleting}
        onConfirm={handleDelete}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
