import { NextResponse } from 'next/server';
import { canOpenPreview, getCrmViewer, loadVersionRef } from '@/lib/crm-access';
import { getAdminAssetUrl } from '@/lib/asset-urls';
import {
  renderLessonMarkdownToHtml,
  resolveLessonLinksForVersion,
} from '@/lib/access-lesson-render';
import { resolveLessonMarkdownAssetUrls } from '@/lib/course-markdown';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type RequestPayload = {
  courseId?: string;
  versionId?: string;
  lessonId?: string;
};

/** Renders a single version lesson exactly as the attendee view does, but with admin asset URLs. */
export async function POST(request: Request) {
  const viewer = await getCrmViewer();

  if (!viewer) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let payload: RequestPayload;

  try {
    payload = (await request.json()) as RequestPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const courseId = payload.courseId?.trim();
  const versionId = payload.versionId?.trim();
  const lessonId = payload.lessonId?.trim();

  if (!courseId || !versionId || !lessonId) {
    return NextResponse.json(
      { error: 'courseId, versionId and lessonId are required.' },
      { status: 400 }
    );
  }

  // Anyone who may open the version's preview (Courses section, READ on it — e.g. an instructor — or
  // a guest instructor of a group that reads it).
  const version = await loadVersionRef(versionId);
  if (!version || !(await canOpenPreview(viewer, version))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const lesson = await prisma.lesson.findFirst({
    where: {
      courseId,
      curriculumVersionId: versionId,
      id: lessonId,
    },
    select: {
      id: true,
      markdownContent: true,
      position: true,
      title: true,
      assetReferences: {
        select: {
          assetId: true,
          sourcePath: true,
        },
      },
    },
  });

  if (!lesson) {
    return NextResponse.json({ error: 'Lesson not found.' }, { status: 404 });
  }

  const assetUrlsBySourcePath = new Map<string, string>();
  for (const reference of lesson.assetReferences) {
    if (reference.assetId) {
      assetUrlsBySourcePath.set(reference.sourcePath, getAdminAssetUrl(reference.assetId));
    }
  }

  const html = await resolveLessonLinksForVersion(
    renderLessonMarkdownToHtml(
      resolveLessonMarkdownAssetUrls(lesson.markdownContent, assetUrlsBySourcePath)
    ),
    versionId,
    'working'
  );

  return NextResponse.json({
    lesson: {
      html,
      id: lesson.id,
      position: lesson.position,
      title: lesson.title,
    },
  });
}
