'use server';

import { Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { lockFor } from '@/lib/advisory-locks';
import { requireVersionEdit } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { retryOnUniqueViolation } from '@/lib/unique-retry';

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

export type ArcActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function revalidateVersion(courseId: string, versionId: string) {
  revalidatePath(`/admin/courses/${courseId}/versions/${versionId}`);
  revalidatePath(`/admin/courses/${courseId}/versions/${versionId}/preview`);
}

async function loadVersion(courseId: string, versionId: string) {
  if (!courseId || !versionId) {
    return null;
  }

  return prisma.curriculumVersion.findFirst({
    where: { courseId, id: versionId },
    select: { id: true },
  });
}

async function loadArc(courseId: string, versionId: string, arcId: string) {
  if (!arcId) {
    return null;
  }

  return prisma.lessonArc.findFirst({
    where: {
      id: arcId,
      curriculumVersionId: versionId,
      curriculumVersion: { courseId },
    },
    select: { id: true, position: true },
  });
}

/** Creates an arc appended to the end of the version's arc list. */
export async function createArcAction(formData: FormData): Promise<ArcActionResult> {
  const courseId = getFormValue(formData, 'courseId');
  const versionId = getFormValue(formData, 'versionId');
  // Courses section for any version; instructors only on their group curriculum.
  await requireVersionEdit(versionId, [Permission.WRITE]);
  const title = getFormValue(formData, 'title');
  const description = getFormValue(formData, 'description');
  const t = await getTranslations('courses.actions');

  if (!(await loadVersion(courseId, versionId))) {
    return { ok: false, message: t('selectVersion') };
  }

  if (!title) {
    return { ok: false, message: t('sectionTitle') };
  }

  // Two sections added at the same moment can pick the same position: the loser takes the next.
  await retryOnUniqueViolation(
    async () => {
      const last = await prisma.lessonArc.findFirst({
        where: { curriculumVersionId: versionId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      await prisma.lessonArc.create({
        data: {
          curriculumVersionId: versionId,
          title,
          description: description || null,
          position: (last?.position ?? 0) + 1,
        },
      });
    },
    { fields: ['position'] }
  );

  revalidateVersion(courseId, versionId);
  return { ok: true, message: t('sectionAdded') };
}

/** Renames an arc / edits its description. */
export async function updateArcAction(formData: FormData): Promise<ArcActionResult> {
  const courseId = getFormValue(formData, 'courseId');
  const versionId = getFormValue(formData, 'versionId');
  // Courses section for any version; instructors only on their group curriculum.
  await requireVersionEdit(versionId, [Permission.WRITE]);
  const arcId = getFormValue(formData, 'arcId');
  const title = getFormValue(formData, 'title');
  const description = getFormValue(formData, 'description');
  const t = await getTranslations('courses.actions');

  if (!(await loadArc(courseId, versionId, arcId))) {
    return { ok: false, message: t('selectSection') };
  }

  if (!title) {
    return { ok: false, message: t('sectionTitle') };
  }

  await prisma.lessonArc.update({
    where: { id: arcId },
    data: {
      title,
      description: description || null,
    },
  });

  revalidateVersion(courseId, versionId);
  return { ok: true, message: t('sectionUpdated') };
}

/** Deletes an arc; its lessons stay in the version, un-grouped (FK is SetNull). */
export async function deleteArcAction(formData: FormData): Promise<ArcActionResult> {
  const courseId = getFormValue(formData, 'courseId');
  const versionId = getFormValue(formData, 'versionId');
  // Courses section for any version; instructors only on their group curriculum.
  await requireVersionEdit(versionId, [Permission.DELETE]);
  const arcId = getFormValue(formData, 'arcId');
  const t = await getTranslations('courses.actions');

  if (!(await loadArc(courseId, versionId, arcId))) {
    return { ok: false, message: t('selectSection') };
  }

  await prisma.lessonArc.delete({
    where: { id: arcId },
  });

  revalidateVersion(courseId, versionId);
  return { ok: true, message: t('sectionDeleted') };
}

/**
 * Moves an arc one slot up or down by swapping positions with its neighbour.
 * The swap goes through a temporary position to avoid the unique (version, position) collision.
 */
export async function moveArcAction(formData: FormData): Promise<ArcActionResult> {
  const courseId = getFormValue(formData, 'courseId');
  const versionId = getFormValue(formData, 'versionId');
  // Courses section for any version; instructors only on their group curriculum.
  await requireVersionEdit(versionId, [Permission.WRITE]);
  const arcId = getFormValue(formData, 'arcId');
  const direction = getFormValue(formData, 'direction');
  const t = await getTranslations('courses.actions');

  const arc = await loadArc(courseId, versionId, arcId);

  if (!arc) {
    return { ok: false, message: t('selectSection') };
  }

  if (direction !== 'up' && direction !== 'down') {
    return { ok: false, message: t('moveDirection') };
  }

  await prisma.$transaction(async (transaction) => {
    // One move per version at a time, read under the lock: two at once would both park at the same
    // spare position, or swap from positions the other had just changed.
    await lockFor(transaction, 'version', versionId);
    const current = await transaction.lessonArc.findFirst({
      where: { id: arc.id, curriculumVersionId: versionId },
      select: { position: true },
    });
    if (!current) {
      return;
    }

    const neighbour = await transaction.lessonArc.findFirst({
      where: {
        curriculumVersionId: versionId,
        position:
          direction === 'up' ? { lt: current.position } : { gt: current.position },
      },
      orderBy: {
        position: direction === 'up' ? 'desc' : 'asc',
      },
      select: { id: true, position: true },
    });

    if (!neighbour) {
      // Already at the edge; nothing to do.
      return;
    }

    // Park the moving arc at a temporary position to free its slot.
    await transaction.lessonArc.update({
      where: { id: arc.id },
      data: { position: -1 },
    });
    await transaction.lessonArc.update({
      where: { id: neighbour.id },
      data: { position: current.position },
    });
    await transaction.lessonArc.update({
      where: { id: arc.id },
      data: { position: neighbour.position },
    });
  });

  revalidateVersion(courseId, versionId);
  return { ok: true, message: t('sectionReordered') };
}
