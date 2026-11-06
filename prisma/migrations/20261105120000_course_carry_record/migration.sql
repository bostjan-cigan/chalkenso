-- One Publish on a group's copy also changes the main course's lesson: the main course's change
-- records the group copy's change it came from and its text before, so Undo takes both back.

-- AlterTable
ALTER TABLE "courses"."lesson_changes" ADD COLUMN "carried_from_id" TEXT,
ADD COLUMN "text_before" TEXT;

-- CreateIndex
CREATE INDEX "lesson_changes_carried_from_id_idx" ON "courses"."lesson_changes"("carried_from_id");
