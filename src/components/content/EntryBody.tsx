'use client';

import { useEffect, useRef } from 'react';
import { enhanceLessonCodeCopy } from '@/app/l/components/lesson-code-copy';
import { trackImageLoading } from '@/lib/image-skeleton';
import markdownStyles from '@/styles/markdown-content.module.css';
import '@/app/l/access-lesson-copy.css';
import styles from './content.module.css';

/**
 * Pre-rendered entry HTML (from sync) with the lesson copy-to-clipboard buttons on code blocks and
 * image skeletons while images load.
 */
export default function EntryBody({ html }: { html: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }
    const disposeCopy = enhanceLessonCodeCopy(rootRef.current);
    const disposeImages = trackImageLoading(rootRef.current);
    return () => {
      disposeCopy();
      disposeImages();
    };
  }, [html]);

  return (
    <div
      ref={rootRef}
      className={`${markdownStyles.markdownContent} ${styles.body}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
