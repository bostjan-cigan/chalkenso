'use server';

import { CurriculumVersionStatus, Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { parseDateTimeLocalValue } from '@/lib/access-links';
import { lockFor } from '@/lib/advisory-locks';
import { enableGroupCurriculum } from '@/lib/group-curricula';
import { requireSection } from '@/lib/admin-auth';
import { canOnCourse, isUnrestricted, requireCrmAccess, requireGroupAccess } from '@/lib/crm-access';
import { GRANT_ENTITY_TYPES } from '@/lib/grant-scopes';
import { parseGroupRoster } from '@/lib/group-roster';
import { applyRosterUpdate } from '@/lib/group-roster-apply';
import { deleteNotesForMembers } from '@/lib/lesson-notes';
import { prisma, type TransactionClient } from '@/lib/prisma';
import { createPublicAccessToken } from '@/lib/security';
import { ensureUniqueSlug } from '@/lib/slugs';
import { retryOnUniqueViolation } from '@/lib/unique-retry';
import { serverExtensions } from '@/extensions/server';
import { groupErrorKey, planErrorCode } from './messages';

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function parseOptionalGroupSchedule(formData: FormData):
  | { endsAt: Date | null; ok: true; startsAt: Date | null }
  | { code: 'invalid' | 'range'; ok: false } {
  const startsRaw = String(formData.get('startsAt') ?? '').trim();
  const endsRaw = String(formData.get('endsAt') ?? '').trim();
  const startsAt = startsRaw ? parseDateTimeLocalValue(startsRaw) : null;
  const endsAt = endsRaw ? parseDateTimeLocalValue(endsRaw) : null;

  if (startsRaw && !startsAt) {
    return { code: 'invalid', ok: false };
  }

  if (endsRaw && !endsAt) {
    return { code: 'invalid', ok: false };
  }

  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
    return { code: 'range', ok: false };
  }

  return { endsAt, ok: true, startsAt };
}

function getGroupDetailPath(groupId: string) {
  return `/admin/courses/groups/${groupId}`;
}

function revalidateGroupPaths(groupId?: string) {
  revalidatePath('/admin/courses/groups');

  if (groupId) {
    revalidatePath(getGroupDetailPath(groupId));
  }
}

/**
 * Resolves the core version to assign to a group: the requested one if it belongs to the course,
 * else the course's newest published version, else its newest version, else null. Group curricula
 * are never assigned this way (see `enableGroupCurriculum`).
 */
async function resolveGroupVersionId(
  courseId: string,
  requestedVersionId: string
): Promise<string | null> {
  if (requestedVersionId) {
    const version = await prisma.curriculumVersion.findFirst({
      where: { courseId, id: requestedVersionId, ownerGroupId: null },
      select: { id: true },
    });

    if (version) {
      return version.id;
    }
  }

  const publishedLatest = await prisma.curriculumVersion.findFirst({
    where: { courseId, ownerGroupId: null, status: CurriculumVersionStatus.PUBLISHED },
    orderBy: { version: 'desc' },
    select: { id: true },
  });

  if (publishedLatest) {
    return publishedLatest.id;
  }

  const latest = await prisma.curriculumVersion.findFirst({
    where: { courseId, ownerGroupId: null },
    orderBy: { version: 'desc' },
    select: { id: true },
  });

  return latest?.id ?? null;
}

type MintableVersion =
  | { ok: true; versionId: string }
  | { ok: false; reason: 'no-version' | 'draft' };

/** The group's assigned version, but only when it exists and is published (safe to serve). */
async function getMintableVersionForGroup(groupId: string): Promise<MintableVersion> {
  const group = await prisma.courseGroup.findUnique({
    where: { id: groupId },
    select: {
      curriculumVersion: {
        select: { id: true, status: true },
      },
    },
  });

  const version = group?.curriculumVersion;

  if (!version) {
    return { ok: false, reason: 'no-version' };
  }

  if (version.status !== CurriculumVersionStatus.PUBLISHED) {
    return { ok: false, reason: 'draft' };
  }

  return { ok: true, versionId: version.id };
}

async function ensureCourseExists(courseId: string) {
  if (!courseId) {
    return false;
  }

  const course = await prisma.course.findUnique({
    where: {
      id: courseId,
    },
    select: {
      id: true,
    },
  });

  return Boolean(course);
}

/**
 * The group's own partners, in order. `ids` is null when the form has no partner list
 * (`partnersField`), so saving such a form leaves the partners as they are.
 */
