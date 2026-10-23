-- AlterEnum
ALTER TYPE "public"."Permission" ADD VALUE 'NOTES';

-- AlterTable
ALTER TABLE "courses"."access_links" ADD COLUMN     "instructor_user_id" TEXT;

-- CreateIndex
CREATE INDEX "access_links_instructor_user_id_idx" ON "courses"."access_links"("instructor_user_id");

-- AddForeignKey
ALTER TABLE "courses"."access_links" ADD CONSTRAINT "access_links_instructor_user_id_fkey" FOREIGN KEY ("instructor_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
