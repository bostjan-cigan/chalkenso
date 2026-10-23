'use server';

import { CurriculumVersionStatus, Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireCourseAccess } from '@/lib/crm-access';
import { copyVersionContent } from '@/lib/group-curricula';
import { publishVersionLessons, publisherFields, reportVersionUnpublished } from '@/lib/lesson-publishing';
import { prisma } from '@/lib/prisma';
import { retryOnUniqueViolation } from '@/lib/unique-retry';

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function coursePath(courseId: string) {
  return `/admin/courses/${courseId}`;
}

function versionPath(courseId: string, versionId: string) {
  return `/admin/courses/${courseId}/versions/${versionId}`;
}

async function ensureCourseExists(courseId: string) {
  if (!courseId) {
    return false;
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true },
  });

  return Boolean(course);
}

function revalidateCourse(courseId: string, versionId?: string) {
  revalidatePath('/admin');
  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);

  if (versionId) {
    revalidatePath(`/admin/courses/${courseId}/versions/${versionId}`);
  }
}

/**
 * Creates a new DRAFT version. `version` is the next ordinal for the course and the
 * label defaults to `v<n>`. Optionally deep-copies lessons (+ asset references and
 * cached render output) from a source version to seed the new one.
 */
export async function createVersionAction(formData: FormData) {
  const courseId = getFormValue(formData, 'courseId');
  // Unrestricted members, or members who can edit this course (limited to it, or to every course).
  await requireCourseAccess(courseId, [Permission.WRITE]);
  const labelInput = getFormValue(formData, 'label');
  const duplicateFromId = getFormValue(formData, 'duplicateFromVersionId');

  if (!(await ensureCourseExists(courseId))) {
    redirect('/admin/courses?error=course-not-found');
  }
  // Only lessons of this course can be copied in.
  if (duplicateFromId && !(await prisma.curriculumVersion.findFirst({ where: { id: duplicateFromId, courseId }, select: { id: true } }))) {
    redirect(`/admin/courses/${courseId}?error=version-source`);
  }

  // Two versions made at the same moment can pick the same next number: the loser takes the next.
  const createdVersionId = await retryOnUniqueViolation(
    () =>
      prisma.$transaction(
        async (transaction) => {
          const latest = await transaction.curriculumVersion.findFirst({
            where: { courseId, ownerGroupId: null },
            orderBy: { version: 'desc' },
            select: { version: true },
          });

          const nextVersion = (latest?.version ?? 0) + 1;
          const label = labelInput || `v${nextVersion}`;

          const created = await transaction.curriculumVersion.create({
            data: {
              courseId,
              label,
              version: nextVersion,
              status: CurriculumVersionStatus.DRAFT,
            },
            select: { id: true },
          });

          if (duplicateFromId) {
            await copyVersionContent(transaction, {
              sourceVersionId: duplicateFromId,
              targetVersionId: created.id,
              courseId,
              linkToSource: false,
            });
          }

          return created.id;
        },
        { timeout: 30_000 }
      ),
    { fields: ['version'] }
  );

  revalidateCourse(courseId, createdVersionId);
  redirect(`${versionPath(courseId, createdVersionId)}?status=version-created`);
}

async function loadVersion(courseId: string, versionId: string) {
  if (!courseId || !versionId) {
    return null;
  }

  return prisma.curriculumVersion.findFirst({
    where: { courseId, id: versionId },
    select: { id: true, status: true, ownerGroupId: true },
  });
}

export type VersionActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function publishVersionAction(
  formData: FormData
): Promise<VersionActionResult> {
  const courseId = getFormValue(formData, 'courseId');
  // Unrestricted members, or members who can edit this course (limited to it, or to every course).
  const viewer = await requireCourseAccess(courseId, [Permission.WRITE]);
  const versionId = getFormValue(formData, 'versionId');
  const t = await getTranslations('courses.actions');

  if (!(await loadVersion(courseId, versionId))) {
    return { ok: false, message: t('selectVersion') };
  }

  // Publishing a curriculum publishes every lesson in it: learners see their current text. A few
  // statements whatever the version's size (`publishVersionLessons`); the timeout is for big texts.
  const lessonCount = await prisma.$transaction(
    async (transaction) => {
      await transaction.curriculumVersion.update({
        where: { id: versionId },
        data: {
          status: CurriculumVersionStatus.PUBLISHED,
          publishedAt: new Date(),
          // Who, for the version history.
          ...(await publisherFields(transaction, viewer.id)),
        },
      });

      return publishVersionLessons(transaction, versionId, viewer.id);
    },
    { timeout: 30_000 }
  );

  revalidateCourse(courseId, versionId);
  return {
    ok: true,
    message: t('versionPublished', { count: lessonCount }),
  };
}

