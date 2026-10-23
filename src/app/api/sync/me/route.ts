import { NextResponse } from 'next/server';
import {
  apiTokenAuthFailure,
  authenticateApiToken,
  bearerTokenFromRequest,
  touchApiToken,
} from '@/lib/api-tokens';
import {
  GRANT_ENTITY_TYPES,
  grantedPermissions,
  listAccessibleCurriculumVersions,
  sortPermissions,
} from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who the calling token acts as and what they can reach: the user, the organisation the token works
 * in (one per token; a person in several has a token for each), their blog/project (`content`)
 * permissions, and every curriculum version ("workspace") they hold any permission on, with the
 * effective permissions. Sync clients use it to offer the versions a folder can sync with; each
 * curriculum request then names one via `X-Curriculum-Version-Id`.
 *
 * Auth: `Authorization: Bearer <token>`; any live token may call it.
 */
export async function GET(request: Request) {
  const rawToken = bearerTokenFromRequest(request);

  if (!rawToken) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const auth = await authenticateApiToken(rawToken);

  if (auth.state !== 'valid') {
    const failure = apiTokenAuthFailure(auth.state);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  const { principal } = auth;

  // The owner's identity rides along with the token lookup, so there is no second read of the
  // user row here.
  const { owner } = principal;
  const [versions, organization] = await Promise.all([
    listAccessibleCurriculumVersions(principal),
    prisma.organization.findUnique({ where: { id: principal.organizationId }, select: { id: true, name: true } }),
  ]);

  touchApiToken(principal);

  return NextResponse.json({
    user: {
      id: principal.userId,
      name: [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.identifier,
      email: owner.email,
      role: principal.role,
    },
    organization,
    content: {
      permissions: sortPermissions(
        grantedPermissions(principal, { type: GRANT_ENTITY_TYPES.CONTENT })
      ),
    },
    workspaces: versions,
  });
}
