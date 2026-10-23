-- AlterTable
ALTER TABLE "public"."user_invites" ADD COLUMN     "teaches_group_id" TEXT;

-- CreateIndex
CREATE INDEX "user_invites_teaches_group_id_idx" ON "public"."user_invites"("teaches_group_id");
