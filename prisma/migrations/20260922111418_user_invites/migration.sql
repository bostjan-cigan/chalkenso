-- CreateTable
CREATE TABLE "public"."user_invites" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',
    "grants" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "claimed_user_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_invites_token_hash_key" ON "public"."user_invites"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_invites_claimed_user_id_key" ON "public"."user_invites"("claimed_user_id");

-- CreateIndex
CREATE INDEX "user_invites_created_at_idx" ON "public"."user_invites"("created_at");

-- AddForeignKey
ALTER TABLE "public"."user_invites" ADD CONSTRAINT "user_invites_claimed_user_id_fkey" FOREIGN KEY ("claimed_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_invites" ADD CONSTRAINT "user_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
