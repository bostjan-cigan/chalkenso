-- CreateEnum
CREATE TYPE "public"."OAuthClientKind" AS ENUM ('CIMD', 'DCR');

-- CreateEnum
CREATE TYPE "public"."OAuthTokenKind" AS ENUM ('ACCESS', 'REFRESH');

-- CreateEnum
CREATE TYPE "public"."AiProposalKind" AS ENUM ('LESSON_REVISION', 'TASK_PLAN', 'CHECK_QUESTION', 'REPORT_SUMMARY', 'FEEDBACK_THEMES');

-- CreateEnum
CREATE TYPE "public"."AiProposalStatus" AS ENUM ('PENDING', 'WORKING', 'OPEN', 'USED', 'DISCARDED');

-- DropIndex
DROP INDEX "user_grants_user_id_entity_type_entity_id_key";

-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "ai_api_key_checked_at" TIMESTAMP(3),
ADD COLUMN     "ai_api_key_invalid_at" TIMESTAMP(3),
ADD COLUMN     "ai_api_key_set_by_id" TEXT,
ADD COLUMN     "ai_hosted_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ai_hosted_monthly_cap_cents" INTEGER,
ADD COLUMN     "connector_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."platform_audit_events" ADD COLUMN     "detail" JSONB;

-- AlterTable
ALTER TABLE "public"."term_reports" ADD COLUMN     "created_via" TEXT NOT NULL DEFAULT 'app';

-- AlterTable
ALTER TABLE "public"."user_grants" ADD COLUMN     "organization_id" TEXT;

-- CreateTable
CREATE TABLE "public"."ai_usage" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_clients" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "public"."OAuthClientKind" NOT NULL,
    "redirect_uris" TEXT[],
    "fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connector_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" "public"."OAuthTokenKind" NOT NULL,
    "connection_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connector_calls" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ok" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "public"."AiProposalKind" NOT NULL,
    "status" "public"."AiProposalStatus" NOT NULL DEFAULT 'OPEN',
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "base_revision" INTEGER,
    "payload" JSONB,
    "summary" TEXT,
    "via" TEXT NOT NULL DEFAULT 'connector',
    "task_id" TEXT,
    "created_by_id" TEXT,
    "assignee_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_organization_id_source_created_at_idx" ON "public"."ai_usage"("organization_id", "source", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "public"."oauth_clients"("client_id");

-- CreateIndex
CREATE INDEX "connector_connections_user_id_idx" ON "public"."connector_connections"("user_id");

-- CreateIndex
CREATE INDEX "connector_connections_organization_id_idx" ON "public"."connector_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_codes_code_hash_key" ON "public"."oauth_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "public"."oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_connection_id_idx" ON "public"."oauth_tokens"("connection_id");

-- CreateIndex
CREATE INDEX "connector_calls_organization_id_created_at_idx" ON "public"."connector_calls"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "connector_calls_user_id_created_at_idx" ON "public"."connector_calls"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_proposals_organization_id_status_idx" ON "public"."ai_proposals"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ai_proposals_target_type_target_id_idx" ON "public"."ai_proposals"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "user_grants_organization_id_user_id_idx" ON "public"."user_grants"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_grants_user_id_organization_id_entity_type_entity_id_key" ON "public"."user_grants"("user_id", "organization_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "public"."user_grants" ADD CONSTRAINT "user_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_usage" ADD CONSTRAINT "ai_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_connections" ADD CONSTRAINT "connector_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_connections" ADD CONSTRAINT "connector_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_connections" ADD CONSTRAINT "connector_connections_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_codes" ADD CONSTRAINT "oauth_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_calls" ADD CONSTRAINT "connector_calls_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_proposals" ADD CONSTRAINT "ai_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_proposals" ADD CONSTRAINT "ai_proposals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_proposals" ADD CONSTRAINT "ai_proposals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_proposals" ADD CONSTRAINT "ai_proposals_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

