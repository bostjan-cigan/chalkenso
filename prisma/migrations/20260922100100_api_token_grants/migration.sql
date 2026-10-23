-- CreateTable
CREATE TABLE "public"."api_token_grants" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "permissions" "public"."ApiTokenPermission"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_token_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_token_grants_entity_type_entity_id_idx" ON "public"."api_token_grants"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_token_grants_token_id_entity_type_entity_id_key" ON "public"."api_token_grants"("token_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "public"."api_token_grants" ADD CONSTRAINT "api_token_grants_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing tokens get full access to everything.
INSERT INTO "public"."api_token_grants" ("id", "token_id", "entity_type", "entity_id", "permissions")
SELECT gen_random_uuid()::text, "id", 'all', '*', ARRAY['READ', 'WRITE', 'DELETE', 'TASKS']::"public"."ApiTokenPermission"[]
FROM "public"."api_tokens";

-- Backfill: curriculum-version tokens also keep an explicit grant on their version, which is the
-- version sync requests default to when they don't name one (the plugin never has).
INSERT INTO "public"."api_token_grants" ("id", "token_id", "entity_type", "entity_id", "permissions")
SELECT gen_random_uuid()::text, "id", 'curriculum_version', "entity_id", ARRAY['READ', 'WRITE', 'DELETE', 'TASKS']::"public"."ApiTokenPermission"[]
FROM "public"."api_tokens"
WHERE "entity_type" = 'curriculum_version';

-- Ownership: the creator becomes the owner; tokens without one fall back to the oldest admin.
ALTER TABLE "public"."api_tokens" DROP CONSTRAINT "api_tokens_created_by_id_fkey";
ALTER TABLE "public"."api_tokens" RENAME COLUMN "created_by_id" TO "owner_id";
UPDATE "public"."api_tokens"
SET "owner_id" = (
    SELECT "id" FROM "public"."users" WHERE "role" = 'ADMIN' ORDER BY "created_at" ASC LIMIT 1
)
WHERE "owner_id" IS NULL;
ALTER TABLE "public"."api_tokens" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "public"."api_tokens" ADD CONSTRAINT "api_tokens_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "api_tokens_owner_id_idx" ON "public"."api_tokens"("owner_id");

-- DropIndex
DROP INDEX "public"."api_tokens_entity_type_entity_id_idx";

-- AlterTable
ALTER TABLE "public"."api_tokens" DROP COLUMN "entity_id",
DROP COLUMN "entity_type",
DROP COLUMN "permissions";
