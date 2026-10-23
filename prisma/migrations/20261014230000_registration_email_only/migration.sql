-- AlterTable
ALTER TABLE "public"."registrations" ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "handle" DROP NOT NULL,
ALTER COLUMN "organization_name" DROP NOT NULL,
ALTER COLUMN "organization_handle" DROP NOT NULL;
