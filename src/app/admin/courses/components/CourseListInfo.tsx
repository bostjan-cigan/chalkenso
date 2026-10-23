'use client';

import { CSSProperties, ReactNode } from 'react';

/** Inline styles so typography always wins (avoids RSC/client CSS-module hash mismatches on class names). */
const COURSE_LIST_INFO_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.28rem',
  fontSize: '0.75rem',
  lineHeight: 1.35,
  fontWeight: 400,
  letterSpacing: '0.01em',
  color: 'rgba(var(--foreground-rgb), 0.52)',
};

interface CourseListInfoProps {
  children: ReactNode;
  /** Extra layout (e.g. margin) merged on top of base info styles. */
  style?: CSSProperties;
}

export default function CourseListInfo({ children, style }: CourseListInfoProps) {
  return <span style={{ ...COURSE_LIST_INFO_STYLE, ...style }}>{children}</span>;
}
