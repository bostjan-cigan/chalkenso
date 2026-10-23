-- CreateEnum
CREATE TYPE "courses"."CurriculumVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "courses"."curriculum_versions" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "courses"."CurriculumVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_versions_course_id_version_key"
ON "courses"."curriculum_versions"("course_id", "version");

-- CreateIndex
CREATE INDEX "curriculum_versions_course_id_idx"
ON "courses"."curriculum_versions"("course_id");

-- Backfill: give every existing course a single published v1.
INSERT INTO "courses"."curriculum_versions"
    ("id", "course_id", "label", "version", "status", "published_at", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    c."id",
    'v1',
    1,
    'PUBLISHED',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "courses"."courses" AS c;

-- AlterTable: add nullable version columns (backfilled below).
ALTER TABLE "courses"."lessons" ADD COLUMN "curriculum_version_id" TEXT;
ALTER TABLE "courses"."course_groups" ADD COLUMN "curriculum_version_id" TEXT;
ALTER TABLE "courses"."access_links" ADD COLUMN "curriculum_version_id" TEXT;

-- Backfill lessons -> their course's v1.
UPDATE "courses"."lessons" AS l
SET "curriculum_version_id" = v."id"
FROM "courses"."curriculum_versions" AS v
WHERE v."course_id" = l."course_id" AND v."version" = 1;

-- Backfill course groups -> their course's v1.
UPDATE "courses"."course_groups" AS g
SET "curriculum_version_id" = v."id"
FROM "courses"."curriculum_versions" AS v
WHERE v."course_id" = g."course_id" AND v."version" = 1;

-- Backfill access links -> v1 of the link's owning course (group link or member -> group).
UPDATE "courses"."access_links" AS al
SET "curriculum_version_id" = v."id"
FROM "courses"."course_groups" AS g
JOIN "courses"."curriculum_versions" AS v
    ON v."course_id" = g."course_id" AND v."version" = 1
WHERE al."group_id" = g."id";

UPDATE "courses"."access_links" AS al
SET "curriculum_version_id" = v."id"
FROM "courses"."course_group_members" AS m
JOIN "courses"."course_groups" AS g ON g."id" = m."group_id"
JOIN "courses"."curriculum_versions" AS v
    ON v."course_id" = g."course_id" AND v."version" = 1
WHERE al."member_id" = m."id" AND al."curriculum_version_id" IS NULL;

-- Enforce NOT NULL on lessons now that they are backfilled.
ALTER TABLE "courses"."lessons" ALTER COLUMN "curriculum_version_id" SET NOT NULL;

-- Swap lesson uniqueness from course-scoped to version-scoped.
DROP INDEX "courses"."lessons_course_id_slug_key";
DROP INDEX "courses"."lessons_course_id_position_key";

CREATE UNIQUE INDEX "lessons_curriculum_version_id_slug_key"
ON "courses"."lessons"("curriculum_version_id", "slug");

CREATE UNIQUE INDEX "lessons_curriculum_version_id_position_key"
ON "courses"."lessons"("curriculum_version_id", "position");

-- CreateIndex
CREATE INDEX "lessons_curriculum_version_id_idx"
ON "courses"."lessons"("curriculum_version_id");

CREATE INDEX "course_groups_curriculum_version_id_idx"
ON "courses"."course_groups"("curriculum_version_id");

CREATE INDEX "access_links_curriculum_version_id_idx"
ON "courses"."access_links"("curriculum_version_id");

-- AddForeignKey
ALTER TABLE "courses"."curriculum_versions"
    ADD CONSTRAINT "curriculum_versions_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"."courses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses"."lessons"
    ADD CONSTRAINT "lessons_curriculum_version_id_fkey"
    FOREIGN KEY ("curriculum_version_id") REFERENCES "courses"."curriculum_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses"."course_groups"
    ADD CONSTRAINT "course_groups_curriculum_version_id_fkey"
    FOREIGN KEY ("curriculum_version_id") REFERENCES "courses"."curriculum_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "courses"."access_links"
    ADD CONSTRAINT "access_links_curriculum_version_id_fkey"
    FOREIGN KEY ("curriculum_version_id") REFERENCES "courses"."curriculum_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
