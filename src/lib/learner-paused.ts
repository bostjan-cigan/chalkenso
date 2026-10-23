import 'server-only';

import { serverExtensions } from '@/extensions/server';
import type { AccessValidationResult } from './course-access';

/**
 * Learner links of a paused organisation (`serverExtensions.isPaused`; never in the local edition)
 * only read: no feedback, notes or answers until it resumes. The learner page says so and hides the
 * tools; the helpers that write refuse with this message (`learner.errors.paused`).
 */
export const LEARNER_PAUSED_ERROR = 'This course is taking a break: you can read it, but nothing can be sent for now.';

/** Whether this learner link's organisation is paused (only a valid link has one to ask about). */
export async function learnerLinkPaused(access: AccessValidationResult): Promise<boolean> {
  return access.state === 'valid' && (await serverExtensions.isPaused(access.organizationId));
}

/** The refusal a writing helper returns for a paused organisation's link, or null when it may write. */
export async function pausedRefusal(access: AccessValidationResult): Promise<{ ok: false; status: 403; error: string } | null> {
  return (await learnerLinkPaused(access)) ? { ok: false, status: 403, error: LEARNER_PAUSED_ERROR } : null;
}
