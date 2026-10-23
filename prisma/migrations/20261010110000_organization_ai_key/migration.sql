-- An organisation's own Anthropic API key (bring your own key), encrypted at rest
ALTER TABLE "public"."organizations" ADD COLUMN "ai_api_key_encrypted" TEXT,
ADD COLUMN "ai_api_key_hint" TEXT;
