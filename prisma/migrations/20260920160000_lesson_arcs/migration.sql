-- CreateTable
CREATE TABLE "courses"."lesson_arcs" (
    "id" TEXT NOT NULL,
    "curriculum_version_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_arcs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_arcs_curriculum_version_id_position_key"
ON "courses"."lesson_arcs"("curriculum_version_id", "position");

-- CreateIndex
CREATE INDEX "lesson_arcs_curriculum_version_id_idx"
ON "courses"."lesson_arcs"("curriculum_version_id");

-- AlterTable: optional arc assignment on lessons (null = ungrouped, existing behaviour).
ALTER TABLE "courses"."lessons" ADD COLUMN "arc_id" TEXT;

-- CreateIndex
CREATE INDEX "lessons_arc_id_idx" ON "courses"."lessons"("arc_id");

-- AddForeignKey
ALTER TABLE "courses"."lesson_arcs"
    ADD CONSTRAINT "lesson_arcs_curriculum_version_id_fkey"
    FOREIGN KEY ("curriculum_version_id") REFERENCES "courses"."curriculum_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: detaching an arc leaves its lessons in place, ungrouped.
ALTER TABLE "courses"."lessons"
    ADD CONSTRAINT "lessons_arc_id_fkey"
    FOREIGN KEY ("arc_id") REFERENCES "courses"."lesson_arcs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
