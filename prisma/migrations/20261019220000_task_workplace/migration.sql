-- Where an improvement is worked on (the app or the Obsidian vault), so the vault's checklist leaves
-- out what someone is doing in the browser.
CREATE TYPE "public"."TaskWorkplace" AS ENUM ('APP', 'VAULT');

ALTER TABLE "public"."tasks" ADD COLUMN "workplace" "public"."TaskWorkplace";
