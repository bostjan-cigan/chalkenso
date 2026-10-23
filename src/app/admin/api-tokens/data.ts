import 'server-only';

import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type ApiTokenListItem = {
  id: string;
  name: string;
  tokenPrefix: string;
  ownerId: string;
  ownerName: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/**
 * Tokens the viewer may manage — super admins see everyone's, other users only their own — newest
 * first.
 */
export async function listApiTokens(viewer: {
  id: string;
  role: UserRole;
}): Promise<ApiTokenListItem[]> {
  const tokens = await prisma.apiToken.findMany({
    // Obsidian sync tokens only; tokens with other scopes are an edition's own.
    where: {
      scopes: { has: 'sync' },
      ...(viewer.role === UserRole.SUPERADMIN ? {} : { ownerId: viewer.id }),
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      ownerId: true,
      owner: {
        select: {
          identifier: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return tokens.map(({ owner, ...token }) => ({
    ...token,
    ownerName: [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.identifier,
  }));
}
