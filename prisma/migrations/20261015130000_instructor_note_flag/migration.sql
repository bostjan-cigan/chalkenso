-- Instructor notes stay notes when their author's account is deleted (which clears author_user_id).
ALTER TABLE "courses"."curriculum_comments" ADD COLUMN "is_instructor_note" BOOLEAN NOT NULL DEFAULT false;

UPDATE "courses"."curriculum_comments" SET "is_instructor_note" = true WHERE "author_user_id" IS NOT NULL;
