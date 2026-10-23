-- Site keys: what an API token may do. Existing tokens are Obsidian sync tokens.
ALTER TABLE "public"."api_tokens" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY['sync']::TEXT[];

-- Publish notifications for an organisation's website.
CREATE TABLE "public"."webhook_endpoints" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_status" INTEGER,
    "last_error" TEXT,
    "last_delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_endpoints_organization_id_idx" ON "public"."webhook_endpoints"("organization_id");

ALTER TABLE "public"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
