-- Tags become terms of a taxonomy (WordPress-style). Existing rows are the "tag" taxonomy via the
-- column default; the Prisma models are renamed (Tag → Term, TagLink → TermLink), tables are kept.

-- DropIndex: a slug is now unique per taxonomy ("rust" can be both a tag and a platform).
DROP INDEX "public"."tags_slug_key";

-- AlterTable
ALTER TABLE "public"."tags" ADD COLUMN     "meta" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "taxonomy" TEXT NOT NULL DEFAULT 'tag';

-- CreateIndex
CREATE UNIQUE INDEX "tags_taxonomy_slug_key" ON "public"."tags"("taxonomy", "slug");
