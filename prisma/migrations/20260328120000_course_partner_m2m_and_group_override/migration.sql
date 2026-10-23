CREATE TABLE "courses"."course_partners" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "courses"."course_group_partners" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_group_partners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_partners_course_id_partner_id_key"
ON "courses"."course_partners"("course_id", "partner_id");

CREATE INDEX "course_partners_course_id_position_idx"
ON "courses"."course_partners"("course_id", "position");

CREATE INDEX "course_partners_partner_id_idx"
ON "courses"."course_partners"("partner_id");

CREATE UNIQUE INDEX "course_group_partners_group_id_partner_id_key"
ON "courses"."course_group_partners"("group_id", "partner_id");

CREATE INDEX "course_group_partners_group_id_position_idx"
ON "courses"."course_group_partners"("group_id", "position");

CREATE INDEX "course_group_partners_partner_id_idx"
ON "courses"."course_group_partners"("partner_id");

ALTER TABLE "courses"."course_partners"
ADD CONSTRAINT "course_partners_course_id_fkey"
FOREIGN KEY ("course_id") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses"."course_partners"
ADD CONSTRAINT "course_partners_partner_id_fkey"
FOREIGN KEY ("partner_id") REFERENCES "courses"."partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses"."course_group_partners"
ADD CONSTRAINT "course_group_partners_group_id_fkey"
FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses"."course_group_partners"
ADD CONSTRAINT "course_group_partners_partner_id_fkey"
FOREIGN KEY ("partner_id") REFERENCES "courses"."partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "courses"."course_partners" ("id", "course_id", "partner_id", "position", "created_at", "updated_at")
SELECT
    CONCAT('course_partner_backfill_', c."id"),
    c."id",
    c."partner_id",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "courses"."courses" c
WHERE c."partner_id" IS NOT NULL;

ALTER TABLE "courses"."courses" DROP CONSTRAINT "courses_partner_id_fkey";
DROP INDEX "courses"."courses_partner_id_idx";
ALTER TABLE "courses"."courses" DROP COLUMN "partner_id";
