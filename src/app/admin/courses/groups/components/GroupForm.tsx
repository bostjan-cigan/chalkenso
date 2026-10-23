'use client';

import { useTranslations } from 'next-intl';
import AdminCheckbox from '@/app/admin/components/ui/AdminCheckbox';
import AdminSubmitButton from '@/app/admin/components/ui/AdminSubmitButton';
import styles from '@/app/admin/admin.module.css';
import { GroupLessonsFields, GroupNameFields, GroupRosterFields } from './GroupSettingsSheets';

type CourseOption = {
  id: string;
  slug: string;
  title: string;
};

type VersionOption = {
  id: string;
  label: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
};

interface GroupFormProps {
  action: (formData: FormData) => void;
  courses: CourseOption[];
  versionsByCourseId: Record<string, VersionOption[]>;
  initialCourseId?: string;
}

/**
 * A new group, with only what it needs to start: its lessons, its name and its learners. Dates,
 * description, partners and Slack wait for the group's Settings tab, where each part is a row that
 * opens its own sheet (`GroupSettingsSheets`).
 */
export default function GroupForm({ action, courses, versionsByCourseId, initialCourseId = '' }: GroupFormProps) {
  const t = useTranslations('groups');

  return (
    <form className={styles.formStack} action={action}>
      <div className={styles.formGrid}>
        <GroupLessonsFields courses={courses} versionsByCourseId={versionsByCourseId} initialCourseId={initialCourseId} />

        <GroupNameFields quietSlug />

        <GroupRosterFields fullWidth />
      </div>

      <AdminCheckbox name="ownCopy" label={t('form.ownCopy')} hint={t('form.ownCopyHint')} defaultChecked />

      <AdminSubmitButton pendingText={t('newGroup.pending')}>{t('newGroup.submit')}</AdminSubmitButton>
    </form>
  );
}
