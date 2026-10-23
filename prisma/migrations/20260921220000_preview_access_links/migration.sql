-- AlterTable: shareable draft preview links (optionally one-time) on access_links.
ALTER TABLE "courses"."access_links"
  ADD COLUMN "is_preview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "label" TEXT,
  ADD COLUMN "one_time" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "claimed_at" TIMESTAMP(3),
  ADD COLUMN "claim_secret_hash" TEXT;

-- CreateIndex
CREATE INDEX "access_links_is_preview_curriculum_version_id_idx" ON "courses"."access_links"("is_preview", "curriculum_version_id");