async function getValidPartnerIds(formData: FormData) {
  if (!formData.has('partnersField')) {
    return {
      hasInvalid: false,
      ids: null,
    };
  }

  const rawPartnerIds = formData
    .getAll('partnerId')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  if (rawPartnerIds.length === 0) {
    return {
      hasInvalid: false,
      ids: [] as string[],
    };
  }

  const uniquePartnerIds = Array.from(new Set(rawPartnerIds));
  const partners = await prisma.partner.findMany({
    where: {
      id: {
        in: uniquePartnerIds,
      },
    },
    select: {
      id: true,
    },
  });

  const validIds = new Set(partners.map((partner) => partner.id));
  const hasInvalid = uniquePartnerIds.some((id) => !validIds.has(id));

  return {
    hasInvalid,
    ids: uniquePartnerIds.filter((id) => validIds.has(id)),
  };
}

async function ensureUniqueGroupSlug(
  courseId: string,
  baseSlug: string,
  currentGroupId?: string
) {
  return ensureUniqueSlug(baseSlug, async (slug) => {
    const existingGroup = await prisma.courseGroup.findUnique({
      where: {
        courseId_slug: {
          courseId,
          slug,
        },
      },
      select: {
        id: true,
      },
    });

    return Boolean(existingGroup && existingGroup.id !== currentGroupId);
  });
}

function parseExpiryOrRedirect(formData: FormData, redirectPath: string) {
  const expiresAt = parseDateTimeLocalValue(getFormValue(formData, 'expiresAt'));

  if (!expiresAt || expiresAt <= new Date()) {
    redirect(`${redirectPath}?error=group-expiry`);
  }

  return expiresAt;
}

function parseExpiryFromFormData(formData: FormData) {
  const expiresAt = parseDateTimeLocalValue(getFormValue(formData, 'expiresAt'));

  if (!expiresAt || expiresAt <= new Date()) {
    return null;
  }

  return expiresAt;
}

type MintedLink = {
  expiresAt: Date;
  id: string;
  lastAccessedAt: Date | null;
  token: string;
};

type MintGroupLinkResult =
  | { ok: true; link: MintedLink }
  | { ok: false; reason: 'not-found' | 'no-version' | 'draft' };

