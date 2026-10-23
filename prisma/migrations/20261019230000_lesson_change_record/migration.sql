-- What each improvement's save changed, so finished improvements can show it ("What changed").
ALTER TABLE "courses"."lesson_changes" ADD COLUMN "changes" JSONB;
