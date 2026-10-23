-- Sessions end after a while without activity (expires_at, moved on by each visit) and at the latest at
-- max_expires_at; "Keep me signed in" (persistent) chooses the longer limits.
ALTER TABLE "public"."user_sessions"
  ADD COLUMN "max_expires_at" TIMESTAMP(3),
  ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ended_reason" TEXT,
  ADD COLUMN "user_agent" TEXT,
  ADD COLUMN "location" TEXT;

-- Open sessions keep the 30 days they were given; they were all kept-signed-in sessions, except "log in as".
UPDATE "public"."user_sessions" SET "max_expires_at" = "expires_at", "persistent" = ("impersonator_id" IS NULL);

ALTER TABLE "public"."user_sessions" ALTER COLUMN "max_expires_at" SET NOT NULL;

-- "Sign out" from the Team page: sessions started before it can't work in that organisation.
ALTER TABLE "public"."organization_members" ADD COLUMN "signed_out_at" TIMESTAMP(3);

-- "Sign out of all devices" forgets every remembered browser by moving this on.
ALTER TABLE "public"."users" ADD COLUMN "known_browsers_version" INTEGER NOT NULL DEFAULT 0;

-- "Keep me signed in" carried through the two-factor step.
ALTER TABLE "public"."admin_totp_login_challenges" ADD COLUMN "remember" BOOLEAN NOT NULL DEFAULT false;
