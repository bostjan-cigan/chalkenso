-- DropIndex
DROP INDEX "courses"."lesson_pulses_curriculum_version_id_idx";

-- CreateIndex
CREATE INDEX "courses_cover_asset_id_idx" ON "courses"."courses"("cover_asset_id");

-- CreateIndex
CREATE INDEX "curriculum_comments_member_id_idx" ON "courses"."curriculum_comments"("member_id");

-- CreateIndex
CREATE INDEX "curriculum_comments_author_user_id_idx" ON "courses"."curriculum_comments"("author_user_id");

-- CreateIndex
CREATE INDEX "curriculum_comments_curriculum_version_id_status_created_at_idx" ON "courses"."curriculum_comments"("curriculum_version_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "lesson_pulses_curriculum_version_id_kind_updated_at_idx" ON "courses"."lesson_pulses"("curriculum_version_id", "kind", "updated_at");

-- CreateIndex
CREATE INDEX "lessons_published_asset_bindings_idx" ON "courses"."lessons" USING GIN ("published_asset_bindings" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "connector_calls_created_at_idx" ON "public"."connector_calls"("created_at");

-- CreateIndex
CREATE INDEX "oauth_codes_expires_at_idx" ON "public"."oauth_codes"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_tokens_expires_at_idx" ON "public"."oauth_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "task_comments_author_id_idx" ON "public"."task_comments"("author_id");

-- CreateIndex
CREATE INDEX "tasks_created_by_id_idx" ON "public"."tasks"("created_by_id");