async function createGroupAccessLinkRecord(
  groupId: string,
  expiresAt: Date
): Promise<MintGroupLinkResult> {
  const group = await prisma.courseGroup.findUnique({
    where: {
      id: groupId,
    },
    select: {
      id: true,
    },
  });

  if (!group) {
    return { ok: false, reason: 'not-found' };
  }

  const mintable = await getMintableVersionForGroup(groupId);

  if (!mintable.ok) {
    return { ok: false, reason: mintable.reason };
  }

  const link = await prisma.$transaction(async (transaction) => {
    // Revoke-then-create under the group's lock: two requests at once can't both leave a live link.
    await lockFor(transaction, 'group', groupId);
    const now = new Date();
    await transaction.accessLink.updateMany({
      where: {
        expiresAt: {
          gt: now,
        },
        groupId,
        // Instructors' links stay (src/lib/instructor-links.ts).
        instructorUserId: null,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    return transaction.accessLink.create({
      data: {
        curriculumVersionId: mintable.versionId,
        expiresAt,
        groupId,
        token: createPublicAccessToken(),
      },
      select: {
        expiresAt: true,
        id: true,
        lastAccessedAt: true,
        token: true,
      },
    });
  });

  revalidateGroupPaths(groupId);

  return { ok: true, link };
}

/**
 * New links for these members of one group, revoking their live ones: one statement for all the
 * revoking and one for all the new links, however many members. Under the group's lock, like every
 * link minted for the group, so two requests at the same moment can't leave a member with two live
 * links. Run it inside a transaction.
 */
async function mintMemberAccessLinks(
  transaction: TransactionClient,
  input: { groupId: string; memberIds: string[]; versionId: string; expiresAt: Date }
) {
  await lockFor(transaction, 'group', input.groupId);
  const now = new Date();
  await transaction.accessLink.updateMany({
    where: {
      expiresAt: {
        gt: now,
      },
      memberId: { in: input.memberIds },
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });
  const created = await transaction.accessLink.createManyAndReturn({
    data: input.memberIds.map((memberId) => ({
      curriculumVersionId: input.versionId,
      expiresAt: input.expiresAt,
      memberId,
      token: createPublicAccessToken(),
    })),
    select: { id: true, memberId: true },
  });
  await moveFeedbackToNewLinks(transaction, created);
}

/**
 * A learner's feedback goes with them to the link just made for them (their old ones revoked).
 * Learner pages already show a learner's feedback from any of their links; this keeps each comment's
 * link the one they use now. Instructor notes are never a learner's.
 */
async function moveFeedbackToNewLinks(transaction: TransactionClient, links: Array<{ id: string; memberId: string | null }>) {
  for (const link of links) {
    if (!link.memberId) continue;
    await transaction.curriculumComment.updateMany({
      where: { memberId: link.memberId, isInstructorNote: false },
      data: { accessLinkId: link.id },
    });
  }
}

type InlineGroupAccessLinkResult =
  | {
      ok: true;
      link: {
        expiresAt: string;
        id: string;
        lastAccessedAt: string | null;
        token: string;
      };
    }
  | {
      message: string;
      ok: false;
    };

/**
 * The plan's classes-at-a-time check (`serverExtensions.limits.classes`) inside the transaction that
 * saves the dates, under the organisation's lock: two classes saved at the same moment can't both
 * take the last place, because the second is checked only once the first has committed.
 */
async function classesFit(
  transaction: TransactionClient,
  organizationId: string | null | undefined,
  candidate: { groupId?: string; startsAt: Date | null; endsAt: Date | null }
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!organizationId) {
    return { ok: true };
  }
  await lockFor(transaction, 'organization', organizationId);
  const fits = await serverExtensions.limits.classes(organizationId, candidate);
  return fits.ok ? { ok: true } : { ok: false, code: fits.code };
}

/**
 * A new group from the new-group form: its course and lessons, its name and its learners. It starts
 * undated, without a description, partners or Slack: those are set on its Settings tab
 * (`saveGroupSettingsAction`).
 */
export async function createGroupAction(formData: FormData) {
  const courseId = getFormValue(formData, 'courseId');
  // The Groups section, or a member who can edit this whole course.
  const viewer = await requireCrmAccess((candidate) => canOnCourse(candidate, courseId, [Permission.WRITE]));
  const curriculumVersionIdInput = getFormValue(formData, 'curriculumVersionId');
  const name = getFormValue(formData, 'name');
  const slugInput = getFormValue(formData, 'slug');
  const sourceRosterText = String(formData.get('sourceRosterText') ?? '');
  const createPath = '/admin/courses/groups/new';
  const members = parseGroupRoster(sourceRosterText);

  if (!(await ensureCourseExists(courseId))) {
    redirect(`${createPath}?error=group-course`);
  }

  const curriculumVersionId = await resolveGroupVersionId(
    courseId,
    curriculumVersionIdInput
  );

  if (!name) {
    redirect(`${createPath}?error=group-name`);
  }

  if (members.length === 0) {
    redirect(`${createPath}?error=group-roster`);
  }

  // A slug taken a moment ago by another new group: the next free one.
  const group = await retryOnUniqueViolation(
    async () => {
      const slug = await ensureUniqueGroupSlug(courseId, slugInput || name);
      return prisma.$transaction(async (transaction) => {
        // Classes at a time, by the plan: an undated group must fit.
        const fits = await classesFit(transaction, viewer.organizationId, { startsAt: null, endsAt: null });
        if (!fits.ok) {
          return fits;
        }

        const createdGroup = await transaction.courseGroup.create({
          data: {
            courseId,
            curriculumVersionId,
            members: {
              create: members,
            },
            name,
            slug,
            sourceRosterText: sourceRosterText || null,
          },
          select: {
            id: true,
          },
        });

        return { ok: true as const, id: createdGroup.id };
      });
    },
    { fields: ['slug'] }
  );

  if (!group.ok) {
    redirect(`${createPath}?error=${planErrorCode(group.code)}`);
  }

  // Most groups adapt their lessons from their feedback: they start with their own copy, unless the
  // person left that off (a group that follows the course as it changes).
  if (formData.get('ownCopy') !== null && curriculumVersionId) {
    await enableGroupCurriculum(group.id);
  }

  revalidateGroupPaths(group.id);

  redirect(`${getGroupDetailPath(group.id)}?status=group-created`);
}

/** What saving part of a group's settings says (`useActionNotice`). */
export type GroupSettingsResult = { ok: boolean; message: string };

/**
 * Saves one part of a group's settings, from a sheet on its Settings tab: only the fields that
 * part's form has change (a form without `name` keeps the name, one without the roster keeps the
 * learners, one without the partner list keeps the partners, and so on). Editing a group, and
 * moving it to another course, needs edit rights on its course and on the course it moves to.
 */
export async function saveGroupSettingsAction(formData: FormData): Promise<GroupSettingsResult> {
  const groupId = getFormValue(formData, 'groupId');
  const current = groupId ? await prisma.courseGroup.findUnique({ where: { id: groupId }, select: { courseId: true } }) : null;
  const courseId = formData.has('courseId') ? getFormValue(formData, 'courseId') : (current?.courseId ?? '');
  const viewer = await requireCrmAccess(
    (candidate) =>
      Boolean(current) &&
      canOnCourse(candidate, current!.courseId, [Permission.WRITE]) &&
      canOnCourse(candidate, courseId, [Permission.WRITE])
  );
  const t = await getTranslations('groups.flash');
  const refused = (code: string): GroupSettingsResult => ({ ok: false, message: t(`error.${groupErrorKey(code)}`) });

  const existing = await prisma.courseGroup.findUnique({
    where: { id: groupId },
    select: {
      courseId: true,
      curriculumVersionId: true,
      endsAt: true,
      feedbackDriven: true,
      name: true,
      slug: true,
      sourceRosterText: true,
      startsAt: true,
    },
  });
  if (!existing) {
    return refused('group-not-found');
  }

  const name = formData.has('name') ? getFormValue(formData, 'name') : existing.name;
  if (!name) {
    return refused('group-name');
  }

  // Its course and the version it reads, set together. A group with its own copy keeps both.
  const movesCourse = courseId !== existing.courseId;
  if (movesCourse && !(await ensureCourseExists(courseId))) {
    return refused('group-course');
  }
  if (movesCourse && existing.feedbackDriven) {
    return refused('group-course-locked');
  }
  const setsLessons = formData.has('curriculumVersionId') && !existing.feedbackDriven;
  const curriculumVersionId = setsLessons
    ? await resolveGroupVersionId(courseId, getFormValue(formData, 'curriculumVersionId'))
    : existing.curriculumVersionId;
  const versionChanged = curriculumVersionId !== existing.curriculumVersionId;

  // A date the form doesn't have stays as it is, and the two still have to make a range.
  const schedule = parseOptionalGroupSchedule(formData);
  if (!schedule.ok) {
    return refused(schedule.code === 'invalid' ? 'group-schedule-invalid' : 'group-schedule-range');
  }
  const startsAt = formData.has('startsAt') ? schedule.startsAt : existing.startsAt;
  const endsAt = formData.has('endsAt') ? schedule.endsAt : existing.endsAt;
  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
    return refused('group-schedule-range');
  }
  // New dates must fit the plan's classes at a time (unchanged dates never block, even over the plan).
  const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  const datesChanged = !sameTime(startsAt, existing.startsAt) || !sameTime(endsAt, existing.endsAt);

  const sourceRosterText = formData.has('sourceRosterText') ? String(formData.get('sourceRosterText') ?? '') : null;
  const members = sourceRosterText === null ? [] : parseGroupRoster(sourceRosterText);
  if (sourceRosterText !== null && members.length === 0) {
    return refused('group-roster');
  }
  const rosterChanged = sourceRosterText !== null && sourceRosterText.trim() !== (existing.sourceRosterText ?? '').trim();

  // Partners are shared by every course: only unrestricted members change them.
  const partnerIds = isUnrestricted(viewer) ? await getValidPartnerIds(formData) : { ids: null, hasInvalid: false };
  if (partnerIds.hasInvalid) {
    return refused('group-partner');
  }

  const now = new Date();
  // A slug taken a moment ago by another group: the next free one. A group moving to another
  // course keeps its short name there too, unless that course has it already.
  const saved = await retryOnUniqueViolation(
    async () => {
      const slug = formData.has('slug')
        ? await ensureUniqueGroupSlug(courseId, getFormValue(formData, 'slug') || name, groupId)
        : movesCourse
          ? await ensureUniqueGroupSlug(courseId, existing.slug, groupId)
          : null;
      return prisma.$transaction(async (transaction) => {
        if (datesChanged) {
          const fits = await classesFit(transaction, viewer.organizationId, { groupId, startsAt, endsAt });
          if (!fits.ok) {
            return fits;
          }
        }

        if (versionChanged) {
          // Links are tied to a version; switching it invalidates every active link for this group.
          // Instructors' links carry no version (they follow the group), so they stay.
          await transaction.accessLink.updateMany({
            where: { expiresAt: { gt: now }, groupId, instructorUserId: null, revokedAt: null },
            data: { revokedAt: now },
          });
          await transaction.accessLink.updateMany({
            where: { expiresAt: { gt: now }, member: { groupId }, revokedAt: null },
            data: { revokedAt: now },
          });
        }

        if (rosterChanged) {
          await applyRosterUpdate(transaction, { groupId, desired: members, now });
        }

        await transaction.courseGroup.update({
          where: { id: groupId },
          data: {
            ...(movesCourse ? { courseId } : {}),
            ...(setsLessons ? { curriculumVersionId } : {}),
            ...(formData.has('name') ? { name } : {}),
            ...(slug ? { slug } : {}),
            ...(formData.has('description') ? { description: getFormValue(formData, 'description') || null } : {}),
            ...(formData.has('slackHandle') ? { slackHandle: getFormValue(formData, 'slackHandle') || null } : {}),
            ...(formData.has('startsAt') ? { startsAt } : {}),
            ...(formData.has('endsAt') ? { endsAt } : {}),
            ...(rosterChanged ? { sourceRosterText: sourceRosterText || null } : {}),
          },
        });
        if (formData.has('name')) {
          // The group's copy of the lessons is labelled with its name, wherever it shows.
          await transaction.curriculumVersion.updateMany({ where: { ownerGroupId: groupId }, data: { label: name } });
        }

        // Only a form with the partner list replaces the partners; the list's order is their order.
        if (partnerIds.ids) {
          await transaction.courseGroupPartner.deleteMany({ where: { groupId } });
          if (partnerIds.ids.length > 0) {
            await transaction.courseGroupPartner.createMany({
              data: partnerIds.ids.map((partnerId, index) => ({ groupId, partnerId, position: index })),
            });
          }
        }

        return { ok: true as const };
      });
    },
    { fields: ['slug'] }
  );

  if (!saved.ok) {
    return refused(planErrorCode(saved.code));
  }

  revalidateGroupPaths(groupId);
  return { ok: true, message: t('status.groupUpdated') };
}

export async function createGroupAccessLinkAction(formData: FormData) {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);

  if (!groupId) {
    redirect('/admin/courses/groups?error=group-not-found');
  }

  const detailPath = getGroupDetailPath(groupId);
  const expiresAt = parseExpiryOrRedirect(formData, detailPath);
  const result = await createGroupAccessLinkRecord(groupId, expiresAt);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      redirect('/admin/courses/groups?error=group-not-found');
    }

    redirect(
      `${detailPath}?error=${result.reason === 'draft' ? 'group-version-draft' : 'group-version'}`
    );
  }

  redirect(`${detailPath}?status=group-link-created`);
}

