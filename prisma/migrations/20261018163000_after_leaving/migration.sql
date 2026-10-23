-- After an organisation stops paying (the cloud edition's plans): the notices its owners were sent,
-- one per kind and per time it left, so the daily job sends each once however often it runs.
CREATE TABLE "public"."leaving_notices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "left_at" TIMESTAMP(3) NOT NULL,
    "for_date" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaving_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leaving_notices_organization_id_kind_left_at_key" ON "public"."leaving_notices"("organization_id", "kind", "left_at");

-- AddForeignKey
ALTER TABLE "public"."leaving_notices" ADD CONSTRAINT "leaving_notices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
