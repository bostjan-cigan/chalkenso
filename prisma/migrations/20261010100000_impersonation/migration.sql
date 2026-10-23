-- "Log in as": a platform admin's session as another user, and a log of what platform admins did.
ALTER TABLE "public"."user_sessions" ADD COLUMN "impersonator_id" TEXT;
CREATE INDEX "user_sessions_impersonator_id_idx" ON "public"."user_sessions"("impersonator_id");
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_impersonator_id_fkey" FOREIGN KEY ("impersonator_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."platform_audit_events" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_user_id" TEXT,
    "target_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_events_created_at_idx" ON "public"."platform_audit_events"("created_at");
