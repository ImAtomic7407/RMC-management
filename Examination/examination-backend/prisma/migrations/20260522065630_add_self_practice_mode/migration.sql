-- CreateTable
CREATE TABLE "practice_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "student_id" INTEGER NOT NULL,
    "practice_question_paper_id" INTEGER NOT NULL,
    "practice_question_paper_version_id" INTEGER NOT NULL,
    "attempt_context" TEXT NOT NULL DEFAULT 'SELF_PRACTICE',
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "counts_for_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "counts_for_official_result" BOOLEAN NOT NULL DEFAULT false,
    "duration_seconds_snapshot" INTEGER,
    "solution_policy_snapshot" TEXT NOT NULL DEFAULT 'AFTER_SUBMIT',
    "started_at" DATETIME NOT NULL,
    "ends_at" DATETIME,
    "submitted_at" DATETIME,
    "last_heartbeat_at" DATETIME,
    "is_auto_submitted" BOOLEAN NOT NULL DEFAULT false,
    "device_id" TEXT,
    "server_time_offset_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "practice_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "practice_attempts_practice_question_paper_id_fkey" FOREIGN KEY ("practice_question_paper_id") REFERENCES "question_papers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "practice_attempts_practice_question_paper_version_id_fkey" FOREIGN KEY ("practice_question_paper_version_id") REFERENCES "question_paper_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "practice_attempt_answers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "practice_attempt_id" INTEGER NOT NULL,
    "version_question_id" INTEGER NOT NULL,
    "selected_option_id" INTEGER,
    "integer_answer" TEXT,
    "is_marked_for_review" BOOLEAN NOT NULL DEFAULT false,
    "saved_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "practice_attempt_answers_practice_attempt_id_fkey" FOREIGN KEY ("practice_attempt_id") REFERENCES "practice_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "practice_attempt_answers_version_question_id_fkey" FOREIGN KEY ("version_question_id") REFERENCES "question_paper_version_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "practice_attempt_answers_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "question_paper_version_options" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "practice_attempt_section_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "practice_attempt_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "score" DECIMAL NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "wrong_count" INTEGER NOT NULL,
    "unattempted_count" INTEGER NOT NULL,
    "max_score" DECIMAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "practice_attempt_section_results_practice_attempt_id_fkey" FOREIGN KEY ("practice_attempt_id") REFERENCES "practice_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "practice_attempt_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "practice_attempt_id" INTEGER NOT NULL,
    "total_score" DECIMAL NOT NULL,
    "max_score" DECIMAL NOT NULL,
    "percentage" DECIMAL NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "wrong_count" INTEGER NOT NULL,
    "unattempted_count" INTEGER NOT NULL,
    "result_released_at" DATETIME,
    "evaluated_question_paper_version_id" INTEGER,
    "evaluated_question_paper_version_number" INTEGER,
    "scoring_source" TEXT DEFAULT 'SELF_PRACTICE_VERSION',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "practice_attempt_results_practice_attempt_id_fkey" FOREIGN KEY ("practice_attempt_id") REFERENCES "practice_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_question_papers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "batch_id" INTEGER,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "instructions" TEXT,
    "is_self_practice_enabled" BOOLEAN NOT NULL DEFAULT false,
    "self_practice_duration_seconds" INTEGER,
    "self_practice_solution_policy" TEXT DEFAULT 'AFTER_SUBMIT',
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "question_papers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "question_papers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_question_papers" ("batch_id", "category", "created_at", "created_by", "id", "instructions", "status", "title", "updated_at") SELECT "batch_id", "category", "created_at", "created_by", "id", "instructions", "status", "title", "updated_at" FROM "question_papers";
DROP TABLE "question_papers";
ALTER TABLE "new_question_papers" RENAME TO "question_papers";
CREATE INDEX "question_papers_created_by_idx" ON "question_papers"("created_by");
CREATE INDEX "question_papers_status_idx" ON "question_papers"("status");
CREATE INDEX "question_papers_batch_id_status_idx" ON "question_papers"("batch_id", "status");
CREATE INDEX "question_papers_is_self_practice_enabled_idx" ON "question_papers"("is_self_practice_enabled");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "practice_attempts_student_id_status_idx" ON "practice_attempts"("student_id", "status");

-- CreateIndex
CREATE INDEX "practice_attempts_student_id_practice_question_paper_id_status_idx" ON "practice_attempts"("student_id", "practice_question_paper_id", "status");

-- CreateIndex
CREATE INDEX "practice_attempts_practice_question_paper_id_created_at_idx" ON "practice_attempts"("practice_question_paper_id", "created_at");

-- CreateIndex
CREATE INDEX "practice_attempts_practice_question_paper_version_id_idx" ON "practice_attempts"("practice_question_paper_version_id");

-- CreateIndex
CREATE INDEX "practice_attempt_answers_practice_attempt_id_version_question_id_idx" ON "practice_attempt_answers"("practice_attempt_id", "version_question_id");

-- CreateIndex
CREATE INDEX "practice_attempt_answers_version_question_id_idx" ON "practice_attempt_answers"("version_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_attempt_answers_practice_attempt_id_version_question_id_key" ON "practice_attempt_answers"("practice_attempt_id", "version_question_id");

-- CreateIndex
CREATE INDEX "practice_attempt_section_results_practice_attempt_id_section_code_idx" ON "practice_attempt_section_results"("practice_attempt_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "practice_attempt_section_results_practice_attempt_id_section_code_key" ON "practice_attempt_section_results"("practice_attempt_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "practice_attempt_results_practice_attempt_id_key" ON "practice_attempt_results"("practice_attempt_id");

-- CreateIndex
CREATE INDEX "practice_attempt_results_practice_attempt_id_idx" ON "practice_attempt_results"("practice_attempt_id");

-- CreateIndex
CREATE INDEX "practice_attempt_results_evaluated_question_paper_version_id_idx" ON "practice_attempt_results"("evaluated_question_paper_version_id");
