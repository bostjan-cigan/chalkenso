-- The language someone picked while signed in (null until they pick one): the app follows it on a
-- browser without its own pick, and emails to them use it.
ALTER TABLE "public"."users" ADD COLUMN "locale" TEXT;
