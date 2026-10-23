-- CreateEnum
CREATE TYPE "courses"."PulseKind" AS ENUM ('EXPLAIN', 'CHECK');

-- CreateEnum
CREATE TYPE "courses"."PulseAnswer" AS ENUM ('YES', 'NOT_YET', 'NOT_READ', 'DISMISSED');

-- CreateEnum
CREATE TYPE "courses"."SurveyKind" AS ENUM ('MID', 'END');

-- CreateEnum
CREATE TYPE "courses"."TaughtVerdict" AS ENUM ('SMOOTH', 'RAN_LONG', 'LOST_THEM');

-- CreateEnum
CREATE TYPE "public"."TermReportStatus" AS ENUM ('DRAFT', 'FINAL');

-- AlterTable
ALTER TABLE "courses"."course_group_members" ADD COLUMN     "reading_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "courses"."course_groups" ADD COLUMN     "class_note" TEXT,
ADD COLUMN     "class_note_at" TIMESTAMP(3),
ADD COLUMN     "feedback_settings" JSONB,
ADD COLUMN     "mid_survey_closed_at" TIMESTAMP(3),
ADD COLUMN     "mid_survey_opened_at" TIMESTAMP(3),
ADD COLUMN     "survey_extra_question" JSONB,
ADD COLUMN     "survey_opened_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "courses"."courses" ADD COLUMN     "feedback_settings" JSONB,
ADD COLUMN     "survey_extra_question" JSONB;

-- AlterTable
ALTER TABLE "courses"."curriculum_comments" ADD COLUMN     "lesson_revision" INTEGER,
ADD COLUMN     "resolved_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "courses"."lesson_publications" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "markdown_content" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."lesson_pulses" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "curriculum_version_id" TEXT NOT NULL,
    "group_id" TEXT,
    "member_id" TEXT,
    "access_link_id" TEXT,
    "revision" INTEGER NOT NULL,
    "kind" "courses"."PulseKind" NOT NULL DEFAULT 'EXPLAIN',
    "answer" "courses"."PulseAnswer",
    "option_index" INTEGER,
    "not_sure" BOOLEAN NOT NULL DEFAULT false,
    "correct" BOOLEAN,
    "section_index" INTEGER,
    "section_title" TEXT,
    "note" TEXT,
    "delayed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'link',
    "question_set" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_pulses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."lesson_checks" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "approved_revision" INTEGER,
    "approved_at" TIMESTAMP(3),
    "drafted_by" TEXT NOT NULL DEFAULT 'instructor',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."lesson_reading_sessions" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "group_id" TEXT,
    "session_key" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'link',
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "section_count" INTEGER NOT NULL DEFAULT 0,
    "furthest_section" INTEGER NOT NULL DEFAULT 0,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "section_seconds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "section_reached" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "section_rereads" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "section_ai_asks" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "section_copies" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_reading_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."course_survey_responses" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "curriculum_version_id" TEXT NOT NULL,
    "member_id" TEXT,
    "access_link_id" TEXT,
    "kind" "courses"."SurveyKind" NOT NULL DEFAULT 'END',
    "score" INTEGER NOT NULL,
    "improve_lesson_id" TEXT,
    "improve_none" BOOLEAN NOT NULL DEFAULT false,
    "answer_prompt" TEXT,
    "answer" TEXT,
    "quote_consent" BOOLEAN NOT NULL DEFAULT false,
    "named" BOOLEAN NOT NULL DEFAULT false,
    "extra_question" JSONB,
    "extra_answer" TEXT,
    "check_answers" JSONB,
    "source" TEXT NOT NULL DEFAULT 'link',
    "question_set" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."lesson_taught" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "taught_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" "courses"."TaughtVerdict",
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_taught_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."feedback_setting_changes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "group_id" TEXT,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_setting_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."term_reports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "scope" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "summary" TEXT,
    "themes" JSONB,
    "status" "public"."TermReportStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT,
    "share_token_hash" TEXT,
    "share_expires_at" TIMESTAMP(3),
    "share_revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "term_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_publications_lesson_id_published_at_idx" ON "courses"."lesson_publications"("lesson_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_publications_lesson_id_revision_key" ON "courses"."lesson_publications"("lesson_id", "revision");

-- CreateIndex
CREATE INDEX "lesson_pulses_curriculum_version_id_idx" ON "courses"."lesson_pulses"("curriculum_version_id");

-- CreateIndex
CREATE INDEX "lesson_pulses_group_id_idx" ON "courses"."lesson_pulses"("group_id");

-- CreateIndex
CREATE INDEX "lesson_pulses_member_id_idx" ON "courses"."lesson_pulses"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_pulses_lesson_id_member_id_revision_key" ON "courses"."lesson_pulses"("lesson_id", "member_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_checks_lesson_id_key" ON "courses"."lesson_checks"("lesson_id");

-- CreateIndex
CREATE INDEX "lesson_reading_sessions_lesson_id_revision_idx" ON "courses"."lesson_reading_sessions"("lesson_id", "revision");

-- CreateIndex
CREATE INDEX "lesson_reading_sessions_group_id_idx" ON "courses"."lesson_reading_sessions"("group_id");

-- CreateIndex
CREATE INDEX "lesson_reading_sessions_day_idx" ON "courses"."lesson_reading_sessions"("day");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_reading_sessions_lesson_id_session_key_key" ON "courses"."lesson_reading_sessions"("lesson_id", "session_key");

-- CreateIndex
CREATE INDEX "course_survey_responses_course_id_idx" ON "courses"."course_survey_responses"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_survey_responses_group_id_member_id_kind_key" ON "courses"."course_survey_responses"("group_id", "member_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_taught_group_id_lesson_id_key" ON "courses"."lesson_taught"("group_id", "lesson_id");

-- CreateIndex
CREATE INDEX "feedback_setting_changes_course_id_created_at_idx" ON "courses"."feedback_setting_changes"("course_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "term_reports_share_token_hash_key" ON "public"."term_reports"("share_token_hash");

-- CreateIndex
CREATE INDEX "term_reports_organization_id_created_at_idx" ON "public"."term_reports"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "courses"."lesson_publications" ADD CONSTRAINT "lesson_publications_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_pulses" ADD CONSTRAINT "lesson_pulses_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_checks" ADD CONSTRAINT "lesson_checks_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_reading_sessions" ADD CONSTRAINT "lesson_reading_sessions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_survey_responses" ADD CONSTRAINT "course_survey_responses_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_taught" ADD CONSTRAINT "lesson_taught_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_taught" ADD CONSTRAINT "lesson_taught_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."feedback_setting_changes" ADD CONSTRAINT "feedback_setting_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."term_reports" ADD CONSTRAINT "term_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: resolved feedback gets its best known resolution time.
UPDATE "courses"."curriculum_comments" SET "resolved_at" = "updated_at" WHERE "status" = 'RESOLVED' AND "resolved_at" IS NULL;

-- Backfill: every lesson published today starts its publication history with that snapshot.
INSERT INTO "courses"."lesson_publications" ("id", "lesson_id", "revision", "title", "markdown_content", "published_at")
SELECT 'pub_' || "id", "id", COALESCE("published_revision", "revision"), COALESCE("published_title", "title"),
       COALESCE("published_markdown_content", "markdown_content"), "published_at"
FROM "courses"."lessons"
WHERE "published_at" IS NOT NULL
ON CONFLICT DO NOTHING;
