-- The days people used the app, for the superadmin's activity charts.
-- CreateTable
CREATE TABLE "public"."user_activity_days" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_days_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateIndex
CREATE INDEX "user_activity_days_day_idx" ON "public"."user_activity_days"("day");

-- What is known from before: the days people signed in as themselves, and their last sign-in.
INSERT INTO "public"."user_activity_days" ("user_id", "day")
SELECT DISTINCT "user_id", "created_at"::date FROM "public"."user_sessions" WHERE "impersonator_id" IS NULL
UNION
SELECT DISTINCT "user_id", "last_seen_at"::date FROM "public"."user_sessions" WHERE "impersonator_id" IS NULL AND "last_seen_at" IS NOT NULL
UNION
SELECT "id", "last_login_at"::date FROM "public"."users" WHERE "last_login_at" IS NOT NULL
ON CONFLICT DO NOTHING;
