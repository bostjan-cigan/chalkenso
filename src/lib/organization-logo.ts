import 'server-only';

import { createHash } from 'node:crypto';

/**
 * URL of an organisation's logo (members of that organisation only), cache-busted by the object key
 * so a replaced logo shows at once. Null when it has none.
 */
export function getOrganizationLogoUrl(organizationId: string, logoKey: string | null | undefined) {
  if (!logoKey) {
    return null;
  }
  const version = createHash('sha1').update(logoKey).digest('hex').slice(0, 12);
  return `/admin/api/org-logo/${organizationId}?v=${version}`;
}
