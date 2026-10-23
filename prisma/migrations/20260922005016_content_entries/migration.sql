-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "content";

-- CreateEnum
CREATE TYPE "content"."ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "content"."PublicCommentStatus" AS ENUM ('PENDING', 'APPROVED', 'SPAM');

-- CreateTable
CREATE TABLE "content"."entries" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "markdown_content" TEXT NOT NULL,
    "rendered_html" TEXT NOT NULL,
    "render_hash" TEXT NOT NULL,
    "reading_minutes" INTEGER NOT NULL DEFAULT 1,
    "status" "content"."ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "cover_asset_id" TEXT,
    "canonical_url" TEXT,
    "position" INTEGER,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tag_links" (
    "id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asset_references" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "source_path" TEXT NOT NULL,
    "alt_text" TEXT,
    "position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."public_comments" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT,
    "body" TEXT NOT NULL,
    "status" "content"."PublicCommentStatus" NOT NULL DEFAULT 'PENDING',
    "admin_response" TEXT,
    "admin_responded_at" TIMESTAMP(3),
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entries_kind_status_published_at_idx" ON "content"."entries"("kind", "status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "entries_kind_slug_key" ON "content"."entries"("kind", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "public"."tags"("slug");

-- CreateIndex
CREATE INDEX "tag_links_entity_type_entity_id_idx" ON "public"."tag_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_links_tag_id_entity_type_entity_id_key" ON "public"."tag_links"("tag_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "asset_references_asset_id_idx" ON "public"."asset_references"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_references_entity_type_entity_id_source_path_key" ON "public"."asset_references"("entity_type", "entity_id", "source_path");

-- CreateIndex
CREATE INDEX "public_comments_entity_type_entity_id_status_idx" ON "public"."public_comments"("entity_type", "entity_id", "status");

-- CreateIndex
CREATE INDEX "public_comments_status_created_at_idx" ON "public"."public_comments"("status", "created_at");

-- CreateIndex
CREATE INDEX "public_comments_ip_hash_created_at_idx" ON "public"."public_comments"("ip_hash", "created_at");

-- AddForeignKey
ALTER TABLE "content"."entries" ADD CONSTRAINT "entries_cover_asset_id_fkey" FOREIGN KEY ("cover_asset_id") REFERENCES "courses"."media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tag_links" ADD CONSTRAINT "tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asset_references" ADD CONSTRAINT "asset_references_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "courses"."media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