export async function unpublishVersionAction(
  formData: FormData
): Promise<VersionActionResult> {
  const courseId = getFormValue(formData, 'courseId');
  // Unrestricted members, or members who can edit this course (limited to it, or to every course).
  await requireCourseAccess(courseId, [Permission.WRITE]);
  const versionId = getFormValue(formData, 'versionId');
  const t = await getTranslations('courses.actions');

  const version = await loadVersion(courseId, versionId);

  if (!version) {
    return { ok: false, message: t('selectVersion') };
  }

  // A group curriculum is what its group's links serve; it is closed from the group page instead.
  if (version.ownerGroupId) {
    return {
      ok: false,
      message: t('groupCopyStaysPublished'),
    };
  }

  await prisma.curriculumVersion.update({
    where: { id: versionId },
    data: {
      status: CurriculumVersionStatus.DRAFT,
      publishedAt: null,
      publishedById: null,
      publisherName: null,
    },
  });
  if (version.status === CurriculumVersionStatus.PUBLISHED) {
    await reportVersionUnpublished(prisma, versionId);
  }

  revalidateCourse(courseId, versionId);
  return { ok: true, message: t('versionUnpublished') };
}

export async function renameVersionAction(
  formData: FormData
): Promise<VersionActionResult> {
  const courseId = getFormValue(formData, 'courseId');
  // Unrestricted members, or members who can edit this course (limited to it, or to every course).
  await requireCourseAccess(courseId, [Permission.WRITE]);
  const versionId = getFormValue(formData, 'versionId');
  const label = getFormValue(formData, 'label');
  const t = await getTranslations('courses.actions');

  if (!(await loadVersion(courseId, versionId))) {
    return { ok: false, message: t('selectVersion') };
  }

  if (!label) {
    return { ok: false, message: t('versionLabel') };
  }

  await prisma.curriculumVersion.update({
    where: { id: versionId },
    data: { label },
  });

  revalidateCourse(courseId, versionId);
  return { ok: true, message: t('versionRenamed') };
}

/**
 * Deletes a draft version (and cascades its lessons and arcs). Blocked if the version is
 * published, or if any group or active link still points at it. A course may be left with no
 * versions.
 */
export async function deleteVersionAction(formData: FormData) {
  const courseId = getFormValue(formData, 'courseId');
  // Unrestricted members, or members who can edit this course (limited to it, or to every course).
  await requireCourseAccess(courseId, [Permission.DELETE]);
  const versionId = getFormValue(formData, 'versionId');

  const version = await loadVersion(courseId, versionId);

  if (!version) {
    redirect(`${coursePath(courseId)}?error=version-not-found`);
  }

  if (version.status !== CurriculumVersionStatus.DRAFT) {
    redirect(`${coursePath(courseId)}?error=version-not-draft`);
  }

  const now = new Date();
  const [groupCount, activeLinkCount] = await Promise.all([
    prisma.courseGroup.count({ where: { curriculumVersionId: versionId } }),
    /** Preview links don't pin a version; they simply stop resolving once it's deleted. */
    prisma.accessLink.count({
      where: {
        curriculumVersionId: versionId,
        isPreview: false,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    }),
  ]);

  if (groupCount > 0 || activeLinkCount > 0) {
    redirect(`${versionPath(courseId, versionId)}?error=version-in-use`);
  }

  await prisma.curriculumVersion.delete({
    where: { id: versionId },
  });

  revalidateCourse(courseId);
  redirect(`${coursePath(courseId)}?status=version-deleted`);
}
