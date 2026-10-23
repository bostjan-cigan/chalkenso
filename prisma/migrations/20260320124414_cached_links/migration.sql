-- CreateTable
CREATE TABLE "courses"."group_asset_url_cache" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "signed_url" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_asset_url_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_asset_url_cache_asset_id_idx" ON "courses"."group_asset_url_cache"("asset_id");

-- CreateIndex
CREATE INDEX "group_asset_url_cache_expires_at_idx" ON "courses"."group_asset_url_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "group_asset_url_cache_group_id_asset_id_key" ON "courses"."group_asset_url_cache"("group_id", "asset_id");

-- AddForeignKey
ALTER TABLE "courses"."group_asset_url_cache" ADD CONSTRAINT "group_asset_url_cache_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."group_asset_url_cache" ADD CONSTRAINT "group_asset_url_cache_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "courses"."media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
