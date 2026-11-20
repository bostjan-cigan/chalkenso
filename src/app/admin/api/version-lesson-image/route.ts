import { NextResponse } from 'next/server';
import { canOpenPreview, getCrmViewer, loadVersionRef } from '@/lib/crm-access';
import { lessonImageResponse } from '@/lib/lesson-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestPayload = {
  courseId?: string;
  versionId?: string;
  lessonId?: string;
  src?: string;
};

/** An image of a version's lesson, for the PDF export on the team's preview (see `lessonImageResponse`). */
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
  const versionId = payload.versionId?.trim();
  const lessonId = payload.lessonId?.trim();
  const src = payload.src?.trim();
  if (!versionId || !lessonId || !src) {
    return NextResponse.json({ error: 'versionId, lessonId and src are required.' }, { status: 400 });
  }

  // Whoever may open the version's preview, as for the lesson itself (`../version-lesson`).
  const version = await loadVersionRef(versionId);
  if (!version || !(await canOpenPreview(viewer, version))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return lessonImageResponse({ id: lessonId, curriculumVersionId: versionId }, src);
}
