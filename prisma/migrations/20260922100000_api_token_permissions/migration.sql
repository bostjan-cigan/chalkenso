-- AlterEnum
-- Kept in its own migration: PostgreSQL cannot use a newly added enum value in the same
-- transaction, and the next migration backfills grants with these values.
ALTER TYPE "public"."ApiTokenPermission" ADD VALUE 'DELETE';
ALTER TYPE "public"."ApiTokenPermission" ADD VALUE 'TASKS';
