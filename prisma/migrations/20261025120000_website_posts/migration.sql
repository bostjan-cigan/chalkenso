-- Website posts: a site's briefs, in Markdown, each with its own address, state and public date.
-- An edition without a website leaves the table empty.

-- CreateEnum
CREATE TYPE "public"."WebsitePostStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "public"."website_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta_title" TEXT,
    "cta_text" TEXT,
    "status" "public"."WebsitePostStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_posts_status_published_at_idx" ON "public"."website_posts"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "website_posts_slug_locale_key" ON "public"."website_posts"("slug", "locale");
