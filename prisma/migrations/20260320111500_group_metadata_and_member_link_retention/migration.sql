-- AlterTable
ALTER TABLE "courses"."course_groups"
ADD COLUMN "slack_handle" TEXT,
ADD COLUMN "description" TEXT;

-- DropForeignKey
ALTER TABLE "courses"."access_links"
DROP CONSTRAINT "access_links_member_id_fkey";

-- AddForeignKey
ALTER TABLE "courses"."access_links"
ADD CONSTRAINT "access_links_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "courses"."course_group_members"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
