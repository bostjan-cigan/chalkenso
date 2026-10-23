-- One save can finish several improvements on a lesson (the lesson's Improvements view): a change
-- per improvement, so (lesson, revision) is no longer unique.
DROP INDEX "courses"."lesson_changes_lesson_id_revision_key";

CREATE INDEX "lesson_changes_lesson_id_revision_idx" ON "courses"."lesson_changes"("lesson_id", "revision");
