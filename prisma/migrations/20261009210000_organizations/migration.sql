-- CreateEnum
CREATE TYPE "public"."OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "public"."OrgPlan" AS ENUM ('PILOT', 'TEAM', 'ACADEMY', 'LOCAL');


-- DropIndex
DROP INDEX "courses"."courses_slug_key";

-- AlterTable
ALTER TABLE "courses"."courses" ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "courses"."curriculum_comments" ADD COLUMN     "author_user_id" TEXT;

-- AlterTable
ALTER TABLE "public"."api_tokens" ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "public"."tasks" ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "public"."user_invites" ADD COLUMN     "org_role" "public"."OrgRole" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "public"."user_sessions" ADD COLUMN     "organization_id" TEXT;

-- The personal site's blog and projects are gone with their tables.
DROP TABLE IF EXISTS "public"."asset_references" CASCADE;
DROP TABLE IF EXISTS "public"."public_comments" CASCADE;
DROP TABLE IF EXISTS "public"."tag_links" CASCADE;
DROP TABLE IF EXISTS "public"."tags" CASCADE;
DROP SCHEMA IF EXISTS "content" CASCADE;
DROP TYPE IF EXISTS "public"."ContentStatus";
DROP TYPE IF EXISTS "public"."PublicCommentStatus";
DROP TYPE IF EXISTS "content"."ContentStatus";

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "public"."OrgPlan" NOT NULL DEFAULT 'PILOT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "public"."OrgRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pilot_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "role" TEXT,
    "team_size" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_requests_pkey" PRIMARY KEY ("id")
);

-- Backfill: everything that exists today belongs to one default organisation, and every user is a
-- member of it (super admins as owners).
INSERT INTO "public"."organizations" ("id", "name", "slug", "plan", "updated_at")
SELECT 'org_default', 'Default organisation', 'default', 'PILOT', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "public"."users")
   OR EXISTS (SELECT 1 FROM "courses"."courses")
   OR EXISTS (SELECT 1 FROM "public"."tasks")
   OR EXISTS (SELECT 1 FROM "public"."api_tokens");

INSERT INTO "public"."organization_members" ("id", "organization_id", "user_id", "role", "updated_at")
SELECT 'orgm_' || u."id", 'org_default', u."id",
       CASE WHEN u."role" = 'SUPERADMIN' THEN 'OWNER'::"public"."OrgRole" ELSE 'MEMBER'::"public"."OrgRole" END,
       CURRENT_TIMESTAMP
FROM "public"."users" u;

UPDATE "courses"."courses" SET "organization_id" = 'org_default' WHERE "organization_id" IS NULL;
UPDATE "public"."api_tokens" SET "organization_id" = 'org_default' WHERE "organization_id" IS NULL;
UPDATE "public"."tasks" SET "organization_id" = 'org_default' WHERE "organization_id" IS NULL;
UPDATE "public"."user_invites" SET "organization_id" = 'org_default' WHERE "organization_id" IS NULL;

ALTER TABLE "courses"."courses" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "public"."api_tokens" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "public"."tasks" ALTER COLUMN "organization_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "public"."organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "public"."organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "public"."organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "pilot_requests_created_at_idx" ON "public"."pilot_requests"("created_at");

-- CreateIndex
CREATE INDEX "courses_organization_id_idx" ON "courses"."courses"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_organization_id_slug_key" ON "courses"."courses"("organization_id", "slug");

-- AddForeignKey
ALTER TABLE "public"."api_tokens" ADD CONSTRAINT "api_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_invites" ADD CONSTRAINT "user_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."courses" ADD CONSTRAINT "courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."curriculum_comments" ADD CONSTRAINT "curriculum_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

