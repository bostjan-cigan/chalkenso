-- AlterTable
ALTER TABLE "courses"."courses" ADD COLUMN     "cover_asset_id" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AddForeignKey
ALTER TABLE "courses"."courses" ADD CONSTRAINT "courses_cover_asset_id_fkey" FOREIGN KEY ("cover_asset_id") REFERENCES "courses"."media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
