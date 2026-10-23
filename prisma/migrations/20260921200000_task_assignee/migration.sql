-- AlterTable: optional assignee (null = unassigned); survives the user's removal.
ALTER TABLE "public"."tasks" ADD COLUMN "assignee_id" TEXT;

-- CreateIndex
CREATE INDEX "tasks_assignee_id_idx" ON "public"."tasks"("assignee_id");

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
