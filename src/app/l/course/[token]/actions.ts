'use server';

import { redirect } from 'next/navigation';
import { claimOneTimePreviewLink } from '@/lib/course-access';

/**
 * Claims a one-time preview link for this browser, then reloads the page. An explicit POST (not a
 * GET) so link unfurlers and prefetchers can never burn the link. If someone else claimed it first,
 * the reload simply shows the "already used" state.
 */
export async function claimPreviewLinkAction(formData: FormData) {
  const token = String(formData.get('token') ?? '').trim();

  if (token) {
    await claimOneTimePreviewLink(token);
  }

  redirect(`/l/course/${encodeURIComponent(token)}`);
}
