-- CreateTable: private, learner-only notes on a lesson passage. Separate from
-- courses.curriculum_comments on purpose — no admin surface may reach this table.
CREATE TABLE "courses"."lesson_notes" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "member_id" TEXT,
    "access_link_id" TEXT,
    "selected_text" TEXT NOT NULL,
    "context" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the owner-scoped read (member first; the link is only the no-member fallback).
CREATE INDEX "lesson_notes_member_id_lesson_id_idx" ON "courses"."lesson_notes"("member_id", "lesson_id");

-- CreateIndex: the no-member fallback read.
CREATE INDEX "lesson_notes_access_link_id_lesson_id_idx" ON "courses"."lesson_notes"("access_link_id", "lesson_id");

-- CreateIndex: standalone, so the lesson FK's ON DELETE CASCADE doesn't seq-scan.
CREATE INDEX "lesson_notes_lesson_id_idx" ON "courses"."lesson_notes"("lesson_id");

-- AddForeignKey
ALTER TABLE "courses"."lesson_notes" ADD CONSTRAINT "lesson_notes_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
