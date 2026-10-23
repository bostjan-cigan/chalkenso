-- The old waitlist (registrations replaced it; nobody signed up). Refuses, and stops the deploy, if
-- anyone is on it after all: export them first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."waitlist_signups") THEN
    RAISE EXCEPTION 'waitlist_signups is not empty: export it before dropping the table';
  END IF;
END $$;

-- DropTable
DROP TABLE "public"."waitlist_signups";
