import { NextResponse } from 'next/server';
import { withLearnerAccess } from '@/lib/course-access';
import { lessonImageResponse } from '@/lib/lesson-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestPayload = {
  lessonId?: string;
  src?: string;
  token?: string;
};

/**
 * An image of a lesson the learner link may read, for the PDF export (see `lessonImageResponse`):
 * only where PDF export is on for the link.
 */
export async function POST(request: Request) {
  let payload: RequestPayload;
  try {
    payload = (await request.json()) as RequestPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }
  const token = payload.token?.trim();
  const lessonId = payload.lessonId?.trim();
  const src = payload.src?.trim();
  if (!token || !lessonId || !src) {
    return NextResponse.json({ error: 'Token, lessonId and src are required.' }, { status: 400 });
  }

  // The link's organisation, even when someone else is signed in in this browser.
  return withLearnerAccess(token, async (access) => {
    if (access.state !== 'valid' || !access.pdfExport || !access.curriculumVersionId) {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    }
    // Learners read what was last published; draft preview links read every lesson.
    return lessonImageResponse({ id: lessonId, curriculumVersionId: access.curriculumVersionId, published: !access.isPreview }, src);
  });
}
