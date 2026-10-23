/** Where a lesson's rendered HTML is fetched from — a live access token, or an admin version preview. */
export type LessonSource =
  | { kind: 'access'; token: string }
  | { kind: 'preview'; courseId: string; versionId: string };

/** Builds the POST request (url + body) that loads a single lesson's HTML for the given source. */
export function buildLessonRequest(source: LessonSource, lessonId: string): {
  url: string;
  body: Record<string, string>;
} {
  if (source.kind === 'preview') {
    return {
      url: '/admin/api/version-lesson',
      body: {
        courseId: source.courseId,
        lessonId,
        versionId: source.versionId,
      },
    };
  }

  return {
    url: '/api/access/lesson',
    body: {
      lessonId,
      token: source.token,
    },
  };
}
