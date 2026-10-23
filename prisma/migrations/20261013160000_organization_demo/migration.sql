-- Demo organisations: fictional content with a login to share, which the superadmin can reset to
-- the demo or delete.
-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;
