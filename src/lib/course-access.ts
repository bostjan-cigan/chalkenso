import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { instructorAccess } from './instructor-links';
import { withOrgScope } from './org-context';
import { prisma } from './prisma';

const ACCESS_TOUCH_THROTTLE_MS = 1000 * 60 * 5;

/** Per-link cookie that proves this browser claimed a one-time preview link. */
function previewClaimCookieName(accessLinkId: string) {
  return `course_preview_${accessLinkId}`;
}

function hashClaimSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

async function hasPreviewClaimCookie(accessLinkId: string, claimSecretHash: string | null) {
  if (!claimSecretHash) {
    return false;
  }

  const cookieStore = await cookies();
  const secret = cookieStore.get(previewClaimCookieName(accessLinkId))?.value;

  if (!secret) {
    return false;
  }

  const candidate = Buffer.from(hashClaimSecret(secret), 'hex');
  const expected = Buffer.from(claimSecretHash, 'hex');

  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * Claims an unopened one-time preview link for the current browser: marks it claimed and sets the
 * cookie that keeps it working here (reloads + lazy lesson loads). Must run in a server action or
 * route handler (sets a cookie). Returns false if it was already claimed, expired or revoked.
 */
export async function claimOneTimePreviewLink(token: string): Promise<boolean> {
  const secret = randomBytes(32).toString('hex');
  const now = new Date();

  const link = await prisma.accessLink.findUnique({
    where: { token },
    select: { expiresAt: true, id: true },
  });

  if (!link) {
    return false;
  }

  /** Single conditional update, so two simultaneous opens can't both claim it. */
  const claimed = await prisma.accessLink.updateMany({
    where: {
      claimedAt: null,
      expiresAt: { gt: now },
      id: link.id,
      isPreview: true,
      oneTime: true,
      revokedAt: null,
    },
    data: {
      claimSecretHash: hashClaimSecret(secret),
      claimedAt: now,
    },
  });

  if (claimed.count !== 1) {
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set(previewClaimCookieName(link.id), secret, {
    expires: link.expiresAt,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return true;
}

export type AccessValidationResult =
  | {
      state: 'valid';
      accessLinkId: string;
      courseId: string;
      /** The course's organisation: the learner's requests read its data (`withLearnerAccess`). */
      organizationId: string;
      /** Version this token serves (link-stamped, else the group's assigned version). */
      curriculumVersionId: string | null;
      endsAt: Date | null;
      expiresAt: Date;
      /** Null for draft preview links (no group). */
      groupId: string | null;
      /** Admin-minted draft preview link (read-only, any version status). */
      isPreview: boolean;
      /** Proposing member for individual (member-bound) links; null for group links. */
      memberId: string | null;
      /** Member's full name; null for group links. Used to attribute curriculum comments. */
      memberName: string | null;
      /**
       * Set for an instructor link: whose it is. Their marks are instructor notes; the link is never a
       * learner (no answers, surveys or reading statistics).
       */
      instructor: { userId: string; name: string } | null;
      slackHandle: string | null;
      startsAt: Date | null;
    }
  | {
      courseId: string;
      organizationId: string;
      endsAt: Date | null;
      groupId: string | null;
      slackHandle: string | null;
      /**
       * Expired token, revoked link, or a one-time preview already opened in another browser —
       * same shape for public page shell.
       */
      state: 'expired' | 'revoked' | 'used';
      startsAt: Date | null;
    }
  | {
      /** One-time preview link nobody has opened yet; the page shows an explicit "Open" gate. */
      courseId: string;
      organizationId: string;
      state: 'unclaimed';
    }
  | {
      /**
       * The organisation's learner pages have closed (the edition decides when), whatever the link:
       * the page says the course is no longer available.
       */
      courseId: string;
      organizationId: string;
      state: 'closed';
    }
  | {
      state: 'invalid';
    };

/** One access link with everything a check needs: its group (its own, or its member's) and course. */
type AccessLinkRow = {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
  isPreview: boolean;
  oneTime: boolean;
  claimedAt: Date | null;
  claimSecretHash: string | null;
  linkVersionId: string | null;
  linkGroupId: string | null;
  memberId: string | null;
  memberName: string | null;
  groupId: string | null;
  groupCourseId: string | null;
  groupVersionId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  slackHandle: string | null;
  versionCourseId: string | null;
  organizationId: string | null;
  instructorId: string | null;
  instructorRole: UserRole | null;
  instructorActive: boolean | null;
  instructorFirstName: string | null;
  instructorLastName: string | null;
  instructorIdentifier: string | null;
};

/**
 * One statement, joins and all: this runs on every learner request, and each nested Prisma include
 * would be another round trip. A raw query is also outside the organisation scoping in prisma.ts,
 * like the token lookup has to be (the token says which organisation it is in), so it costs no
 * session read for a team member who opens a learner link.
 */
async function findAccessLink(token: string): Promise<AccessLinkRow | null> {
  const rows = await prisma.$queryRaw<AccessLinkRow[]>`
    SELECT
      l.id,
      l.expires_at AS "expiresAt",
      l.revoked_at AS "revokedAt",
      l.is_preview AS "isPreview",
      l.one_time AS "oneTime",
      l.claimed_at AS "claimedAt",
      l.claim_secret_hash AS "claimSecretHash",
      l.curriculum_version_id AS "linkVersionId",
      l.group_id AS "linkGroupId",
      m.id AS "memberId",
      m.full_name AS "memberName",
      g.id AS "groupId",
      g.course_id AS "groupCourseId",
      g.curriculum_version_id AS "groupVersionId",
      g.starts_at AS "startsAt",
      g.ends_at AS "endsAt",
      g.slack_handle AS "slackHandle",
      v.course_id AS "versionCourseId",
      c.organization_id AS "organizationId",
      u.id AS "instructorId",
      u.role::text AS "instructorRole",
      u.is_active AS "instructorActive",
      u.first_name AS "instructorFirstName",
      u.last_name AS "instructorLastName",
      u.identifier AS "instructorIdentifier"
    FROM courses.access_links l
    LEFT JOIN courses.course_group_members m ON m.id = l.member_id
    LEFT JOIN courses.course_groups g ON g.id = COALESCE(l.group_id, m.group_id)
    LEFT JOIN courses.curriculum_versions v ON v.id = l.curriculum_version_id
    LEFT JOIN courses.courses c ON c.id = CASE WHEN l.is_preview THEN v.course_id ELSE g.course_id END
    LEFT JOIN public.users u ON u.id = l.instructor_user_id
    WHERE l.token = ${token}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Checks of learner tokens made inside `sharingAccessChecks`, by token: one request checks its link
 * once, however many helpers ask. Lives exactly as long as that request's work (never across
 * requests, so a revoked link stops working on the next request). One store for the process, like
 * the organisation scope in org-context.ts: Next loads this module more than once.
 */
const globalForAccess = globalThis as typeof globalThis & {
  learnerAccessChecks?: AsyncLocalStorage<Map<string, Promise<AccessValidationResult>>>;
};
const accessChecks = (globalForAccess.learnerAccessChecks ??= new AsyncLocalStorage());

/** Runs `fn` with every check of a learner token inside it shared (see `accessChecks`). */
export function sharingAccessChecks<T>(fn: () => Promise<T>): Promise<T> {
  return accessChecks.getStore() ? fn() : accessChecks.run(new Map(), fn);
}

/**
 * A learner request's work for `token`: the link is checked once for everything `fn` does (the
 * helpers that check it again reuse this check). When the request carries a session or an API token
 * (a team member opening a learner link), the database is scoped to the link's organisation rather
 * than theirs, which would find nothing or the wrong rows. A learner's own requests carry neither and
 * stay unscoped, as before: scoping them would add the ownership checks prisma.ts runs on every
 * scoped write (two queries per referenced id) to every answer and reading statistic. An unknown
 * token runs `fn` as it is: the helpers it calls refuse it themselves.
 */
export function withLearnerAccess<T>(token: unknown, fn: (access: AccessValidationResult) => Promise<T>): Promise<T> {
  return sharingAccessChecks(async () => {
    const access: AccessValidationResult =
      typeof token === 'string' && token ? await validateCourseAccessToken(token) : { state: 'invalid' };
    if (access.state === 'invalid' || !(await carriesOtherScope())) {
      return fn(access);
    }
    return withOrgScope(access.organizationId, () => fn(access));
  });
}

/** Whether prisma.ts would scope this request by something of its own: a session cookie or a bearer token. */
async function carriesOtherScope() {
  try {
    // Lazily, like instructor-links.ts: admin-auth leads back here through the edition's extensions.
    const [{ SESSION_COOKIE_NAMES }, cookieStore, headerList] = await Promise.all([
      import('./admin-auth'),
      cookies(),
      headers(),
    ]);
    return SESSION_COOKIE_NAMES.some((name) => cookieStore.has(name)) || headerList.has('authorization');
  } catch {
    // Outside a request: nothing else scopes it.
    return false;
  }
}

export const validateCourseAccessToken = cache(async function validateCourseAccessToken(
  token: string
): Promise<AccessValidationResult> {
  const checks = accessChecks.getStore();
  if (!checks) {
    return checkCourseAccessToken(token);
  }
  let check = checks.get(token);
  if (!check) {
    check = checkCourseAccessToken(token);
    checks.set(token, check);
    // A failed lookup isn't an answer: the next caller tries again.
    check.catch(() => checks.delete(token));
  }
  return check;
});

async function checkCourseAccessToken(token: string): Promise<AccessValidationResult> {
  const accessLink = await findAccessLink(token);

  if (!accessLink || !accessLink.organizationId) {
    return {
      state: 'invalid',
    };
  }

  const organizationId = accessLink.organizationId;
  // Whether the organisation's learner pages have closed, alongside the link's own checks.
  const [closed, access] = await Promise.all([
    learnerPagesClosed(organizationId),
    accessLink.isPreview ? resolvePreviewAccess(accessLink, organizationId) : resolveLinkAccess(accessLink, organizationId),
  ]);
  return closed && access.state !== 'invalid' ? { courseId: access.courseId, organizationId, state: 'closed' } : access;
}

/** The edition's answer; loaded lazily, like admin-auth below. */
async function learnerPagesClosed(organizationId: string) {
  const { serverExtensions } = await import('@/extensions/server');
  return serverExtensions.learnerPagesClosed(organizationId);
}

/** A learner or instructor link (one with a group, its own or its member's). */
async function resolveLinkAccess(accessLink: AccessLinkRow, organizationId: string): Promise<AccessValidationResult> {
  // The link's group (its own, or its member's), as joined in `findAccessLink`.
  const courseId = accessLink.groupCourseId;
  const groupId = accessLink.groupId;
  const slackHandle = accessLink.slackHandle;
  const startsAt = accessLink.startsAt;
  const endsAt = accessLink.endsAt;
  /** Prefer the version captured on the link; fall back to the group's current one. */
  const curriculumVersionId = accessLink.linkVersionId ?? accessLink.groupVersionId;

  if (!courseId || !groupId) {
    return {
      state: 'invalid',
    };
  }

  const now = new Date();

  if (accessLink.revokedAt) {
    return {
      courseId,
      organizationId,
      endsAt,
      groupId,
      slackHandle,
      startsAt,
      state: 'revoked',
    };
  }

  if (accessLink.expiresAt <= now) {
    return {
      courseId,
      organizationId,
      endsAt,
      groupId,
      slackHandle,
      startsAt,
      state: 'expired',
    };
  }

  // An instructor link (a group link with its person) works only while they may still add notes for the group.
  const instructorUser =
    accessLink.instructorId && accessLink.linkGroupId
      ? {
          id: accessLink.instructorId,
          role: accessLink.instructorRole ?? UserRole.USER,
          isActive: accessLink.instructorActive === true,
          firstName: accessLink.instructorFirstName,
          lastName: accessLink.instructorLastName,
          identifier: accessLink.instructorIdentifier ?? '',
        }
      : null;
  const instructor = instructorUser
    ? await instructorAccess(instructorUser, { id: groupId, courseId, organizationId })
    : null;
  if (instructorUser && !instructor) {
    return {
      courseId,
      organizationId,
      endsAt,
      groupId,
      slackHandle,
      startsAt,
      state: 'revoked',
    };
  }

  return {
    accessLinkId: accessLink.id,
    courseId,
    organizationId,
    curriculumVersionId,
    endsAt,
    expiresAt: accessLink.expiresAt,
    groupId,
    isPreview: false,
    memberId: accessLink.memberId,
    memberName: accessLink.memberName,
    instructor,
    slackHandle,
    startsAt,
    state: 'valid',
  };
}

/** Preview links carry no group: the course comes from the stamped version (gone → invalid). */
async function resolvePreviewAccess(accessLink: AccessLinkRow, organizationId: string): Promise<AccessValidationResult> {
  const courseId = accessLink.versionCourseId;

  if (!courseId || !accessLink.linkVersionId) {
    return {
      state: 'invalid',
    };
  }

  const restricted = {
    courseId,
    organizationId,
    endsAt: null,
    groupId: null,
    slackHandle: null,
    startsAt: null,
  };

  if (accessLink.revokedAt) {
    return { ...restricted, state: 'revoked' };
  }

  if (accessLink.expiresAt <= new Date()) {
    return { ...restricted, state: 'expired' };
  }

  if (accessLink.oneTime) {
    if (!accessLink.claimedAt) {
      return { courseId, organizationId, state: 'unclaimed' };
    }

    if (!(await hasPreviewClaimCookie(accessLink.id, accessLink.claimSecretHash))) {
      return { ...restricted, state: 'used' };
    }
  }

  return {
    accessLinkId: accessLink.id,
    courseId,
    organizationId,
    curriculumVersionId: accessLink.linkVersionId,
    endsAt: null,
    expiresAt: accessLink.expiresAt,
    groupId: null,
    isPreview: true,
    memberId: null,
    memberName: null,
    instructor: null,
    slackHandle: null,
    startsAt: null,
    state: 'valid',
  };
}

export async function touchCourseAccessLink(accessLinkId: string) {
  const lastTouchedBefore = new Date(Date.now() - ACCESS_TOUCH_THROTTLE_MS);

  await prisma.accessLink.updateMany({
    where: {
      id: accessLinkId,
      OR: [
        {
          lastAccessedAt: null,
        },
        {
          lastAccessedAt: {
            lt: lastTouchedBefore,
          },
        },
      ],
    },
    data: {
      lastAccessedAt: new Date(),
    },
  });
}
