'use client';

import { useEffect } from 'react';
import { LAST_GROUP_COOKIE } from '../last-group';

/** Remembers this group as the last one opened, for a month, in this browser only. */
export default function RememberGroup({ groupId }: { groupId: string }) {
  useEffect(() => {
    document.cookie = `${LAST_GROUP_COOKIE}=${encodeURIComponent(groupId)}; path=/admin; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  }, [groupId]);
  return null;
}
