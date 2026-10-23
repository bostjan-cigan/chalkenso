-- Drafts by task: an improvement's page and the Improvements list find the drafts made for it.

-- CreateIndex
CREATE INDEX "ai_proposals_task_id_idx" ON "public"."ai_proposals"("task_id");
