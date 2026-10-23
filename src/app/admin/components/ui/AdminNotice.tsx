'use client';

import { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

type NoticeVariant = 'card' | 'banner';

interface AdminNoticeProps {
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
  variant?: NoticeVariant;
  className?: string;
}

export default function AdminNotice({
  icon,
  title,
  children,
  variant = 'banner',
  className,
}: AdminNoticeProps) {
  return (
    <div
      className={cn(
        variant === 'card' ? styles.noticeCard : styles.noticeBanner,
        className
      )}
    >
      {icon ? <div className={styles.noticeIcon}>{icon}</div> : null}
      <div className={styles.noticeBody}>
        {title ? <h3 className={styles.noticeTitle}>{title}</h3> : null}
        <p className={styles.noticeText}>{children}</p>
      </div>
    </div>
  );
}
