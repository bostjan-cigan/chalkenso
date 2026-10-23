-- AlterTable
ALTER TABLE "public"."tasks" ADD COLUMN     "plan" TEXT,
ADD COLUMN     "plan_updated_at" TIMESTAMP(3);
