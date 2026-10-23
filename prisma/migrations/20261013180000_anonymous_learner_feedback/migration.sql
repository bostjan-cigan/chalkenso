-- Learners are never named to the team: their feedback, and the tasks made from it, show
-- "A learner · <group>" instead of the learner's name, so instructors read what was written rather
-- than who wrote it. Instructor notes (author_user_id set) keep their author. Replies still reach the
-- learner through their access link.
UPDATE "courses"."curriculum_comments" c
SET "proposer_name" = COALESCE(
  'A learner · ' || (SELECT g."name" FROM "courses"."course_groups" g WHERE g."id" = c."group_id"),
  'A learner'
)
WHERE c."author_user_id" IS NULL;

-- Tasks made from a learner's feedback carry the same label.
UPDATE "public"."tasks" t
SET "proposer_name" = c."proposer_name"
FROM "public"."task_entity_links" l
JOIN "courses"."curriculum_comments" c ON c."id" = l."entity_id"
WHERE l."task_id" = t."id"
  AND l."entity_type" = 'curriculum_comment'
  AND c."author_user_id" IS NULL;

-- Core proposals copied the group task's proposer: follow them to it.
UPDATE "public"."tasks" t
SET "proposer_name" = s."proposer_name"
FROM "public"."task_entity_links" l
JOIN "public"."tasks" s ON s."id" = l."entity_id"
WHERE l."task_id" = t."id"
  AND l."entity_type" = 'task'
  AND l."role" = 'source'
  AND EXISTS (
    SELECT 1
    FROM "public"."task_entity_links" sl
    JOIN "courses"."curriculum_comments" c ON c."id" = sl."entity_id"
    WHERE sl."task_id" = s."id" AND sl."entity_type" = 'curriculum_comment' AND c."author_user_id" IS NULL
  );
