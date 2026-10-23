-- Organisation lifecycle: who created an organisation (self-created ones count towards a person's cap),
-- and the indexes that deleting an organisation needs (each cascade used to scan its whole table).
-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "created_by_id" TEXT;

-- CreateIndex
CREATE INDEX "answer_removals_organization_id_idx" ON "courses"."answer_removals"("organization_id");

-- CreateIndex
CREATE INDEX "feedback_setting_changes_organization_id_idx" ON "courses"."feedback_setting_changes"("organization_id");

-- CreateIndex
CREATE INDEX "lesson_taught_lesson_id_idx" ON "courses"."lesson_taught"("lesson_id");

-- CreateIndex
CREATE INDEX "api_tokens_organization_id_idx" ON "public"."api_tokens"("organization_id");

-- CreateIndex
CREATE INDEX "oauth_codes_organization_id_idx" ON "public"."oauth_codes"("organization_id");

-- CreateIndex
CREATE INDEX "organizations_created_by_id_idx" ON "public"."organizations"("created_by_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_idx" ON "public"."tasks"("organization_id");

-- CreateIndex
CREATE INDEX "user_invites_organization_id_idx" ON "public"."user_invites"("organization_id");

-- CreateIndex
CREATE INDEX "user_sessions_organization_id_idx" ON "public"."user_sessions"("organization_id");

