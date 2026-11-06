-- An improvement's thread: each AI attempt keeps what the person asked for in their own words and
-- the attempt it goes on from, so revising works as a conversation and earlier attempts stay.

-- AlterTable
ALTER TABLE "public"."ai_proposals" ADD COLUMN "request" TEXT,
ADD COLUMN "continues_id" TEXT;

-- CreateIndex
CREATE INDEX "ai_proposals_continues_id_idx" ON "public"."ai_proposals"("continues_id");

-- AddForeignKey
ALTER TABLE "public"."ai_proposals" ADD CONSTRAINT "ai_proposals_continues_id_fkey" FOREIGN KEY ("continues_id") REFERENCES "public"."ai_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