export async function createGroupAccessLinkInlineAction(
  formData: FormData
): Promise<InlineGroupAccessLinkResult> {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const t = await getTranslations('groups.actions');

  if (!groupId) {
    return {
      message: t('groupNotFound'),
      ok: false,
    };
  }

  const expiresAt = parseExpiryFromFormData(formData);

  if (!expiresAt) {
    return {
      message: t('expiry'),
      ok: false,
    };
  }

  const result = await createGroupAccessLinkRecord(groupId, expiresAt);

  if (!result.ok) {
    return {
      message:
        result.reason === 'draft'
          ? t('versionDraft')
          : result.reason === 'no-version'
            ? t('noVersion')
            : t('groupNotFound'),
      ok: false,
    };
  }

  const accessLink = result.link;

  return {
    link: {
      expiresAt: accessLink.expiresAt.toISOString(),
      id: accessLink.id,
      lastAccessedAt: accessLink.lastAccessedAt?.toISOString() ?? null,
      token: accessLink.token,
    },
    ok: true,
  };
}

export async function revokeGroupAccessLinkInlineAction(formData: FormData) {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const t = await getTranslations('groups.actions');
  const linkId = getFormValue(formData, 'linkId');

  if (!groupId || !linkId) {
    return {
      message: t('groupNotFound'),
      ok: false as const,
    };
  }

  const accessLink = await prisma.accessLink.findFirst({
    where: {
      groupId,
      id: linkId,
      instructorUserId: null,
    },
    select: {
      id: true,
    },
  });

  if (!accessLink) {
    return {
      message: t('groupNotFound'),
      ok: false as const,
    };
  }

  await prisma.accessLink.updateMany({
    where: {
      id: linkId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  revalidateGroupPaths(groupId);

  return {
    ok: true as const,
  };
}

type UpdateAccessLinkExpiryResult =
  | {
      link: {
        expiresAt: string;
        id: string;
        lastAccessedAt: string | null;
        token: string;
      };
      ok: true;
    }
  | {
      message: string;
      ok: false;
    };

/**
 * Updates `expiresAt` for an active (non-revoked) group or member link. Token is unchanged.
 */
export async function updateAccessLinkExpiryInlineAction(
  formData: FormData
): Promise<UpdateAccessLinkExpiryResult> {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const t = await getTranslations('groups.actions');
  const linkId = getFormValue(formData, 'linkId');

  if (!groupId || !linkId) {
    return {
      message: t('missingLink'),
      ok: false,
    };
  }

  const expiresAt = parseExpiryFromFormData(formData);

  if (!expiresAt) {
    return {
      message: t('expiry'),
      ok: false,
    };
  }

  const accessLink = await prisma.accessLink.findUnique({
    where: {
      id: linkId,
    },
    select: {
      groupId: true,
      id: true,
      revokedAt: true,
      member: {
        select: {
          groupId: true,
        },
      },
    },
  });

  if (!accessLink) {
    return {
      message: t('linkNotFound'),
      ok: false,
    };
  }

  const owningGroupId = accessLink.groupId ?? accessLink.member?.groupId;

  if (owningGroupId !== groupId) {
    return {
      message: t('invalidLink'),
      ok: false,
    };
  }

  if (accessLink.revokedAt) {
    return {
      message: t('revokedLink'),
      ok: false,
    };
  }

  const updated = await prisma.accessLink.update({
    where: {
      id: linkId,
    },
    data: {
      expiresAt,
    },
    select: {
      expiresAt: true,
      id: true,
      lastAccessedAt: true,
      token: true,
    },
  });

  revalidateGroupPaths(groupId);

  return {
    link: {
      expiresAt: updated.expiresAt.toISOString(),
      id: updated.id,
      lastAccessedAt: updated.lastAccessedAt?.toISOString() ?? null,
      token: updated.token,
    },
    ok: true,
  };
}

export async function bulkCreateMemberAccessLinksAction(formData: FormData) {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);

  if (!groupId) {
    redirect('/admin/courses/groups?error=group-not-found');
  }

  const detailPath = getGroupDetailPath(groupId);
  const expiresAt = parseExpiryOrRedirect(formData, detailPath);
  const group = await prisma.courseGroup.findUnique({
    where: {
      id: groupId,
    },
    select: {
      id: true,
      members: {
        orderBy: {
          position: 'asc',
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!group) {
    redirect('/admin/courses/groups?error=group-not-found');
  }

  if (group.members.length === 0) {
    redirect(`${detailPath}?error=group-members`);
  }

  const mintable = await getMintableVersionForGroup(groupId);

  if (!mintable.ok) {
    redirect(
      `${detailPath}?error=${mintable.reason === 'draft' ? 'group-version-draft' : 'group-version'}`
    );
  }

  await prisma.$transaction((transaction) =>
    mintMemberAccessLinks(transaction, {
      groupId,
      memberIds: group.members.map((member) => member.id),
      versionId: mintable.versionId,
      expiresAt,
    })
  );

  revalidateGroupPaths(groupId);

  redirect(`${detailPath}?status=member-links-created`);
}

export async function createMemberAccessLinkAction(formData: FormData) {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const memberId = getFormValue(formData, 'memberId');

  if (!groupId || !memberId) {
    redirect('/admin/courses/groups?error=group-not-found');
  }

  const detailPath = getGroupDetailPath(groupId);
  const expiresAt = parseExpiryOrRedirect(formData, detailPath);
  const member = await prisma.courseGroupMember.findFirst({
    where: {
      groupId,
      id: memberId,
    },
    select: {
      id: true,
    },
  });

  if (!member) {
    redirect(`${detailPath}?error=group-not-found`);
  }

  const mintable = await getMintableVersionForGroup(groupId);

  if (!mintable.ok) {
    redirect(
      `${detailPath}?error=${mintable.reason === 'draft' ? 'group-version-draft' : 'group-version'}`
    );
  }

  await prisma.$transaction((transaction) =>
    mintMemberAccessLinks(transaction, { groupId, memberIds: [memberId], versionId: mintable.versionId, expiresAt })
  );

  revalidateGroupPaths(groupId);

  redirect(`${detailPath}?status=member-link-created`);
}

type MemberAccessLinkInlineResult =
  | {
      link: {
        expiresAt: string;
        id: string;
        lastAccessedAt: string | null;
        token: string;
      };
      ok: true;
    }
  | {
      message: string;
      ok: false;
    };

export async function createMemberAccessLinkInlineAction(
  formData: FormData
): Promise<MemberAccessLinkInlineResult> {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const t = await getTranslations('groups.actions');
  const memberId = getFormValue(formData, 'memberId');

  if (!groupId || !memberId) {
    return {
      message: t('missingMember'),
      ok: false,
    };
  }

  const expiresAt = parseExpiryFromFormData(formData);

  if (!expiresAt) {
    return {
      message: t('expiry'),
      ok: false,
    };
  }

  const member = await prisma.courseGroupMember.findFirst({
    where: {
      groupId,
      id: memberId,
    },
    select: {
      id: true,
    },
  });

  if (!member) {
    return {
      message: t('memberNotFound'),
      ok: false,
    };
  }

  const mintable = await getMintableVersionForGroup(groupId);

  if (!mintable.ok) {
    return {
      message:
        mintable.reason === 'draft'
          ? t('versionDraft')
          : t('noVersion'),
      ok: false,
    };
  }

  const created = await prisma.$transaction(async (transaction) => {
    // Under the group's lock, like every link minted for it (`mintMemberAccessLinks`).
    await lockFor(transaction, 'group', groupId);
    const now = new Date();
    await transaction.accessLink.updateMany({
      where: {
        expiresAt: {
          gt: now,
        },
        memberId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    const link = await transaction.accessLink.create({
      data: {
        curriculumVersionId: mintable.versionId,
        expiresAt,
        memberId,
        token: createPublicAccessToken(),
      },
      select: {
        expiresAt: true,
        id: true,
        lastAccessedAt: true,
        token: true,
      },
    });
    await moveFeedbackToNewLinks(transaction, [{ id: link.id, memberId }]);
    return link;
  });

  revalidateGroupPaths(groupId);

  return {
    link: {
      expiresAt: created.expiresAt.toISOString(),
      id: created.id,
      lastAccessedAt: created.lastAccessedAt?.toISOString() ?? null,
      token: created.token,
    },
    ok: true,
  };
}

export async function revokeAccessLinkInlineAction(
  formData: FormData
): Promise<{ message?: string; ok: true } | { message: string; ok: false }> {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const t = await getTranslations('groups.actions');
  const linkId = getFormValue(formData, 'linkId');

  if (!groupId || !linkId) {
    return {
      message: t('missingLink'),
      ok: false,
    };
  }

  const accessLink = await prisma.accessLink.findUnique({
    where: {
      id: linkId,
    },
    select: {
      groupId: true,
      id: true,
      member: {
        select: {
          groupId: true,
        },
      },
    },
  });

  if (!accessLink) {
    return {
      message: t('linkNotFound'),
      ok: false,
    };
  }

  const owningGroupId = accessLink.groupId ?? accessLink.member?.groupId;

  if (owningGroupId !== groupId) {
    return {
      message: t('invalidLink'),
      ok: false,
    };
  }

  await prisma.accessLink.updateMany({
    where: {
      id: linkId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  revalidateGroupPaths(groupId);

  return {
    ok: true,
  };
}

export async function bulkCreateMemberAccessLinksInlineAction(
  formData: FormData
): Promise<
  | { created: number; ok: true }
  | { message: string; ok: false }
> {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const t = await getTranslations('groups.actions');

  if (!groupId) {
    return {
      message: t('missingGroup'),
      ok: false,
    };
  }

  const expiresAt = parseExpiryFromFormData(formData);

  if (!expiresAt) {
    return {
      message: t('expiry'),
      ok: false,
    };
  }

  const group = await prisma.courseGroup.findUnique({
    where: {
      id: groupId,
    },
    select: {
      id: true,
      members: {
        orderBy: {
          position: 'asc',
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!group) {
    return {
      message: t('groupGone'),
      ok: false,
    };
  }

  if (group.members.length === 0) {
    return {
      message: t('noMembers'),
      ok: false,
    };
  }

  const mintable = await getMintableVersionForGroup(groupId);

  if (!mintable.ok) {
    return {
      message:
        mintable.reason === 'draft'
          ? t('versionDraft')
          : t('noVersion'),
      ok: false,
    };
  }

  await prisma.$transaction((transaction) =>
    mintMemberAccessLinks(transaction, {
      groupId,
      memberIds: group.members.map((member) => member.id),
      versionId: mintable.versionId,
      expiresAt,
    })
  );

  revalidateGroupPaths(groupId);

  return {
    created: group.members.length,
    ok: true,
  };
}

export async function revokeAccessLinkAction(formData: FormData) {
  const groupId = getFormValue(formData, 'groupId');
  // Instructors may manage their own group's attendee links.
  await requireGroupAccess(groupId, [Permission.READ]);
  const linkId = getFormValue(formData, 'linkId');

  if (!groupId || !linkId) {
    redirect('/admin/courses/groups?error=group-not-found');
  }

  const detailPath = getGroupDetailPath(groupId);
  const accessLink = await prisma.accessLink.findUnique({
    where: {
      id: linkId,
    },
    select: {
      groupId: true,
      id: true,
      member: {
        select: {
          groupId: true,
        },
      },
    },
  });

  if (!accessLink) {
    redirect(`${detailPath}?error=group-not-found`);
  }

  const owningGroupId = accessLink.groupId ?? accessLink.member?.groupId;

  if (owningGroupId !== groupId) {
    redirect(`${detailPath}?error=group-not-found`);
  }

  await prisma.accessLink.updateMany({
    where: {
      id: linkId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  revalidateGroupPaths(groupId);

  redirect(
    `${detailPath}?status=${accessLink.groupId ? 'group-link-revoked' : 'member-link-revoked'}`
  );
}

/**
 * Deletes a group with its members, partners and access links. Member links carry only
 * `memberId` (which would be nulled, not cascaded), so they are removed explicitly. Comments on
 * core versions survive via their `proposerName` snapshot; a feedback-driven group's own curriculum
 * is deleted with it (lessons and comments included).
 */
/**
 * A group's roster on its own (instructors manage their group's learners and links even without
 * the group's settings): the same roster rules as the group form.
 */
export async function updateGroupRosterAction(formData: FormData) {
  const groupId = getFormValue(formData, 'groupId');
  const sourceRosterText = String(formData.get('sourceRosterText') ?? '');
  const detailPath = getGroupDetailPath(groupId);
  await requireGroupAccess(groupId, [Permission.READ]);
  const members = parseGroupRoster(sourceRosterText);
  if (members.length === 0) {
    redirect(`${detailPath}?error=group-roster`);
  }
  const now = new Date();
  await prisma.$transaction(async (transaction) => {
    await applyRosterUpdate(transaction, { groupId, desired: members, now });
    await transaction.courseGroup.update({ where: { id: groupId }, data: { sourceRosterText: sourceRosterText || null } });
  });
  revalidateGroupPaths(groupId);
  redirect(`${detailPath}?status=group-updated`);
}

/** Deleting a group (and its learners' data) stays with owners, admins and unrestricted members. */
export async function deleteGroupAction(formData: FormData) {
  await requireSection('groups', [Permission.DELETE]);

  const groupId = getFormValue(formData, 'groupId');

  if (!groupId) {
    redirect('/admin/courses/groups?error=group-not-found');
  }

  const group = await prisma.courseGroup.findUnique({
    where: { id: groupId },
    select: { id: true },
  });

  if (!group) {
    redirect('/admin/courses/groups?error=group-not-found');
  }

  // The group's own curriculum (if any) is deleted with it; its instructor grants go too. Members
  // cascade with the group, so their notes are dropped first — otherwise they'd linger as rows
  // nobody can reach again.
  await prisma.$transaction(async (transaction) => {
    const members = await transaction.courseGroupMember.findMany({
      where: { groupId },
      select: { id: true },
    });

    await deleteNotesForMembers(
      members.map((member) => member.id),
      transaction
    );

    await transaction.accessLink.deleteMany({
      where: { member: { groupId } },
    });

    await transaction.userGrant.deleteMany({
      where: { entityType: GRANT_ENTITY_TYPES.GROUP, entityId: groupId },
    });

    await transaction.courseGroup.delete({
      where: { id: groupId },
    });
  });

  revalidateGroupPaths();

  redirect('/admin/courses/groups?status=group-deleted');
}
