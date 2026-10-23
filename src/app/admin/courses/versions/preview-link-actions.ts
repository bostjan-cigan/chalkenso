'use server';

import { Permission } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { parseDateTimeLocalValue } from '@/lib/access-links';
import { requireVersionEdit } from '@/lib/crm-access';
import { prisma } from '@/lib/prisma';
import { createPublicAccessToken } from '@/lib/security';
import { toPreviewLinkView, type PreviewLinkView } from './preview-link-view';

const PREVIEW_LABEL_MAX = 120;

const previewLinkSelect = {
  claimedAt: true,
  createdAt: true,
  expiresAt: true,
  id: true,
  label: true,
  lastAccessedAt: true,
  oneTime: true,
  revokedAt: true,
  token: true,
} as const;

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function revalidateVersion(courseId: string, versionId: string) {
  revalidatePath(`/admin/courses/${courseId}/versions/${versionId}`);
}

type PreviewLinkResult =
  | { ok: true; link: PreviewLinkView }
  | { ok: false; message: string };

/**
 * Mints a shareable preview link for any version (drafts included). Behaves like a group link
 * (read-only, expiry, revocable) but is not tied to a group; `oneTime` binds it to the first
 * browser that opens it. Unlike group links, several preview links may be active at once.
 */
export async function createPreviewLinkAction(formData: FormData): Promise<PreviewLinkResult> {
  const courseId = getFormValue(formData, 'courseId');
  const versionId = getFormValue(formData, 'versionId');
  // Courses section for any version; instructors only on their group curriculum.
  await requireVersionEdit(versionId, [Permission.WRITE]);
  const label = getFormValue(formData, 'label').slice(0, PREVIEW_LABEL_MAX) || null;
  const oneTime = getFormValue(formData, 'oneTime') === 'true';
  const expiresAt = parseDateTimeLocalValue(getFormValue(formData, 'expiresAt'));
  const t = await getTranslations('courses.actions');

  if (!expiresAt || expiresAt <= new Date()) {
    return { ok: false, message: t('previewExpiry') };
  }

  const version = await prisma.curriculumVersion.findFirst({
    where: { courseId, id: versionId },
    select: { id: true },
  });

  if (!version) {
    return { ok: false, message: t('versionNotFound') };
  }

  const link = await prisma.accessLink.create({
    data: {
      curriculumVersionId: version.id,
      expiresAt,
      isPreview: true,
      label,
      oneTime,
      token: createPublicAccessToken(),
    },
    select: previewLinkSelect,
  });

  revalidateVersion(courseId, versionId);

  return { ok: true, link: toPreviewLinkView(link) };
}

export async function revokePreviewLinkAction(
  formData: FormData
): Promise<{ ok: boolean; message?: string }> {
  const courseId = getFormValue(formData, 'courseId');
  const versionId = getFormValue(formData, 'versionId');
  // Courses section for any version; instructors only on their group curriculum.
  await requireVersionEdit(versionId, [Permission.WRITE]);
  const linkId = getFormValue(formData, 'linkId');
  const t = await getTranslations('courses.actions');

  if (!versionId || !linkId) {
    return { ok: false, message: t('previewNotFound') };
  }

  /** Scoped to preview links of this version, so it can never touch group/member links. */
  const revoked = await prisma.accessLink.updateMany({
    where: {
      curriculumVersionId: versionId,
      id: linkId,
      isPreview: true,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  if (revoked.count === 0) {
    return { ok: false, message: t('previewNotFound') };
  }

  revalidateVersion(courseId, versionId);

  return { ok: true, message: t('previewRevoked') };
}

/**
 * Permanently deletes a preview link. Only links that no longer work (revoked or expired) can be
 * deleted, so a live link always goes through an explicit revoke first. Comments left through the
 * link survive (`accessLinkId` is `SetNull`, `proposerName` is a snapshot).
 */
export async function deletePreviewLinkAction(
  formData: FormData
): Promise<{ ok: boolean; message?: string }> {
  const courseId = getFormValue(formData, 'courseId');
  const versionId = getFormValue(formData, 'versionId');
  // Courses section for any version; instructors only on their group curriculum.
  await requireVersionEdit(versionId, [Permission.DELETE]);
  const linkId = getFormValue(formData, 'linkId');
  const t = await getTranslations('courses.actions');

  if (!versionId || !linkId) {
    return { ok: false, message: t('previewNotFound') };
  }

  /** Scoped to preview links of this version, so it can never touch group/member links. */
  const deleted = await prisma.accessLink.deleteMany({
    where: {
      curriculumVersionId: versionId,
      id: linkId,
      isPreview: true,
      OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: new Date() } }],
    },
  });

  if (deleted.count === 0) {
    return { ok: false, message: t('previewStillLive') };
  }

  revalidateVersion(courseId, versionId);

  return { ok: true, message: t('previewDeleted') };
}
