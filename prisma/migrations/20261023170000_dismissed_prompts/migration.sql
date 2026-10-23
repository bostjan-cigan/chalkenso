-- "Don't show this again": the prompts each person asked never to see again, by key (src/lib/prompts.ts).
ALTER TABLE "public"."users" ADD COLUMN     "dismissed_prompts" TEXT[] DEFAULT ARRAY[]::TEXT[];
