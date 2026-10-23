-- AlterTable
ALTER TABLE "courses"."lessons" ADD COLUMN     "published_asset_bindings" JSONB,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_html_source_hash" VARCHAR(64),
ADD COLUMN     "published_markdown_content" TEXT,
ADD COLUMN     "published_rendered_html" TEXT,
ADD COLUMN     "published_revision" INTEGER,
ADD COLUMN     "published_short_description" TEXT,
ADD COLUMN     "published_title" TEXT;


-- Backfill: keep what learners see today. Every lesson that is currently visible to learners (it is
-- PUBLISHED, or it belongs to a PUBLISHED version — lesson status was not enforced before) gets its
-- current text as the published snapshot and is marked PUBLISHED.
UPDATE "courses"."lessons" AS l
SET
  "published_at" = CURRENT_TIMESTAMP,
  "published_revision" = l."revision",
  "published_title" = l."title",
  "published_short_description" = l."short_description",
  "published_markdown_content" = l."markdown_content",
  "published_asset_bindings" = COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object('sourcePath', r."source_path", 'assetId', r."asset_id") ORDER BY r."position")
      FROM "courses"."lesson_asset_references" AS r
      WHERE r."lesson_id" = l."id" AND r."asset_id" IS NOT NULL
    ),
    '[]'::jsonb
  ),
  "published_rendered_html" = l."access_rendered_html",
  "published_html_source_hash" = l."access_html_source_hash",
  "status" = 'PUBLISHED'
WHERE l."status" = 'PUBLISHED'
   OR l."curriculum_version_id" IN (
     SELECT v."id" FROM "courses"."curriculum_versions" AS v WHERE v."status" = 'PUBLISHED'
   );
