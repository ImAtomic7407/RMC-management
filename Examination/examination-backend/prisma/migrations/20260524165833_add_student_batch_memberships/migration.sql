-- CreateTable
CREATE TABLE "student_batch_memberships" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "student_id" INTEGER NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "student_batch_memberships_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_batch_memberships_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "student_batch_memberships_batch_id_idx" ON "student_batch_memberships"("batch_id");

-- CreateIndex
CREATE INDEX "student_batch_memberships_student_id_idx" ON "student_batch_memberships"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_batch_memberships_student_id_batch_id_key" ON "student_batch_memberships"("student_id", "batch_id");
