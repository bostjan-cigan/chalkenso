-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_secret_enc" TEXT,
ADD COLUMN     "totp_pending_secret_enc" TEXT;

-- CreateTable
CREATE TABLE "public"."admin_totp_login_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_totp_login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_totp_login_challenges_token_hash_key" ON "public"."admin_totp_login_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "admin_totp_login_challenges_user_id_idx" ON "public"."admin_totp_login_challenges"("user_id");

-- CreateIndex
CREATE INDEX "admin_totp_login_challenges_expires_at_idx" ON "public"."admin_totp_login_challenges"("expires_at");

-- AddForeignKey
ALTER TABLE "public"."admin_totp_login_challenges" ADD CONSTRAINT "admin_totp_login_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
