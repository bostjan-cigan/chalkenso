-- The language of a course's learner pages (English until set in the course's settings); a learner's
-- own pick in the language menu wins over it.
ALTER TABLE "courses"."courses" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
