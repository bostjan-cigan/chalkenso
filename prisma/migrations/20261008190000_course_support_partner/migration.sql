-- AlterTable
ALTER TABLE "courses"."courses" ADD COLUMN     "support_partner_id" TEXT;

-- AddForeignKey
ALTER TABLE "courses"."courses" ADD CONSTRAINT "courses_support_partner_id_fkey" FOREIGN KEY ("support_partner_id") REFERENCES "courses"."partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
