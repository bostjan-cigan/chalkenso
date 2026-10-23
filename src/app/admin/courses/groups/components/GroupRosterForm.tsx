'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBadge from '@/app/admin/components/ui/AdminBadge';
import AdminSubmitButton from '@/app/admin/components/ui/AdminSubmitButton';
import AdminTextareaField from '@/app/admin/components/ui/AdminTextareaField';
import { parseGroupRoster } from '@/lib/group-roster';
import { updateGroupRosterAction } from '../actions';
import styles from '../../../admin.module.css';

/**
 * The group's learners on their own, for instructors who manage the roster and links but not the
 * group's settings. Same paste-and-preview as the group form.
 */
export default function GroupRosterForm({ groupId, initialRoster }: { groupId: string; initialRoster: string }) {
  const t = useTranslations('groups.roster');
  const [roster, setRoster] = useState(initialRoster);
  const parsed = parseGroupRoster(roster);
  return (
    <form action={updateGroupRosterAction} style={{ display: 'grid', gap: '0.75rem' }} data-testid="group-roster-form">
      <input type="hidden" name="groupId" value={groupId} />
      <AdminTextareaField
        id="group-roster-only"
        name="sourceRosterText"
        label={t('label')}
        hint={t('hint')}
        value={roster}
        onChange={(event) => setRoster(event.target.value)}
        fullWidth
      />
      <p className={styles.fieldHint} style={{ margin: 0 }}>
        <AdminBadge variant="muted">
          {t('learners', { count: parsed.length })}
        </AdminBadge>
      </p>
      <div>
        <AdminSubmitButton pendingText={t('saving')}>{t('save')}</AdminSubmitButton>
      </div>
    </form>
  );
}
