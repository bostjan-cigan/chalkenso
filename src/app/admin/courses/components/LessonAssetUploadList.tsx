'use client';

import { ChangeEvent, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  FiCheck,
  FiImage,
  FiUploadCloud,
} from 'react-icons/fi';
import { INTL_LOCALES, type Locale } from '@/i18n/config';
import type { MarkdownImageReference } from '@/lib/course-markdown';
import AdminBadge from '../../components/ui/AdminBadge';
import AdminButton from '../../components/ui/AdminButton';
import AdminNotice from '../../components/ui/AdminNotice';
import styles from '../../admin.module.css';
import type { UploadedLessonAsset } from '../types';

type UploadState = {
  error?: string;
  isUploading?: boolean;
};

interface LessonAssetUploadListProps {
  /** The lesson's course: its images are stored in that course's `lessons` folder. */
  courseId: string;
  onAssetUploaded: (asset: UploadedLessonAsset) => void;
  references: MarkdownImageReference[];
  uploadedAssets: Record<string, UploadedLessonAsset>;
}

function formatBytes(bytes: number | null, locale: Locale) {
  if (!bytes) {
    return null;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  // One decimal, no thousands separator (1023.9 KB; 1023,9 KB in Slovenian).
  const decimal = new Intl.NumberFormat(INTL_LOCALES[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });

  if (bytes < 1024 * 1024) {
    return `${decimal.format(bytes / 1024)} KB`;
  }

  return `${decimal.format(bytes / (1024 * 1024))} MB`;
}

export default function LessonAssetUploadList({
  courseId,
  onAssetUploaded,
  references,
  uploadedAssets,
}: LessonAssetUploadListProps) {
  const t = useTranslations('editor.assets');
  const locale = useLocale() as Locale;
  const [uploadStateByPath, setUploadStateByPath] = useState<Record<string, UploadState>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function handleFileChange(sourcePath: string, event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;

    if (!nextFile) {
      setUploadStateByPath((currentState) => ({
        ...currentState,
        [sourcePath]: {
          error: undefined,
          isUploading: false,
        },
      }));
      return;
    }

    void handleUpload(sourcePath, nextFile, event.target);
  }

  async function handleUpload(
    sourcePath: string,
    selectedFile: File,
    inputElement?: HTMLInputElement | null
  ) {
    if (uploadStateByPath[sourcePath]?.isUploading) {
      return;
    }

    if (!selectedFile) {
      if (inputElement) {
        inputElement.value = '';
      }

      setUploadStateByPath((currentState) => ({
        ...currentState,
        [sourcePath]: {
          error: t('chooseFirst'),
          isUploading: false,
        },
      }));
      return;
    }

    if (inputElement) {
      inputElement.value = '';
    }
    setUploadStateByPath((currentState) => ({
      ...currentState,
      [sourcePath]: {
        error: undefined,
        isUploading: true,
      },
    }));

    try {
      const formData = new FormData();

      formData.set('file', selectedFile);
      formData.set('sourcePath', sourcePath);
      formData.set('courseId', courseId);

      const response = await fetch('/admin/api/assets/upload', {
        body: formData,
        method: 'POST',
      });
      const payload = (await response.json()) as {
        asset?: UploadedLessonAsset;
        error?: string;
      };

      if (!response.ok || !payload.asset) {
        throw new Error(payload.error || t('uploadFailed'));
      }

      onAssetUploaded(payload.asset);
      setUploadStateByPath((currentState) => ({
        ...currentState,
        [sourcePath]: {
          error: undefined,
          isUploading: false,
        },
      }));
    } catch (error) {
      setUploadStateByPath((currentState) => ({
        ...currentState,
        [sourcePath]: {
          error: error instanceof Error ? error.message : t('uploadFailed'),
          isUploading: false,
        },
      }));
    }
  }

  if (references.length === 0) {
    return (
      <AdminNotice variant="banner" icon={<FiImage size={18} />}>
        {t('none')}
      </AdminNotice>
    );
  }

  return (
    <div className={styles.assetPanel}>
      <div className={styles.assetPanelHeader}>
        <div>
          <h3>{t('title')}</h3>
          <p className={styles.helperText}>
            {t('hint')}
          </p>
        </div>
        <AdminBadge variant="warning">{t('missing', { count: references.length })}</AdminBadge>
      </div>

      <div className={styles.assetList}>
        {references.map((reference) => {
          const uploadedAsset = uploadedAssets[reference.sourcePath];
          const uploadState = uploadStateByPath[reference.sourcePath];
          const byteLabel = formatBytes(uploadedAsset?.bytes ?? null, locale);

          return (
            <div key={reference.sourcePath} className={styles.assetRow}>
              <div className={styles.assetRowHeader}>
                <div>
                  <strong>{reference.sourcePath}</strong>
                  <p className={styles.helperText}>
                    {reference.syntax === 'obsidian' ? t('obsidianEmbed') : t('markdownImage')}
                  </p>
                </div>
                {uploadedAsset ? (
                  <AdminBadge>{t('uploaded')}</AdminBadge>
                ) : (
                  <AdminBadge variant="warning">{t('needsUpload')}</AdminBadge>
                )}
              </div>

              {uploadedAsset ? (
                <div className={styles.assetMetaRow}>
                  <span>{uploadedAsset.originalFilename}</span>
                  {byteLabel ? <span>{byteLabel}</span> : null}
                  {uploadedAsset.publicUrl ? (
                    <a
                      className={styles.textLink}
                      href={uploadedAsset.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FiCheck size={14} />
                      {t('openFile')}
                    </a>
                  ) : (
                    <span>{t('noPublicUrl')}</span>
                  )}
                </div>
              ) : null}

              <div className={styles.assetActions}>
                <input
                  ref={(element) => {
                    fileInputRefs.current[reference.sourcePath] = element;
                  }}
                  className={styles.fileInputHidden}
                  type="file"
                  accept="image/*"
                  disabled={Boolean(uploadState?.isUploading)}
                  onChange={(event) => handleFileChange(reference.sourcePath, event)}
                />
                <p className={styles.fileInputLabel}>
                  {
                    uploadState?.isUploading
                      ? t('uploadingSelection')
                      : uploadedAsset
                        ? t('pickReplacement')
                        : t('selectToUpload')
                  }
                </p>
                <AdminButton
                  type="button"
                  tone={uploadedAsset ? 'secondary' : 'primary'}
                  onClick={() => fileInputRefs.current[reference.sourcePath]?.click()}
                  disabled={Boolean(uploadState?.isUploading)}
                >
                  <FiUploadCloud size={15} />
                  {uploadState?.isUploading
                    ? t('uploading')
                      : uploadedAsset
                      ? t('replace')
                      : t('choose')}
                </AdminButton>
              </div>

              {uploadState?.error ? (
                <p className={styles.assetError}>{uploadState.error}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
