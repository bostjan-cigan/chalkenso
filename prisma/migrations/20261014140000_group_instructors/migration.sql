-- CreateTable
CREATE TABLE "courses"."course_group_instructors" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_group_instructors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_group_instructors_user_id_idx" ON "courses"."course_group_instructors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_group_instructors_group_id_user_id_key" ON "courses"."course_group_instructors"("group_id", "user_id");

-- AddForeignKey
ALTER TABLE "courses"."course_group_instructors" ADD CONSTRAINT "course_group_instructors_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "courses"."course_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."course_group_instructors" ADD CONSTRAINT "course_group_instructors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
