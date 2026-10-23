'use client';

import Link from 'next/link';
import {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
} from 'react';
import { cn } from '@/utils/cn';
import styles from '../../admin.module.css';

/**
 * One rule for buttons outside Settings (admin.module.css has it in full): `primary` is the main
 * action of a card, form or dialog; `secondary` the others beside it; `plain` (tinted) an action in a
 * list's row; `dangerText` a destructive action (red words, asks first in the caller's dialog); `danger`
 * (filled red) only confirms one, in that dialog.
 */
type Tone = 'primary' | 'secondary' | 'plain' | 'danger' | 'dangerText';

interface BaseProps {
  children: ReactNode;
  tone?: Tone;
  /** In cards and rows (34px); the default (40px) is for page headers and dialogs. */
  size?: 'default' | 'compact';
  className?: string;
  fullWidth?: boolean;
}

type LinkButtonProps = BaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'> & {
    href: string;
  };

type NativeButtonProps = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & {
    href?: never;
  };

type AdminButtonProps = LinkButtonProps | NativeButtonProps;

/**
 * The compact size, the same as the lesson editor's buttons. Inline so it always wins over CSS
 * module rules; on touch screens still 44px tall (`--touch-target`, Apple's minimum).
 */
const COMPACT_STYLE: CSSProperties = {
  gap: '0.375rem',
  minHeight: 'max(34px, var(--touch-target, 0px))',
  padding: '0 0.75rem',
  fontSize: '0.84rem',
  fontWeight: 600,
  lineHeight: 1,
};

export default function AdminButton(props: AdminButtonProps) {
  const tone = props.tone ?? 'primary';
  const size = props.size ?? 'default';
  const toneClass =
    tone === 'secondary'
      ? styles.buttonSecondary
      : tone === 'plain'
        ? styles.buttonPlain
        : tone === 'danger'
          ? styles.buttonDanger
          : tone === 'dangerText'
            ? styles.buttonDangerText
            : styles.buttonPrimary;
  const className = cn(
    styles.button,
    toneClass,
    props.fullWidth && styles.buttonFullWidth,
    props.className
  );

  // Red words keep their own tight padding at either size.
  const mergedStyle =
    size === 'compact'
      ? { ...COMPACT_STYLE, ...(tone === 'dangerText' ? { padding: 0 } : null), ...props.style }
      : props.style;

  if ('href' in props) {
    const {
      href,
      children,
      tone: _tone,
      size: _size,
      fullWidth: _fullWidth,
      className: _className,
      style: _style,
      ...rest
    } = props as LinkButtonProps;

    // A file to download: a plain link (Next's would prefetch it and try to navigate).
    if (rest.download !== undefined) {
      return (
        <a href={href} className={className} style={mergedStyle} data-button="" {...rest}>
          {children}
        </a>
      );
    }

    return (
      // `data-button`: link styles in tables and prose leave buttons alone.
      <Link href={href} className={className} style={mergedStyle} data-button="" {...rest}>
        {children}
      </Link>
    );
  }

  const {
    children,
    tone: _tone,
    size: _size,
    fullWidth: _fullWidth,
    className: _className,
    style: _style,
    ...rest
  } = props;

  return (
    <button className={className} style={mergedStyle} {...rest}>
      {children}
    </button>
  );
}
