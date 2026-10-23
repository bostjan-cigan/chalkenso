'use client';

import { useTranslations } from 'next-intl';
import { ChangeEvent, useState } from 'react';
import AdminButton from '../../components/ui/AdminButton';
import { getAdminAssetUrl } from '@/lib/asset-urls';
import styles from '../../admin.module.css';

/**
 * Cover image for the course's card and page on the organisation's website (`cover` in the website
 * API). Uploads through the lesson asset endpoint (into the course's `cover` folder) as soon as a
 * file is picked; the form only submits the resulting asset id (`coverAssetId`).
 */
export default function CourseCoverField({
  courseId,
  initialAssetId = '',
  initialAlt = '',
}: {
  courseId: string;
  initialAssetId?: string;
  initialAlt?: string;
}) {
  const t = useTranslations('courses.form.cover');
  const [assetId, setAssetId] = useState(initialAssetId);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setIsUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.set('file', file);
      formData.set('sourcePath', `course-cover/${file.name}`);
      formData.set('courseId', courseId);
      formData.set('folder', 'cover');
      const response = await fetch('/admin/api/assets/upload', { body: formData, method: 'POST' });
      const payload = (await response.json()) as { asset?: { assetId: string }; error?: string };
      if (!response.ok || !payload.asset) {
        throw new Error(payload.error || t('uploadFailed'));
      }
      setAssetId(payload.asset.assetId);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('uploadFailed'));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className={styles.field}>
      <span className={styles.inputLabel}>{t('label')}</span>
      <input type="hidden" name="coverAssetId" value={assetId} />
      {assetId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={getAdminAssetUrl(assetId)}
          alt={t('alt')}
          style={{ width: '100%', maxWidth: 420, aspectRatio: '1200 / 630', objectFit: 'cover', borderRadius: 8 }}
        />
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <label className={styles.textInput} style={{ cursor: 'pointer', width: 'auto' }}>
          {isUploading ? t('uploading') : assetId ? t('replace') : t('upload')}
          <input type="file" accept="image/*" onChange={handleFileChange} disabled={isUploading} hidden />
        </label>
        {assetId ? (
          <AdminButton type="button" tone="secondary" size="compact" onClick={() => setAssetId('')}>
            {t('remove')}
          </AdminButton>
        ) : null}
      </div>
      <span className={styles.fieldHint}>
        {error || t('hint')}
      </span>
      {assetId ? (
        <input
          className={styles.textInput}
          name="coverAlt"
          aria-label={t('altLabel')}
          placeholder={t('altPlaceholder')}
          defaultValue={initialAlt}
        />
      ) : null}
    </div>
  );
}
