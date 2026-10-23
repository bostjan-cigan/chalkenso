-- An improvement's notes for AI: the instructor's own words about the change (who the group is, what
-- to keep, what to avoid), kept on it. Planning and drafting in the app use them, and the connector
-- and the sync API send them to Claude and the vault. Its own column: a task's description can hold
-- the first feedback's words, copied there by an earlier way of making improvements.
ALTER TABLE "public"."tasks" ADD COLUMN "ai_notes" TEXT;
