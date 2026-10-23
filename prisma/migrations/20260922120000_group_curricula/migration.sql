-- AlterTable
ALTER TABLE "courses"."course_groups" ADD COLUMN     "feedback_driven" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "courses"."curriculum_versions" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "base_version_id" TEXT,
ADD COLUMN     "owner_group_id" TEXT;

-- AlterTable
ALTER TABLE "courses"."lessons" ADD COLUMN     "base_lesson_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_versions_owner_group_id_key" ON "courses"."curriculum_versions"("owner_group_id");

-- AddForeignKey
ALTER TABLE "courses"."curriculum_versions" ADD CONSTRAINT "curriculum_versions_owner_group_id_fkey" FOREIGN KEY ("owner_group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."curriculum_versions" ADD CONSTRAINT "curriculum_versions_base_version_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "courses"."curriculum_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

