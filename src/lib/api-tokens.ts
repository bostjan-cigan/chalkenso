import 'server-only';

import { UserRole } from '@prisma/client';
import { withOrgScope, withoutOrgScope } from './org-context';
import { after } from 'next/server';
import { prisma } from './prisma';
import { membershipGrants, type Principal } from './permissions';
import {
  createApiTokenValue,
  getApiTokenDisplayPrefix,
  hashApiToken,
} from './security';

/** Sync tokens (`usr_…`) act as their owner in the Obsidian plugin; site keys (`site_…`) serve a website. */
const API_TOKEN_PREFIX = 'usr';
const SITE_KEY_PREFIX = 'site';

/** What a token may do. */
export const API_SCOPES = {
  /** Obsidian sync: read and write curricula as the token's owner. */
  sync: 'sync',
  /** A website: read published courses and lessons, and read lessons through learner links. */
  contentRead: 'content:read',
  /** A website: send learner feedback, and keep learners' private notes, through learner links. */
  feedbackWrite: 'feedback:write',
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

/** The scopes a website key gets. */
export const SITE_KEY_SCOPES: ApiScope[] = [API_SCOPES.contentRead, API_SCOPES.feedbackWrite];

/** How stale `lastUsedAt` may get before a request writes it again. */
const API_TOKEN_TOUCH_THROTTLE_MS = 1000 * 60 * 5;

export type MintApiTokenInput = {
  name: string;
  ownerId: string;
  organizationId: string;
  /** Defaults to a sync token. */
  scopes?: ApiScope[];
};

export type MintedApiToken = {
  /** Raw token — returned once, never retrievable again. */
  token: string;
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
};

/**
 * Creates a token row and returns the raw value alongside it. The caller is responsible for
 * surfacing `token` to the owner immediately; only the hash and prefix are stored.
 */
export async function mintApiToken(input: MintApiTokenInput): Promise<MintedApiToken> {
  const scopes = input.scopes?.length ? input.scopes : [API_SCOPES.sync];
  const rawToken = createApiTokenValue(scopes.includes(API_SCOPES.sync) ? API_TOKEN_PREFIX : SITE_KEY_PREFIX);

  const record = await prisma.apiToken.create({
    data: {
      name: input.name,
      tokenHash: hashApiToken(rawToken),
      tokenPrefix: getApiTokenDisplayPrefix(rawToken),
      ownerId: input.ownerId,
      organizationId: input.organizationId,
      scopes,
    },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdAt: true,
    },
  });

  return { token: rawToken, ...record };
}

/** Owners manage their own tokens; super admins can manage everyone's. */
export function canManageApiToken(
  user: { id: string; role: UserRole },
  token: { ownerId: string }
): boolean {
  return user.role === UserRole.SUPERADMIN || token.ownerId === user.id;
}

