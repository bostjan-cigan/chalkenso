-- Closing the loop: when a learner (and a teammate, for instructor notes) last saw what happened to
-- their feedback, so their next visit says what changed or got a reply since. Starts at now: nothing
-- earlier floods in.

-- AlterTable
ALTER TABLE "courses"."course_group_members" ADD COLUMN "outcomes_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN "notes_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
