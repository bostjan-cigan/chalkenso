'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { TbSparkles } from 'react-icons/tb';
import { startRoundAction } from '@/app/admin/courses/round-actions';
import AdminButton from '../ui/AdminButton';
import AdminMenu from '../ui/AdminMenu';

/**
 * "Sort with AI" on a Feedback list: AI sorts all new feedback of the version (or a group's copy),
 * and its page opens to edit and approve it. Several versions with new feedback: a menu picks one.
 */
export default function SortFeedbackButton({ courseId, versions }: { courseId: string; versions: Array<{ id: string; label: string }> }) {
  const t = useTranslations('courses.round');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sort = (versionId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await startRoundAction(versionId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/admin/courses/${courseId}/versions/${versionId}/sort`);
    });
  if (!versions.length) return null;
  return (
    <>
      {versions.length === 1 ? (
        <AdminButton type="button" size="compact" disabled={pending} onClick={() => sort(versions[0].id)} data-testid="feedback-sort">
          <TbSparkles aria-hidden size={15} /> {t('sort')}
        </AdminButton>
      ) : (
        <AdminMenu label={t('sort')} trigger={<><TbSparkles aria-hidden size={15} /> {t('sort')}</>} items={versions.map((version) => ({ label: version.label, onSelect: () => sort(version.id) }))} />
      )}
      {error ? <span role="status">{error}</span> : null}
    </>
  );
}