/** Marks a token revoked (idempotent). Returns the number of rows that transitioned. */
export async function revokeApiToken(id: string): Promise<number> {
  const result = await prisma.apiToken.updateMany({
    where: {
      id,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return result.count;
}

/**
 * Permanently removes a token. Only revoked tokens can be deleted, so a live
 * credential always goes through an explicit revoke first. Returns the number of rows deleted.
 */
export async function deleteApiToken(id: string): Promise<number> {
  const result = await prisma.apiToken.deleteMany({
    where: {
      id,
      revokedAt: { not: null },
    },
  });

  return result.count;
}

/** An authenticated token: the token itself plus its owner as the acting principal. */
export type ApiTokenPrincipal = Principal & {
  tokenId: string;
  /** The organisation the token works in. */
  organizationId: string;
  scopes: string[];
  /** Last recorded use, so {@link touchApiToken} can skip a write it doesn't need. */
  tokenLastUsedAt: Date | null;
  /** Owner identity, loaded with the token so callers need no second read of the user row. */
  owner: {
    identifier: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
};

export type ApiTokenAuthentication =
  | { state: 'valid'; principal: ApiTokenPrincipal }
  | {
      /**
       * `invalid` — no matching token; `revoked` — token exists but is revoked; `owner_inactive` —
       * the owning user has been deactivated.
       */
      state: 'invalid' | 'revoked' | 'owner_inactive' | 'two_factor_required' | 'wrong_scope';
    };

/**
 * Looks up a raw bearer token and returns its owner's principal (role + current grants). The token
 * must carry `requiredScope`: a website key can't be used for Obsidian sync, and the other way round.
 */
export async function authenticateApiToken(
  rawToken: string,
  requiredScope: ApiScope = API_SCOPES.sync
): Promise<ApiTokenAuthentication> {
  const trimmed = rawToken.trim();

  if (!trimmed) {
    return { state: 'invalid' };
  }

  // The token itself says which organisation the request works in, so it is looked up unscoped.
  // Only what the checks below and the principal use: the owner's membership comes with their grants.
  const token = await withoutOrgScope(() => prisma.apiToken.findUnique({
    where: {
      tokenHash: hashApiToken(trimmed),
    },
    select: {
      id: true,
      ownerId: true,
      organizationId: true,
      scopes: true,
      revokedAt: true,
      lastUsedAt: true,
      owner: {
        select: {
          isActive: true,
          identifier: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  }));

  if (!token) {
    return { state: 'invalid' };
  }

  if (token.revokedAt) {
    return { state: 'revoked' };
  }

  if (!token.owner.isActive) {
    return { state: 'owner_inactive' };
  }

  // A token only works while its owner is still in the organisation it was made for: their own
  // membership row, read with their grants there (never the whole organisation's members).
  const membership = await membershipGrants(token.ownerId, token.organizationId);
  if (!membership.member) {
    return { state: 'owner_inactive' };
  }

  if (!token.scopes.includes(requiredScope)) {
    return { state: 'wrong_scope' };
  }

  return {
    state: 'valid',
    principal: {
      tokenId: token.id,
      organizationId: token.organizationId,
      scopes: token.scopes,
      tokenLastUsedAt: token.lastUsedAt,
      userId: token.ownerId,
      role: UserRole.USER,
      // The same grants as the owner's session in that organisation.
      grants: membership.grants,
      owner: {
        identifier: token.owner.identifier,
        email: token.owner.email,
        firstName: token.owner.firstName,
        lastName: token.owner.lastName,
      },
    },
  };
}

export type ApiTokenAuthFailure = { ok: false; status: number; error: string };

/** Maps a failed authentication to the JSON error the sync routes return. */
export function apiTokenAuthFailure(
  state: Exclude<ApiTokenAuthentication['state'], 'valid'>
): ApiTokenAuthFailure {
  switch (state) {
    case 'revoked':
      return { ok: false, status: 403, error: 'Token has been revoked.' };
    case 'owner_inactive':
      return { ok: false, status: 403, error: 'Token owner is no longer active.' };
    case 'wrong_scope':
      return { ok: false, status: 403, error: 'This key is not allowed to do that.' };
    case 'two_factor_required':
      return {
        ok: false,
        status: 403,
        error: 'Turn on two-factor authentication in your admin profile before using this token.',
      };
    default:
      return { ok: false, status: 401, error: 'Invalid token.' };
  }
}

export const API_TOKEN_FORBIDDEN: ApiTokenAuthFailure = {
  ok: false,
  status: 403,
  error: 'Token is not permitted for this action.',
};

/**
 * Records the moment a token was successfully used.
 *
 * Throttled and fire-and-forget: `lastUsedAt` is bookkeeping, not something a caller waits on, and
 * writing it on every request put an UPDATE in front of every sync response. The window matches
 * `ACCESS_TOUCH_THROTTLE_MS` in `course-access.ts`, which makes the same trade for access links.
 */
export function touchApiToken(principal: ApiTokenPrincipal): void {
  if (
    principal.tokenLastUsedAt &&
    Date.now() - principal.tokenLastUsedAt.getTime() < API_TOKEN_TOUCH_THROTTLE_MS
  ) {
    return;
  }

  after(async () => {
    // A token revoked and deleted mid-request shouldn't fail the response it already served. In the
    // token's organisation: the scoping in prisma.ts would otherwise look the token up again.
    await withOrgScope(principal.organizationId, () =>
      prisma.apiToken.update({ where: { id: principal.tokenId }, data: { lastUsedAt: new Date() } })
    ).catch(() => undefined);
  });
}

/** Reads the raw token from an `Authorization: Bearer <token>` header, if present. */
export function bearerTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization');

  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  return match ? match[1].trim() : null;
}
