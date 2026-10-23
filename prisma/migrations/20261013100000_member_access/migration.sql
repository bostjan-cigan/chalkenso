-- CreateEnum
CREATE TYPE "public"."MemberAccess" AS ENUM ('FULL', 'LIMITED');

-- AlterTable
ALTER TABLE "courses"."curriculum_comments" ADD COLUMN     "group_id" TEXT;

-- AlterTable
ALTER TABLE "public"."organization_members" ADD COLUMN     "access" "public"."MemberAccess" NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "public"."user_invites" ADD COLUMN     "access" "public"."MemberAccess" NOT NULL DEFAULT 'FULL';

-- CreateIndex
CREATE INDEX "curriculum_comments_group_id_idx" ON "courses"."curriculum_comments"("group_id");

-- AddForeignKey
ALTER TABLE "courses"."curriculum_comments" ADD CONSTRAINT "curriculum_comments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Today's rule ("a member with grant rows gets exactly those") made explicit. Owners and admins
-- always have full access now, whatever rows they have.
UPDATE "public"."organization_members" m SET "access" = 'LIMITED'
 WHERE m."role" = 'MEMBER' AND EXISTS (
   SELECT 1 FROM "public"."user_grants" g
    WHERE g."user_id" = m."user_id" AND g."organization_id" = m."organization_id");

-- Which group each comment came from: the learner's roster entry, their group link, the roster entry
-- behind a personal link, or the group curriculum it was written on.
UPDATE "courses"."curriculum_comments" c SET "group_id" = m."group_id"
  FROM "courses"."course_group_members" m
 WHERE c."member_id" = m."id" AND c."group_id" IS NULL;
UPDATE "courses"."curriculum_comments" c SET "group_id" = l."group_id"
  FROM "courses"."access_links" l
 WHERE c."access_link_id" = l."id" AND l."group_id" IS NOT NULL AND c."group_id" IS NULL;
UPDATE "courses"."curriculum_comments" c SET "group_id" = m."group_id"
  FROM "courses"."access_links" l JOIN "courses"."course_group_members" m ON m."id" = l."member_id"
 WHERE c."access_link_id" = l."id" AND c."group_id" IS NULL;
UPDATE "courses"."curriculum_comments" c SET "group_id" = v."owner_group_id"
  FROM "courses"."curriculum_versions" v
 WHERE c."curriculum_version_id" = v."id" AND v."owner_group_id" IS NOT NULL AND c."group_id" IS NULL;

-- Which group each task is about: the group of the comment it came from, or the group curriculum it
-- revises.
INSERT INTO "public"."task_entity_links" ("id", "task_id", "entity_type", "entity_id", "role", "created_at")
SELECT md5(random()::text || clock_timestamp()::text || s."task_id" || s."group_id"), s."task_id", 'course_group', s."group_id", 'subject', now()
  FROM (
    SELECT l."task_id", c."group_id"
      FROM "public"."task_entity_links" l
      JOIN "courses"."curriculum_comments" c ON l."entity_type" = 'curriculum_comment' AND c."id" = l."entity_id"
     WHERE c."group_id" IS NOT NULL
    UNION
    SELECT l."task_id", v."owner_group_id"
      FROM "public"."task_entity_links" l
      JOIN "courses"."curriculum_versions" v ON l."entity_type" = 'curriculum_version' AND v."id" = l."entity_id"
     WHERE v."owner_group_id" IS NOT NULL
  ) s
ON CONFLICT ("task_id", "entity_type", "entity_id", "role") DO NOTHING;
