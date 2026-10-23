-- AlterTable
ALTER TABLE "courses"."lessons" ADD COLUMN     "access_rendered_html" TEXT,
ADD COLUMN     "access_html_source_hash" VARCHAR(64);
