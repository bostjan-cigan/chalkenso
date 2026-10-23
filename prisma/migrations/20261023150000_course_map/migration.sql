-- The course map (cloud): the organisation's concepts, what a course takes as known, people's
-- corrections to the text scan, the notes added to lessons' improvements from the map and the issues
-- dismissed there, and saved analyses (an AI one run on demand). Where concepts are taught and used
-- by the text scan isn't stored: it's read from the lessons' text.

-- CreateEnum
CREATE TYPE "courses"."ConceptRole" AS ENUM ('TEACHES', 'USES', 'IGNORE');

-- CreateEnum
CREATE TYPE "courses"."CourseMapSource" AS ENUM ('CODE', 'AI');

-- CreateEnum
CREATE TYPE "courses"."CourseMapAnalysisStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'STOPPED');

-- CreateTable
CREATE TABLE "courses"."concepts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "definition" TEXT,
    "ignore_phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_case" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."concept_requirements" (
    "concept_id" TEXT NOT NULL,
    "requires_id" TEXT NOT NULL,

    CONSTRAINT "concept_requirements_pkey" PRIMARY KEY ("concept_id","requires_id")
);

-- CreateTable
CREATE TABLE "courses"."concept_dismissals" (
    "organization_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_dismissals_pkey" PRIMARY KEY ("organization_id","term")
);

-- CreateTable
CREATE TABLE "courses"."course_assumed_concepts" (
    "course_id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,

    CONSTRAINT "course_assumed_concepts_pkey" PRIMARY KEY ("course_id","concept_id")
);

-- CreateTable
CREATE TABLE "courses"."lesson_concept_overrides" (
    "lesson_id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "role" "courses"."ConceptRole" NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_concept_overrides_pkey" PRIMARY KEY ("lesson_id","concept_id")
);

-- CreateTable
CREATE TABLE "courses"."course_map_notes" (
    "lesson_id" TEXT NOT NULL,
    "issue_key" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_map_notes_pkey" PRIMARY KEY ("lesson_id","issue_key")
);

-- CreateTable
CREATE TABLE "courses"."course_map_dismissals" (
    "lesson_id" TEXT NOT NULL,
    "issue_key" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_map_dismissals_pkey" PRIMARY KEY ("lesson_id","issue_key")
);

-- CreateTable
CREATE TABLE "courses"."course_map_analyses" (
    "id" TEXT NOT NULL,
    "curriculum_version_id" TEXT NOT NULL,
    "source" "courses"."CourseMapSource" NOT NULL,
    "status" "courses"."CourseMapAnalysisStatus" NOT NULL DEFAULT 'RUNNING',
    "result" JSONB,
    "inputs" JSONB NOT NULL,
    "model" TEXT,
    "created_by_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "course_map_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concepts_organization_id_name_key" ON "courses"."concepts"("organization_id", "name");

-- CreateIndex
CREATE INDEX "concept_requirements_requires_id_idx" ON "courses"."concept_requirements"("requires_id");

-- CreateIndex
CREATE INDEX "course_assumed_concepts_concept_id_idx" ON "courses"."course_assumed_concepts"("concept_id");

-- CreateIndex
CREATE INDEX "lesson_concept_overrides_concept_id_idx" ON "courses"."lesson_concept_overrides"("concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_map_notes_comment_id_key" ON "courses"."course_map_notes"("comment_id");

-- CreateIndex
CREATE INDEX "course_map_analyses_curriculum_version_id_source_created_at_idx" ON "courses"."course_map_analyses"("curriculum_version_id", "source", "created_at");

-- AddForeignKey
ALTER TABLE "courses"."concepts" ADD CONSTRAINT "concepts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."concept_requirements" ADD CONSTRAINT "concept_requirements_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "courses"."concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."concept_requirements" ADD CONSTRAINT "concept_requirements_requires_id_fkey" FOREIGN KEY ("requires_id") REFERENCES "courses"."concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."concept_dismissals" ADD CONSTRAINT "concept_dismissals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_assumed_concepts" ADD CONSTRAINT "course_assumed_concepts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_assumed_concepts" ADD CONSTRAINT "course_assumed_concepts_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "courses"."concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_concept_overrides" ADD CONSTRAINT "lesson_concept_overrides_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_concept_overrides" ADD CONSTRAINT "lesson_concept_overrides_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "courses"."concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_map_notes" ADD CONSTRAINT "course_map_notes_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_map_notes" ADD CONSTRAINT "course_map_notes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "courses"."curriculum_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_map_dismissals" ADD CONSTRAINT "course_map_dismissals_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_map_analyses" ADD CONSTRAINT "course_map_analyses_curriculum_version_id_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "courses"."curriculum_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

