'use client';

import { useTranslations } from 'next-intl';
import LoadingFillCircle from '@/components/LoadingFillCircle';
import accessStyles from '@/app/l/access.module.css';

/** Neutral fallback matching the attendee background (not the admin chrome skeleton). */
export default function VersionPreviewLoading() {
  const t = useTranslations('courses.preview');
  return (
    <div className={accessStyles.page} aria-busy="true" aria-label={t('loading')}>
      <div className={accessStyles.shell}>
        <LoadingFillCircle centered ariaLabel={t('loading')} />
      </div>
    </div>
  );
}
