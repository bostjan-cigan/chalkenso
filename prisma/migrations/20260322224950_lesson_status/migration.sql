-- CreateEnum
CREATE TYPE "courses"."LessonStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "courses"."lessons" ADD COLUMN     "status" "courses"."LessonStatus" NOT NULL DEFAULT 'DRAFT';
