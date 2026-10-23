'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/admin-auth';
import { remember } from '@/lib/remembered';
import { howItWorksKey } from './data';

/** "Mark as done" on How Chalkenso works: Getting started ticks it for this person. */
export async function markHowItWorksDoneAction() {
  const viewer = await requireMember();
  await remember(viewer.organization.id, howItWorksKey(viewer.id), true);
  revalidatePath('/admin');
}
