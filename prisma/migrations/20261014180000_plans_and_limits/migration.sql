-- CreateEnum
CREATE TYPE "public"."PlanStatus" AS ENUM ('TRIAL', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."OrgPlan" ADD VALUE 'SOLO';
ALTER TYPE "public"."OrgPlan" ADD VALUE 'STUDIO';

-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "billing_exempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billing_interval" "public"."BillingInterval" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "co_teacher" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extra_classes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "founding_price" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "free_classes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "free_seats" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "period_ends_at" TIMESTAMP(3),
ADD COLUMN     "plan_status" "public"."PlanStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "unlimited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."plan_changes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_changes_organization_id_created_at_idx" ON "public"."plan_changes"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."plan_changes" ADD CONSTRAINT "plan_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every organisation that exists before plans start counting keeps working as it did: unlimited and
-- never asked to pay, until the superadmin sets its plan.
UPDATE "public"."organizations" SET "unlimited" = true, "billing_exempt" = true;
