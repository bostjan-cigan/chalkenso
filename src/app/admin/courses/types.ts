export type CourseSection = 'courses' | 'groups' | 'comments' | 'partners';

export type UploadedLessonAsset = {
  assetId: string;
  bytes: number | null;
  mimeType: string | null;
  originalFilename: string;
  publicUrl: string | null;
  r2Key: string;
  sourcePath: string;
};
