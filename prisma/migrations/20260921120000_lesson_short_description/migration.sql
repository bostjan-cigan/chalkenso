-- AlterTable: optional one-line lesson summary (null falls back to "Lesson <position>").
ALTER TABLE "courses"."lessons" ADD COLUMN "short_description" TEXT;
