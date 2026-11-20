-- PDF export for learners: off unless the curriculum version allows it; a group follows the version
-- it reads (its own copy: the version it was copied from) unless it has its own answer.

-- AlterTable
ALTER TABLE "courses"."curriculum_versions" ADD COLUMN "pdf_export" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "courses"."course_groups" ADD COLUMN "pdf_export" BOOLEAN;
