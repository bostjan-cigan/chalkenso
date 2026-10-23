-- Better Auth (src/lib/auth.ts) takes over signing in and sessions: its tables, its fields on users,
-- the passwords moved to its accounts (same scrypt format), and everyone signs in once more.


-- DropForeignKey
ALTER TABLE "admin_totp_login_challenges" DROP CONSTRAINT "admin_totp_login_challenges_user_id_fkey";

-- DropForeignKey
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_fkey";

-- AlterTable
ALTER TABLE "public"."user_sessions" ALTER COLUMN "session_token_hash" DROP NOT NULL;

-- DropTable
DROP TABLE "admin_totp_login_challenges";

-- DropTable
DROP TABLE "password_reset_tokens";

-- CreateTable
CREATE TABLE "public"."auth_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_expires_at" TIMESTAMP(3) NOT NULL,
    "persistent" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "organization_id" TEXT,
    "impersonated_by" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_accounts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "password" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_two_factors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failed_verification_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "auth_two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "public"."auth_sessions"("token");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "public"."auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_accounts_user_id_idx" ON "public"."auth_accounts"("user_id");

-- CreateIndex
CREATE INDEX "auth_verifications_identifier_idx" ON "public"."auth_verifications"("identifier");

-- CreateIndex
CREATE INDEX "auth_two_factors_user_id_idx" ON "public"."auth_two_factors"("user_id");

-- CreateIndex
CREATE INDEX "auth_two_factors_secret_idx" ON "public"."auth_two_factors"("secret");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "public"."auth_rate_limits"("key");

-- AddForeignKey
ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."auth_two_factors" ADD CONSTRAINT "auth_two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "ban_expires" TIMESTAMP(3),
ADD COLUMN     "ban_reason" TEXT,
ADD COLUMN     "banned" BOOLEAN DEFAULT false,
ADD COLUMN     "display_username" TEXT,
ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';


-- Passwords move to Better Auth's "credential" accounts, unchanged (src/lib/security.ts verifies them).
INSERT INTO "public"."auth_accounts" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at")
SELECT 'cred_' || "id", "id", 'credential', "id", "password_hash", "created_at", now() FROM "public"."users";

-- Better Auth signs in by email: an account whose sign-in name is an email (and has none) gets it as its email.
UPDATE "public"."users" u SET "email" = lower(u."identifier")
WHERE u."email" IS NULL AND u."identifier" LIKE '%@%'
  AND NOT EXISTS (SELECT 1 FROM "public"."users" o WHERE lower(o."email") = lower(u."identifier"));

-- Its display name and username as typed, and a switched-off account as its ban.
UPDATE "public"."users" SET
  "name" = COALESCE(NULLIF(TRIM(CONCAT_WS(' ', "first_name", "last_name")), ''), "identifier"),
  "display_username" = "identifier",
  "banned" = NOT "is_active";

-- Two-factor set up before can't move: Better Auth reads its secrets as text, ours are random bytes.
-- It goes off (or they'd be locked out) and they set it up again; the old secrets stay until then.
UPDATE "public"."users" SET "totp_enabled" = false WHERE "totp_enabled" = true;

-- Sessions from before end: Better Auth's are new (its history stays in user_sessions).
UPDATE "public"."user_sessions" SET "revoked_at" = now(), "ended_reason" = 'signout' WHERE "revoked_at" IS NULL;

ALTER TABLE "public"."users" DROP COLUMN "password_hash";
