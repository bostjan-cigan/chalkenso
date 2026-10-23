-- AlterTable
ALTER TABLE "courses"."courses" ADD COLUMN     "all_lessons_free" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enrol_url" TEXT,
ADD COLUMN     "free_lesson_count" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "public_listed" BOOLEAN NOT NULL DEFAULT false;
