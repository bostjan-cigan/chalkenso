/** Serializable preview link row for the admin "Share preview" panel. */
export type PreviewLinkView = {
  claimedAt: string | null;
  createdAt: string;
  expiresAt: string;
  id: string;
  label: string | null;
  lastAccessedAt: string | null;
  oneTime: boolean;
  revokedAt: string | null;
  token: string;
};

export type PreviewLinkStatus = 'active' | 'opened' | 'expired' | 'revoked';

type PreviewLinkRecord = {
  claimedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  label: string | null;
  lastAccessedAt: Date | null;
  oneTime: boolean;
  revokedAt: Date | null;
  token: string;
};

export function toPreviewLinkView(link: PreviewLinkRecord): PreviewLinkView {
  return {
    claimedAt: link.claimedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    id: link.id,
    label: link.label,
    lastAccessedAt: link.lastAccessedAt?.toISOString() ?? null,
    oneTime: link.oneTime,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    token: link.token,
  };
}

/** `opened` = a one-time link already claimed by a browser (still works there until expiry). */
export function getPreviewLinkStatus(link: PreviewLinkView, now = new Date()): PreviewLinkStatus {
  if (link.revokedAt) {
    return 'revoked';
  }

  if (new Date(link.expiresAt) <= now) {
    return 'expired';
  }

  return link.oneTime && link.claimedAt ? 'opened' : 'active';
}
