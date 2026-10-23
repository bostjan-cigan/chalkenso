-- A group's feedback, newest first by status (its Feedback tab, the groups list, Home).
CREATE INDEX "curriculum_comments_group_id_status_created_at_idx" ON "courses"."curriculum_comments"("group_id", "status", "created_at");

-- The groups' copies of a course lesson (its editor shows their open feedback).
CREATE INDEX "lessons_base_lesson_id_idx" ON "courses"."lessons"("base_lesson_id");
