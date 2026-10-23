'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import AdminSearchableSelectField from '../../components/ui/AdminSearchableSelectField';

/**
 * Which of the course's versions the Lessons tab shows: the published one by default, the others a
 * pick away (drafts of the next version, older ones). Kept in the URL (`?version=`). The tab's other
 * views (an edition's, under `path`) keep their own `params` when the version changes.
 */
export default function VersionPicker({
  courseId,
  value,
  versions,
  path,
  params,
}: {
  courseId: string;
  value: string;
  versions: Array<{ id: string; label: string; status: 'DRAFT' | 'PUBLISHED' }>;
  path?: string;
  params?: Record<string, string>;
}) {
  const router = useRouter();
  const t = useTranslations('courses.versions');
  return (
    <AdminSearchableSelectField
      id="course-version"
      label={t('version')}
      hideLabel
      compact
      style={{ minWidth: 200 }}
      searchable={versions.length > 8}
      value={value}
      options={versions.map((version) => ({
        value: version.id,
        label: `${version.label} · ${version.status === 'PUBLISHED' ? t('published') : t('draft')}`,
      }))}
      onValueChange={(next) => router.push(`${path ?? `/admin/courses/${courseId}`}?${new URLSearchParams({ ...params, version: next })}`)}
    />
  );
}
