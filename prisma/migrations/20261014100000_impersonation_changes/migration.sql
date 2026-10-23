-- What platform admins change while logged in as someone, for the admin log.
-- CreateTable
CREATE TABLE "public"."impersonation_changes" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "path" TEXT,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "record_id" TEXT,
    "label" TEXT,
    "fields" TEXT[],
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impersonation_changes_session_id_created_at_idx" ON "public"."impersonation_changes"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "impersonation_changes_created_at_idx" ON "public"."impersonation_changes"("created_at");
