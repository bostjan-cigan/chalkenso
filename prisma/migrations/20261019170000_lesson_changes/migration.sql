-- What a save of a lesson did (proposed changes applied, an improvement finished): the feedback it
-- answers, marked done once that revision reaches learners.

-- CreateTable
CREATE TABLE "courses"."lesson_changes" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "task_id" TEXT,
    "proposal_ids" TEXT[],
    "comment_ids" TEXT[],
    "applied" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "settled_at" TIMESTAMP(3),
    "resolved_comment_ids" TEXT[],
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_changes_task_id_idx" ON "courses"."lesson_changes"("task_id");

-- CreateIndex
CREATE INDEX "lesson_changes_lesson_id_settled_at_idx" ON "courses"."lesson_changes"("lesson_id", "settled_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_changes_lesson_id_revision_key" ON "courses"."lesson_changes"("lesson_id", "revision");

-- AddForeignKey
ALTER TABLE "courses"."lesson_changes" ADD CONSTRAINT "lesson_changes_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
