-- Pausing between classes (docs/plans/2026-10-18-pause.md): a plan status of its own, when the pause
-- began, and the plan and billing that resuming returns to.

-- AlterEnum
ALTER TYPE "public"."PlanStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "resume_interval" "public"."BillingInterval",
ADD COLUMN     "resume_plan" "public"."OrgPlan";
