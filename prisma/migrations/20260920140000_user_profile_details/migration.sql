-- AlterEnum: add future roles
ALTER TYPE "public"."UserRole" ADD VALUE IF NOT EXISTS 'EDITOR';
ALTER TYPE "public"."UserRole" ADD VALUE IF NOT EXISTS 'VIEWER';

-- AlterTable: profile contact fields
ALTER TABLE "public"."users" ADD COLUMN "email" TEXT;
ALTER TABLE "public"."users" ADD COLUMN "first_name" TEXT;
ALTER TABLE "public"."users" ADD COLUMN "last_name" TEXT;

-- CreateIndex: unique email (multiple NULLs allowed in Postgres)
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");
