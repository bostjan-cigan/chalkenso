-- Who published a version and each lesson text ("Export everything": the version history says who).
-- Names are copied in, so the history reads the same after people are renamed or leave.

-- AlterTable
ALTER TABLE "courses"."curriculum_versions" ADD COLUMN     "published_by_id" TEXT,
ADD COLUMN     "publisher_name" TEXT;

-- AlterTable
ALTER TABLE "courses"."lesson_publications" ADD COLUMN     "published_by_id" TEXT,
ADD COLUMN     "publisher_name" TEXT;
