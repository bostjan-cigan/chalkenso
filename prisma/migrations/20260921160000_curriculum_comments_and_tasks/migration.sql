-- CreateEnum
CREATE TYPE "courses"."CurriculumCommentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'IGNORED');

-- CreateTable: feedback left by an individual access-link holder on a lesson (marked passage + message).
CREATE TABLE "courses"."curriculum_comments" (
    "id" TEXT NOT NULL,
    "curriculum_version_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "access_link_id" TEXT,
    "member_id" TEXT,
    "proposer_name" TEXT NOT NULL,
    "selected_text" TEXT NOT NULL,
    "context" TEXT,
    "body" TEXT NOT NULL,
    "admin_response" TEXT,
    "admin_responded_at" TIMESTAMP(3),
    "status" "courses"."CurriculumCommentStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: table-agnostic CRM task (no per-kind columns; relations live in task_entity_links).
CREATE TABLE "public"."tasks" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'TODO',
    "proposer_name" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one polymorphic task<->entity relation (entity bound by type + id, no hard FK).
CREATE TABLE "public"."task_entity_links" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'subject',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_entity_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "curriculum_comments_lesson_id_idx" ON "courses"."curriculum_comments"("lesson_id");

-- CreateIndex
CREATE INDEX "curriculum_comments_curriculum_version_id_idx" ON "courses"."curriculum_comments"("curriculum_version_id");

-- CreateIndex
CREATE INDEX "curriculum_comments_access_link_id_idx" ON "courses"."curriculum_comments"("access_link_id");

-- CreateIndex
CREATE INDEX "curriculum_comments_status_idx" ON "courses"."curriculum_comments"("status");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "public"."tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_kind_idx" ON "public"."tasks"("kind");

-- CreateIndex
CREATE INDEX "task_entity_links_entity_type_entity_id_idx" ON "public"."task_entity_links"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "task_entity_links_task_id_idx" ON "public"."task_entity_links"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_entity_links_task_id_entity_type_entity_id_role_key" ON "public"."task_entity_links"("task_id", "entity_type", "entity_id", "role");

-- AddForeignKey
ALTER TABLE "courses"."curriculum_comments" ADD CONSTRAINT "curriculum_comments_curriculum_version_id_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "courses"."curriculum_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."curriculum_comments" ADD CONSTRAINT "curriculum_comments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: keep the comment if its originating link is removed.
ALTER TABLE "courses"."curriculum_comments" ADD CONSTRAINT "curriculum_comments_access_link_id_fkey" FOREIGN KEY ("access_link_id") REFERENCES "courses"."access_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: keep the comment if the proposing member is removed.
ALTER TABLE "courses"."curriculum_comments" ADD CONSTRAINT "curriculum_comments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "courses"."course_group_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: keep the task if its creating admin is removed.
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_entity_links" ADD CONSTRAINT "task_entity_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
