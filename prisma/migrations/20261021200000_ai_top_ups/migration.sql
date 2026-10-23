-- Top-ups: AI bought on top of a plan's included AI, at Anthropic's prices (Settings → AI). A hosted
-- call made once the month's included AI ran out is paid from them (from_top_up); what's left is the
-- top-ups bought less those calls. A test checkout stands in for paying until Paddle (payment_ref null).
ALTER TABLE "public"."ai_usage" ADD COLUMN     "from_top_up" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."ai_top_ups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "bought_by_id" TEXT,
    "payment_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_top_ups_organization_id_created_at_idx" ON "public"."ai_top_ups"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."ai_top_ups" ADD CONSTRAINT "ai_top_ups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

