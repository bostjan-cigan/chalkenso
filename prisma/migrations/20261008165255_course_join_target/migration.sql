-- CreateEnum
CREATE TYPE "courses"."CourseJoinTarget" AS ENUM ('LINKEDIN', 'PARTNER', 'LINK');

-- AlterTable
ALTER TABLE "courses"."courses" ADD COLUMN     "join_partner_id" TEXT,
ADD COLUMN     "join_target" "courses"."CourseJoinTarget" NOT NULL DEFAULT 'LINKEDIN',
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "courses"."courses" ADD CONSTRAINT "courses_join_partner_id_fkey" FOREIGN KEY ("join_partner_id") REFERENCES "courses"."partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
