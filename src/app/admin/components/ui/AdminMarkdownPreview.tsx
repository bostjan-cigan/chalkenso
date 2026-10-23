'use client';

import { useTranslations } from 'next-intl';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

interface AdminMarkdownPreviewProps {
  className?: string;
  content: string;
  placeholder?: string;
}

export default function AdminMarkdownPreview({
  className,
  content,
  placeholder,
}: AdminMarkdownPreviewProps) {
  const t = useTranslations('app.ui');
  // Wrap tables so wide ones scroll inside a rounded card, matching the course view.
  const html = renderMarkdownToHtml(content)
    .replaceAll('<table>', `<div class="${styles.markdownTableScroll}"><table>`)
    .replaceAll('</table>', '</table></div>');

  if (!html) {
    return (
      <div className={cn(styles.markdownPreview, styles.markdownPreviewEmpty, className)}>
        <p>{placeholder ?? t('previewEmpty')}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(styles.markdownPreview, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
