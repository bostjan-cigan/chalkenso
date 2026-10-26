'use client';

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminField from '@/app/admin/components/ui/AdminField';
import ConfirmDialog from '@/app/admin/courses/components/ConfirmDialog';

export type ImageWords = { alt: string; caption: string };

/** The pictures among what was dropped or pasted. */
export function imageFiles(data: DataTransfer | null) {
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

/**
 * Asks for a picture's words (read out to people who can't see it, and by search engines) and its
 * caption, right after it's uploaded: `ask(src)` opens the dialog and resolves with what was typed,
 * or with empty words when it's skipped. Render `dialog` once, where the editor is.
 */
export function useImageWords() {
  const t = useTranslations('editor.document');
  const [asking, setAsking] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const answer = useRef<((words: ImageWords) => void) | null>(null);

  const ask = (src: string) => {
    setAlt('');
    setCaption('');
    setAsking(src);
    return new Promise<ImageWords>((resolve) => {
      answer.current = resolve;
    });
  };
  const close = (words: ImageWords) => {
    answer.current?.({ alt: words.alt.trim(), caption: words.caption.trim() });
    answer.current = null;
    setAsking(null);
  };

  const dialog = (
    <ConfirmDialog
      open={asking !== null}
      title={t('imageWordsTitle')}
      description={t('imageWordsText')}
      confirmLabel={t('imageAdd')}
      cancelLabel={t('imageSkip')}
      onConfirm={() => close({ alt, caption })}
      onClose={() => close({ alt: '', caption: '' })}
    >
      {asking ? <img src={asking} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 180, margin: '0 auto 0.9rem', borderRadius: 8 }} /> : null}
      <AdminField
        id="image-alt"
        label={t('imageAlt')}
        hint={t('imageAltHint')}
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') close({ alt, caption });
        }}
        data-autofocus=""
        data-testid="image-alt"
        fullWidth
      />
      <AdminField
        id="image-caption"
        label={t('imageCaption')}
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') close({ alt, caption });
        }}
        data-testid="image-caption"
        fullWidth
      />
    </ConfirmDialog>
  );

  return { ask, dialog };
}

/** A picture as Markdown, its words and caption written so they can't end the syntax early. */
export function pictureMarkdown(src: string, words: ImageWords) {
  const alt = words.alt.replace(/[[\]\\]/g, '\\$&');
  const caption = words.caption ? ` "${words.caption.replace(/["\\]/g, '\\$&')}"` : '';
  return `![${alt}](${src}${caption})`;
}
