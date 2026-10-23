
-- CreateIndex
CREATE INDEX "media_assets_checksum_idx" ON "courses"."media_assets"("checksum");

-- CreateIndex
CREATE INDEX "entries_cover_asset_id_idx" ON "content"."entries"("cover_asset_id");
