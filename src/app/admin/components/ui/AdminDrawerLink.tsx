'use client';

import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import { noteDrawerIntentFromClick } from './admin-drawer-intent';

type AdminDrawerLinkProps = ComponentProps<typeof Link> & {
  /** The record this link opens — the same id the list puts in the URL. */
  drawerKey: string;
};

/**
 * A list card that opens an `AdminDrawerShell`. Navigation still does the real work; the click
 * only records which record was asked for, so the panel opens on a skeleton instead of sitting
 * dead while the server answers.
 */
export default function AdminDrawerLink({
  drawerKey,
  onClick,
  children,
  ...linkProps
}: AdminDrawerLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    noteDrawerIntentFromClick(event, drawerKey);
  };

  return (
    <Link {...linkProps} onClick={handleClick}>
      {children}
    </Link>
  );
}
