-- CreateEnum
CREATE TYPE "public"."ApiTokenPermission" AS ENUM ('READ', 'WRITE');

-- CreateTable: table-agnostic API tokens (entity bound by type + id, no hard FK to the protected row).
CREATE TABLE "public"."api_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "permissions" "public"."ApiTokenPermission"[],
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "public"."api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_entity_type_entity_id_idx" ON "public"."api_tokens"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "api_tokens_revoked_at_idx" ON "public"."api_tokens"("revoked_at");

-- AddForeignKey: keep the token if its creating admin is removed.
ALTER TABLE "public"."api_tokens" ADD CONSTRAINT "api_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
