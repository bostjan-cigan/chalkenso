import { getPendingImageReferences } from '@/lib/course-markdown';
import type { UploadedLessonAsset } from '../../types';

/** The lesson's own fields a save sends back unchanged with its new text. */
export type SaveLesson = { id: string; courseId: string; title: string; slug: string; status: string; shortDescription: string; arcId: string };

/** What one save puts into the lesson: an improvement's changes (or a draft's of no improvement), kept or written by hand. */
export type SaveEntry = {
  taskId: string | null;
  draftId: string | null;
  before: string;
  after: string;
  applied: number;
  skipped: number;
  noteIds: string[];
  /** A group's improvement: whether this Publish also changes the main course (the switch). */
  toCourse?: boolean;
};

/**
 * The form `updateLessonInlineAction` takes for a lesson's new text: its fields as they are, the
 * images the text uses (uploaded ones, and a draft's new diagrams, `<draft>/<path>`, which the
 * server stores from the draft), and what the save carries (`entry`: the improvement, its draft
 * and feedback, and what it changed).
 */
export function lessonSaveForm(
  lesson: SaveLesson,
  text: string,
  revision: number,
  entry: SaveEntry | null,
  uploadedAssets: Record<string, UploadedLessonAsset>,
  draftDiagrams: string[]
) {
  const formData = new FormData();
  formData.set('courseId', lesson.courseId);
  formData.set('lessonId', lesson.id);
  formData.set('title', lesson.title);
  formData.set('slug', lesson.slug);
  formData.set('status', lesson.status);
  formData.set('shortDescription', lesson.shortDescription);
  formData.set('arcId', lesson.arcId);
  formData.set('revision', String(revision));
  formData.set('markdownContent', text);
  for (const reference of getPendingImageReferences(text)) {
    const asset = uploadedAssets[reference.sourcePath];
    if (asset) formData.append('uploadedAssetBinding', JSON.stringify({ assetId: asset.assetId, sourcePath: asset.sourcePath }));
    const from = asset ? undefined : draftDiagrams.find((item) => item.endsWith(`/${reference.sourcePath}`));
    if (from) formData.append('draftDiagram', JSON.stringify({ proposalId: from.slice(0, from.indexOf('/')), sourcePath: reference.sourcePath }));
  }
  if (entry) {
    formData.set(
      'lessonChange',
      JSON.stringify([
        {
          taskId: entry.taskId,
          proposalIds: entry.draftId ? [entry.draftId] : [],
          noteIds: entry.noteIds,
          applied: entry.applied,
          skipped: entry.skipped,
          before: entry.before,
          after: entry.after,
          ...(entry.toCourse === undefined ? {} : { toCourse: entry.toCourse }),
        },
      ])
    );
  }
  return formData;
}
