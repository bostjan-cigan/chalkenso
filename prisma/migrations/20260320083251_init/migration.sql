-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "courses";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website_url" TEXT,
    "logo_url" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "partner_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."lessons" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "markdown_content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."media_assets" (
    "id" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT,
    "bytes" INTEGER,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "alt_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."lesson_asset_references" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "source_path" TEXT NOT NULL,
    "alt_text" TEXT,
    "position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_asset_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."course_groups" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "source_roster_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."course_group_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."access_links" (
    "id" TEXT NOT NULL,
    "group_id" TEXT,
    "member_id" TEXT,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_identifier_key" ON "public"."users"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_token_hash_key" ON "public"."user_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "public"."user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "public"."user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "partners_name_key" ON "courses"."partners"("name");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"."courses"("slug");

-- CreateIndex
CREATE INDEX "courses_partner_id_idx" ON "courses"."courses"("partner_id");

-- CreateIndex
CREATE INDEX "lessons_course_id_idx" ON "courses"."lessons"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_course_id_slug_key" ON "courses"."lessons"("course_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_course_id_position_key" ON "courses"."lessons"("course_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_r2_key_key" ON "courses"."media_assets"("r2_key");

-- CreateIndex
CREATE INDEX "lesson_asset_references_asset_id_idx" ON "courses"."lesson_asset_references"("asset_id");

-- CreateIndex
CREATE INDEX "lesson_asset_references_lesson_id_position_idx" ON "courses"."lesson_asset_references"("lesson_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_asset_references_lesson_id_source_path_key" ON "courses"."lesson_asset_references"("lesson_id", "source_path");

-- CreateIndex
CREATE INDEX "course_groups_course_id_idx" ON "courses"."course_groups"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_groups_course_id_slug_key" ON "courses"."course_groups"("course_id", "slug");

-- CreateIndex
CREATE INDEX "course_group_members_group_id_idx" ON "courses"."course_group_members"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_group_members_group_id_position_key" ON "courses"."course_group_members"("group_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "access_links_token_key" ON "courses"."access_links"("token");

-- CreateIndex
CREATE INDEX "access_links_group_id_idx" ON "courses"."access_links"("group_id");

-- CreateIndex
CREATE INDEX "access_links_member_id_idx" ON "courses"."access_links"("member_id");

-- CreateIndex
CREATE INDEX "access_links_expires_at_idx" ON "courses"."access_links"("expires_at");

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."courses" ADD CONSTRAINT "courses_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "courses"."partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lessons" ADD CONSTRAINT "lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_asset_references" ADD CONSTRAINT "lesson_asset_references_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "courses"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."lesson_asset_references" ADD CONSTRAINT "lesson_asset_references_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "courses"."media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_groups" ADD CONSTRAINT "course_groups_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_group_members" ADD CONSTRAINT "course_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."access_links" ADD CONSTRAINT "access_links_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."access_links" ADD CONSTRAINT "access_links_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "courses"."course_group_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
