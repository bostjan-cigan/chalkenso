-- Publish notifications (webhooks) move to a delivery provider in the hosted edition: one
-- application per organisation, made the first time an owner or admin opens its dashboard, which
-- keeps the endpoints, signing secrets and deliveries. Our own endpoints and secrets go.
ALTER TABLE "public"."organizations" ADD COLUMN "webhooks_app_created_at" TIMESTAMP(3);

DROP TABLE "public"."webhook_endpoints";
