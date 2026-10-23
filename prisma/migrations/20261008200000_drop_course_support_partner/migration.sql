-- DropForeignKey
ALTER TABLE "courses"."courses" DROP CONSTRAINT "courses_support_partner_id_fkey";

-- AlterTable
ALTER TABLE "courses"."courses" DROP COLUMN "support_partner_id";
