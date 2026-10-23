'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FiUser } from 'react-icons/fi';
import AdminButton from '../../components/ui/AdminButton';
import ActionNotice from '../../components/ui/ActionNotice';
import { useActionNotice } from '../../components/ui/useActionNotice';
import { removeProfileImageAction, updateProfileImageAction } from '../actions';
import styles from '../../admin.module.css';

interface ProfileImageSectionProps {
  /** Current avatar URL, or null when the default icon is in use. */
  currentImageUrl: string | null;
}

export default function ProfileImageSection({ currentImageUrl }: ProfileImageSectionProps) {
  const t = useTranslations('account.profile.photo');
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const { notice, isPending, run } = useActionNotice();

  const shownImage = previewUrl ?? currentImageUrl;

  function resetChosenFile() {
    setPreviewUrl(null);
    setFileName(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => updateProfileImageAction(formData), { onSuccess: resetChosenFile });
  }

  function handleRemove() {
    run(() => removeProfileImageAction(), { onSuccess: resetChosenFile });
  }

  return (
    <div className={styles.profileImageStack}>
      <ActionNotice notice={notice} />

      <div className={styles.profileImageRow}>
        <div className={styles.profileImagePreview}>
          {shownImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownImage} alt={t('alt')} className={styles.profileImagePreviewImg} />
          ) : (
            <FiUser size={30} aria-hidden />
          )}
        </div>

        <div className={styles.profileImageControls}>
          <form onSubmit={handleUpload} className={styles.profileImageForm}>
            <input
              ref={inputRef}
              type="file"
              name="profileImage"
              accept="image/*"
              className={styles.visuallyHiddenFileInput}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setFileName(file?.name ?? null);
                setPreviewUrl(file ? URL.createObjectURL(file) : null);
              }}
            />
            <div className={styles.profileImageFormRow}>
              <AdminButton
                type="button"
                tone="secondary"
                size="compact"
                onClick={() => inputRef.current?.click()}
              >
                {t('choose')}
              </AdminButton>
              <span className={styles.profileImageHint}>
                {fileName ?? t('formats')}
              </span>
            </div>
            <AdminButton type="submit" disabled={!fileName || isPending}>
              {isPending ? t('uploading') : t('save')}
            </AdminButton>
          </form>

          {currentImageUrl ? (
            <AdminButton
              type="button"
              tone="secondary"
              onClick={handleRemove}
              disabled={isPending}
            >
              {isPending ? t('working') : t('remove')}
            </AdminButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
