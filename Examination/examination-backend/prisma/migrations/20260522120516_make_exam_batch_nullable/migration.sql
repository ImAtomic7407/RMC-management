-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_exams" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "batch_id" INTEGER,
    "question_paper_id" INTEGER,
    "question_paper_version_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "exam_mode" TEXT NOT NULL DEFAULT 'LIVE',
    "duration_seconds" INTEGER NOT NULL,
    "instructions" TEXT,
    "solution_release_policy" TEXT NOT NULL,
    "exam_date_time" DATETIME,
    "published_at" DATETIME,
    "closed_at" DATETIME,
    "result_released_at" DATETIME,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exams_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exams_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_question_paper_id_fkey" FOREIGN KEY ("question_paper_id") REFERENCES "question_papers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_question_paper_version_id_fkey" FOREIGN KEY ("question_paper_version_id") REFERENCES "question_paper_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_exams" ("batch_id", "closed_at", "created_at", "created_by", "duration_seconds", "exam_date_time", "exam_mode", "id", "instructions", "published_at", "question_paper_id", "question_paper_version_id", "result_released_at", "solution_release_policy", "status", "title", "updated_at", "updated_by") SELECT "batch_id", "closed_at", "created_at", "created_by", "duration_seconds", "exam_date_time", "exam_mode", "id", "instructions", "published_at", "question_paper_id", "question_paper_version_id", "result_released_at", "solution_release_policy", "status", "title", "updated_at", "updated_by" FROM "exams";
DROP TABLE "exams";
ALTER TABLE "new_exams" RENAME TO "exams";
CREATE INDEX "exams_batch_id_status_idx" ON "exams"("batch_id", "status");
CREATE INDEX "exams_status_exam_date_time_idx" ON "exams"("status", "exam_date_time");
CREATE INDEX "exams_created_by_created_at_idx" ON "exams"("created_by", "created_at");
CREATE INDEX "exams_question_paper_id_idx" ON "exams"("question_paper_id");
CREATE INDEX "exams_question_paper_version_id_idx" ON "exams"("question_paper_version_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
