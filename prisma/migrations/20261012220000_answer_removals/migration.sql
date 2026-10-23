-- CreateTable
CREATE TABLE "courses"."answer_removals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_removals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "answer_removals_course_id_created_at_idx" ON "courses"."answer_removals"("course_id", "created_at");

-- AddForeignKey
ALTER TABLE "courses"."answer_removals" ADD CONSTRAINT "answer_removals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
