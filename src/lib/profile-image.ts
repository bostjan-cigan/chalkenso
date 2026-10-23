import 'server-only';

import { createHash } from 'node:crypto';

/**
 * URL for the signed-in admin's profile image, cache-busted by the object key so a
 * replaced image loads immediately. Returns null when no image is set.
 */
export function getAdminProfileImageUrl(profileImageKey: string | null | undefined) {
  if (!profileImageKey) {
    return null;
  }

  const version = createHash('sha1').update(profileImageKey).digest('hex').slice(0, 12);
  return `/admin/api/profile-image?v=${version}`;
}

/**
 * URL for a specific user's profile image (admin-gated endpoint), cache-busted by the key.
 * Returns null when that user has no image. Used to show avatars for task authors/assignees.
 */
export function getUserProfileImageUrl(
  userId: string,
  profileImageKey: string | null | undefined
) {
  if (!profileImageKey) {
    return null;
  }

  const version = createHash('sha1').update(profileImageKey).digest('hex').slice(0, 12);
  return `/admin/api/user-image/${userId}?v=${version}`;
}
