-- Sign-up opens (22 Oct 2026): every plan starts with its free first group, and owners can ask for
-- more time on it (Settings → Plan); the request waits on the organisation until the superadmin
-- extends it. Calls are booked from the website, from Bostjan's hours: the usual weekly hours (in the
-- settings table), a week's own hours, a date's own hours, and blocked time.
-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "trial_extension_note" TEXT,
ADD COLUMN     "trial_extension_requested_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."call_bookings" (
    "id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "active_slot" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT,
    "topic" TEXT NOT NULL,
    "message" TEXT,
    "time_zone" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "manage_token_hash" TEXT NOT NULL,
    "rescheduled_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."booking_week_hours" (
    "week_start" DATE NOT NULL,
    "days" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_week_hours_pkey" PRIMARY KEY ("week_start")
);

-- CreateTable
CREATE TABLE "public"."booking_day_hours" (
    "date" DATE NOT NULL,
    "ranges" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_day_hours_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "public"."booking_blocks" (
    "id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_bookings_active_slot_key" ON "public"."call_bookings"("active_slot");

-- CreateIndex
CREATE UNIQUE INDEX "call_bookings_manage_token_hash_key" ON "public"."call_bookings"("manage_token_hash");

-- CreateIndex
CREATE INDEX "call_bookings_starts_at_idx" ON "public"."call_bookings"("starts_at");

-- CreateIndex
CREATE INDEX "call_bookings_email_idx" ON "public"."call_bookings"("email");

-- CreateIndex
CREATE INDEX "booking_blocks_starts_at_idx" ON "public"."booking_blocks"("starts_at");

