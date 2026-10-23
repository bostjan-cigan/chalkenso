-- Permissions move from API tokens to users: a token is now a pure credential acting as its owner.
-- Existing tokens are deleted (not backfilled); owners mint a new personal token.

-- UserRole: ADMIN -> SUPERADMIN; EDITOR / VIEWER (unused) -> USER.
CREATE TYPE "public"."UserRole_new" AS ENUM ('SUPERADMIN', 'USER');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."users" ALTER COLUMN "role" TYPE "public"."UserRole_new"
  USING (CASE "role"::text WHEN 'ADMIN' THEN 'SUPERADMIN' ELSE 'USER' END)::"public"."UserRole_new";
DROP TYPE "public"."UserRole";
ALTER TYPE "public"."UserRole_new" RENAME TO "UserRole";
ALTER TABLE "public"."users" ALTER COLUMN "role" SET DEFAULT 'USER';

-- Token grants are gone, and so are the tokens that carried them.
DROP TABLE "public"."api_token_grants";
DELETE FROM "public"."api_tokens";

-- The permission verbs now belong to user grants.
ALTER TYPE "public"."ApiTokenPermission" RENAME TO "Permission";

-- CreateTable
CREATE TABLE "public"."user_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "permissions" "public"."Permission"[],
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_grants_entity_type_entity_id_idx" ON "public"."user_grants"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_grants_user_id_entity_type_entity_id_key" ON "public"."user_grants"("user_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "public"."user_grants" ADD CONSTRAINT "user_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_grants" ADD CONSTRAINT "user_grants_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lesson content revision for sync conflict detection.
ALTER TABLE "courses"."lessons" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
