import { NextResponse } from 'next/server';
import { learnerError } from '@/app/l/learner-locale';
import { getRenderedLessonForAccess } from '@/lib/access-lesson-render';
import { withLearnerAccess } from '@/lib/course-access';

type RequestPayload = {
  lessonId?: string;
  token?: string;
};

/** Errors are in the learner page's language (`learnerError`). */
async function badRequest(token: string, message: string) {
  return NextResponse.json({ error: await learnerError(token, message) }, { status: 400 });
}

async function forbidden(token: string, message: string) {
  return NextResponse.json({ error: await learnerError(token, message) }, { status: 403 });
}

async function notFound(token: string) {
  return NextResponse.json({ error: await learnerError(token, 'Lesson not found.') }, { status: 404 });
}

export async function POST(request: Request) {
  let payload: RequestPayload;

  try {
    payload = (await request.json()) as RequestPayload;
  } catch {
    return badRequest('', 'Invalid JSON payload.');
  }

  const token = payload.token?.trim();
  const lessonId = payload.lessonId?.trim();

  if (!token || !lessonId) {
    return badRequest(token ?? '', 'Token and lessonId are required.');
  }

  // The link's organisation, even when someone else is signed in in this browser.
  return withLearnerAccess(token, async (access) => {
    if (access.state !== 'valid') {
      return forbidden(token, 'Access is not valid.');
    }

    if (!access.curriculumVersionId) {
      return notFound(token);
    }

    const renderedLesson = await getRenderedLessonForAccess({
      curriculumVersionId: access.curriculumVersionId,
      groupId: access.groupId,
      lessonId,
      // Learners read what was last published; draft preview links read the working copy.
      text: access.isPreview ? 'working' : 'published',
    });

    if (!renderedLesson) {
      return notFound(token);
    }

    return NextResponse.json({ lesson: renderedLesson });
  });
}
