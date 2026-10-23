import 'server-only';

import { serverExtensions } from '@/extensions/server';
import { getCurrentUserSession } from './admin-auth';

/**
 * The current organisation's learner link address (a URL with `{token}`), for the admin pages
 * that show or copy learner and preview links; null means this installation's own
 * `/l/course/<token>`. Pass it to `learnerLinkUrl` (`./access-links`).
 */
export async function currentLearnerLinkTemplate(): Promise<string | null> {
  const session = await getCurrentUserSession();
  const organizationId = session?.user.organization?.id;
  return organizationId ? serverExtensions.learnerLinkTemplate(organizationId) : null;
}
