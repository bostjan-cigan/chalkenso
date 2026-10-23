-- The waitlist page (SITE_MODE=waitlist): people who asked to hear when Chalkenso opens.
CREATE TABLE "public"."waitlist_signups" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "source" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejoined_at" TIMESTAMP(3),

    CONSTRAINT "waitlist_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waitlist_signups_email_key" ON "public"."waitlist_signups"("email");
CREATE INDEX "waitlist_signups_created_at_idx" ON "public"."waitlist_signups"("created_at");
CREATE INDEX "waitlist_signups_ip_hash_created_at_idx" ON "public"."waitlist_signups"("ip_hash", "created_at");
