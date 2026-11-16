import 'server-only';

import { lessonDraftView, openLessonRevisions, type LessonDraftView } from '@/lib/ai-drafts';
import { getLessonDetail, mapUploadedAssets } from '../../data';
import type { UploadedLessonAsset } from '../../types';
import type { SaveLesson } from '../workspace/lesson-save';

/** One of the round's lessons whose changes were drafted: the lesson as it is, and its improvement's draft. */
export type RoundLessonReview = {
  lesson: SaveLesson & { markdown: string; revision: number };
  uploadedAssets: Record<string, UploadedLessonAsset>;
  taskId: string;
  /** Being written, waiting to be decided, or failed; null: none waits (published, discarded, or it never started). */
  draft: LessonDraftView | null;
};

/**
 * The lessons a round drafted changes for (`drafted`: lesson → its improvement), each with the
 * newest draft of that improvement. The page checked the viewer may edit the version they're in.
 */
export async function loadRoundReviews(viewerId: string, courseId: string, drafted: Record<string, string>): Promise<Record<string, RoundLessonReview>> {
  const reviews: Record<string, RoundLessonReview> = {};
  await Promise.all(
    Object.entries(drafted).map(async ([lessonId, taskId]) => {
      const [lesson, rows] = await Promise.all([getLessonDetail(courseId, lessonId), openLessonRevisions(lessonId)]);
      if (!lesson) return;
      const row = rows.find((candidate) => candidate.taskId === taskId);
      reviews[lessonId] = {
        lesson: {
          id: lesson.id,
          courseId,
          title: lesson.title,
          slug: lesson.slug,
          status: lesson.status,
          shortDescription: lesson.shortDescription ?? '',
          arcId: lesson.arcId ?? '',
          markdown: lesson.markdownContent,
          revision: lesson.revision,
        },
        uploadedAssets: mapUploadedAssets(lesson.assetReferences),
        taskId,
        draft: row ? await lessonDraftView(row, viewerId) : null,
      };
    })
  );
  return reviews;
}
