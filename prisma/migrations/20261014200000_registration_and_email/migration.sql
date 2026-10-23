-- AlterTable
ALTER TABLE "public"."user_invites" ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "handle" TEXT;

-- AlterTable
ALTER TABLE "public"."waitlist_signups" ADD COLUMN     "invited_to_register_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."registrations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "organization_handle" TEXT NOT NULL,
    "plan" "public"."OrgPlan" NOT NULL DEFAULT 'SOLO',
    "role" TEXT,
    "source" TEXT,
    "ip_hash" TEXT,
    "confirm_token_hash" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "finish_token_hash" TEXT,
    "finish_expires_at" TIMESTAMP(3),
    "invited_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "user_id" TEXT,
    "organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registrations_email_key" ON "public"."registrations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_handle_key" ON "public"."registrations"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_organization_handle_key" ON "public"."registrations"("organization_handle");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_confirm_token_hash_key" ON "public"."registrations"("confirm_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_finish_token_hash_key" ON "public"."registrations"("finish_token_hash");

-- CreateIndex
CREATE INDEX "registrations_created_at_idx" ON "public"."registrations"("created_at");

-- CreateIndex
CREATE INDEX "registrations_ip_hash_created_at_idx" ON "public"."registrations"("ip_hash", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "public"."password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "public"."password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "public"."users"("handle");

-- AddForeignKey
ALTER TABLE "public"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

