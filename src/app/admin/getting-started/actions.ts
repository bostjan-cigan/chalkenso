'use server';

import { requireMember } from '@/lib/admin-auth';
import { remember } from '@/lib/remembered';
import { hiddenKey, openedKey, TICKABLE, tickKey, type TickableStep } from './data';

/**
 * Getting started's choices, each the signed-in member's own (in their organisation). A platform
 * admin logged in as them changes none of them.
 */

/** Ticks a step by hand (`done`), or takes the tick back. */
export async function tickGettingStartedAction(id: TickableStep, done: boolean) {
  const viewer = await requireMember();
  if (viewer.impersonator || !TICKABLE.includes(id)) return;
  await remember(viewer.organization.id, tickKey(id, viewer.id), Boolean(done));
}

/** Hides Getting started (`hidden`), or brings it back (from Home). */
export async function hideGettingStartedAction(hidden: boolean) {
  const viewer = await requireMember();
  if (viewer.impersonator) return;
  await remember(viewer.organization.id, hiddenKey(viewer.id), Boolean(hidden));
}

/** They've opened it once: the note pointing at it goes. */
export async function openedGettingStartedAction() {
  const viewer = await requireMember();
  if (viewer.impersonator) return;
  await remember(viewer.organization.id, openedKey(viewer.id), true);
}
