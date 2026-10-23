import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { Permission } from '@prisma/client';
import { canUploadLessonAssets, canUploadToCourse, getCrmViewer } from '@/lib/crm-access';
import { canAccessSection } from '@/lib/permissions';
import { getAdminAssetUrl } from '@/lib/asset-urls';
import { prisma } from '@/lib/prisma';
import { buildCourseAssetKey, UNSAFE_SVG_MESSAGE, uploadImageToR2, type CourseAssetFolder } from '@/lib/r2';

export const runtime = 'nodejs';
/**
 * 60s is the hard ceiling some serverless hosts set for a function (their builds reject anything
 * higher), so this is a constraint to fit inside rather than a preference: a long upload or batch has
 * to finish within it. Self-hosted there is no per-request cap at all and this is inert.
 */
export const maxDuration = 60;

/** The storage's refusals the uploader can do something about (`uploadImageToR2`), by their English text. */
const UPLOAD_ERRORS = {
  'Only image uploads are supported.': 'imagesOnly',
  'Cannot upload an empty file.': 'emptyFile',
  [UNSAFE_SVG_MESSAGE]: 'unsafeSvg',
} as const;

/**
 * Uploads an image for a course (its cover, or a lesson's). The errors are shown to the person
 * uploading, in their language (`courses.upload`); an unexpected one keeps its own text.
 */
export async function POST(request: Request) {
  const viewer = await getCrmViewer();
  const session = viewer && canUploadLessonAssets(viewer) ? viewer : null;
  let createdAssetId: string | null = null;
  const t = await getTranslations('courses.upload');

  if (!session) {
    return NextResponse.json(
      {
        error: t('unauthorized'),
      },
      { status: 401 }
    );
  }

  try {
    const formData = await request.formData();
    const sourcePath = String(formData.get('sourcePath') ?? '').trim();
    const file = formData.get('file');
    const courseId = String(formData.get('courseId') ?? '').trim();
    // Where in the course's storage the image goes: its cover, or images in its lessons (default).
    const folder: CourseAssetFolder = formData.get('folder') === 'cover' ? 'cover' : 'lessons';

    if (!sourcePath) {
      return NextResponse.json(
        {
          error: t('missingPath'),
        },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: t('chooseImage'),
        },
        { status: 400 }
      );
    }

    // Scoped to the signed-in organisation, so another organisation's course is simply not found.
    const course = courseId
      ? await prisma.course.findFirst({ where: { id: courseId }, select: { id: true, organizationId: true } })
      : null;
    if (!course) {
      return NextResponse.json({ error: t('unknownCourse') }, { status: 404 });
    }
    // A course cover is course settings (unrestricted members); lesson images need WRITE on the course
    // or on one of its groups' copies.
    const allowed =
      folder === 'cover' ? canAccessSection(session, 'courses', [Permission.WRITE]) : await canUploadToCourse(session, course.id);
    if (!allowed) {
      return NextResponse.json({ error: t('unauthorized') }, { status: 403 });
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        mimeType: file.type || null,
        originalFilename: file.name,
        r2Key: `pending/${randomUUID()}`,
      },
      select: {
        id: true,
      },
    });
    createdAssetId = asset.id;
    const uploadedImage = await uploadImageToR2(
      file,
      buildCourseAssetKey({ organizationId: course.organizationId, courseId: course.id }, folder, asset.id, file.name)
    );
    const updatedAsset = await prisma.mediaAsset.update({
      where: {
        id: asset.id,
      },
      data: {
        bytes: uploadedImage.bytes,
        checksum: uploadedImage.checksum,
        mimeType: uploadedImage.mimeType,
        originalFilename: uploadedImage.originalFilename,
        r2Key: uploadedImage.key,
      },
      select: {
        bytes: true,
        id: true,
        mimeType: true,
        originalFilename: true,
        r2Key: true,
      },
    });

    return NextResponse.json({
      asset: {
        assetId: updatedAsset.id,
        bytes: updatedAsset.bytes,
        mimeType: updatedAsset.mimeType,
        originalFilename: updatedAsset.originalFilename,
        publicUrl: getAdminAssetUrl(updatedAsset.id),
        r2Key: updatedAsset.r2Key,
        sourcePath,
      },
    });
  } catch (error) {
    if (createdAssetId) {
      await prisma.mediaAsset.delete({
        where: {
          id: createdAssetId,
        },
      }).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : null;
    const known = message && Object.prototype.hasOwnProperty.call(UPLOAD_ERRORS, message)
      ? UPLOAD_ERRORS[message as keyof typeof UPLOAD_ERRORS]
      : null;
    return NextResponse.json(
      {
        error: known ? t(known) : (message ?? t('failed')),
      },
      // What the uploader can fix is their request; anything else is ours.
      { status: known ? 400 : 500 }
    );
  }
}
