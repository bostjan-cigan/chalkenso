-- Partners belong to an organisation, like courses: each organisation has its own list, and names
-- are unique within it.

-- DropIndex
DROP INDEX "courses"."partners_name_key";

-- AlterTable
ALTER TABLE "courses"."partners" ADD COLUMN     "organization_id" TEXT;

-- Backfill: every organisation whose courses use a partner (as a course partner, a group partner
-- or the course's join button).
CREATE TEMPORARY TABLE "partner_organizations" AS
SELECT DISTINCT p."id" AS "partner_id", c."organization_id"
FROM "courses"."partners" p
JOIN "courses"."courses" c ON c."join_partner_id" = p."id"
  OR EXISTS (
    SELECT 1 FROM "courses"."course_partners" cp WHERE cp."partner_id" = p."id" AND cp."course_id" = c."id"
  )
  OR EXISTS (
    SELECT 1 FROM "courses"."course_group_partners" gp
    JOIN "courses"."course_groups" g ON g."id" = gp."group_id"
    WHERE gp."partner_id" = p."id" AND g."course_id" = c."id"
  );

-- The partner stays with the first of those organisations ...
UPDATE "courses"."partners" p
SET "organization_id" = (
  SELECT min(po."organization_id") FROM "partner_organizations" po WHERE po."partner_id" = p."id"
);

-- ... unused partners go to the default organisation when there is one, and are dropped otherwise.
UPDATE "courses"."partners"
SET "organization_id" = 'org_default'
WHERE "organization_id" IS NULL
  AND EXISTS (SELECT 1 FROM "public"."organizations" WHERE "id" = 'org_default');

DELETE FROM "courses"."partners" WHERE "organization_id" IS NULL;

-- Every other organisation that used a partner gets its own copy, and its courses and groups point
-- at that copy.
INSERT INTO "courses"."partners" ("id", "organization_id", "name", "website_url", "logo_url", "description", "created_at", "updated_at")
SELECT p."id" || '_' || po."organization_id", po."organization_id", p."name", p."website_url", p."logo_url", p."description", p."created_at", CURRENT_TIMESTAMP
FROM "partner_organizations" po
JOIN "courses"."partners" p ON p."id" = po."partner_id"
WHERE po."organization_id" <> p."organization_id";

UPDATE "courses"."course_partners" cp
SET "partner_id" = cp."partner_id" || '_' || c."organization_id"
FROM "courses"."courses" c, "courses"."partners" p
WHERE c."id" = cp."course_id" AND p."id" = cp."partner_id" AND p."organization_id" <> c."organization_id";

UPDATE "courses"."course_group_partners" gp
SET "partner_id" = gp."partner_id" || '_' || c."organization_id"
FROM "courses"."course_groups" g, "courses"."courses" c, "courses"."partners" p
WHERE g."id" = gp."group_id" AND c."id" = g."course_id" AND p."id" = gp."partner_id"
  AND p."organization_id" <> c."organization_id";

UPDATE "courses"."courses" c
SET "join_partner_id" = c."join_partner_id" || '_' || c."organization_id"
FROM "courses"."partners" p
WHERE p."id" = c."join_partner_id" AND p."organization_id" <> c."organization_id";

DROP TABLE "partner_organizations";

ALTER TABLE "courses"."partners" ALTER COLUMN "organization_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "partners_organization_id_name_key" ON "courses"."partners"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "courses"."partners" ADD CONSTRAINT "partners_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
