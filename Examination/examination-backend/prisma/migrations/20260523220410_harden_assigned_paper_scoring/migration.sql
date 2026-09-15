-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_attempt_answers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attempt_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "assigned_question_id" INTEGER,
    "version_question_id" INTEGER,
    "selected_option_id" INTEGER,
    "integer_answer" TEXT,
    "is_marked_for_review" BOOLEAN NOT NULL DEFAULT false,
    "saved_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attempt_answers_assigned_question_id_fkey" FOREIGN KEY ("assigned_question_id") REFERENCES "student_exam_paper_questions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "attempt_answers_version_question_id_fkey" FOREIGN KEY ("version_question_id") REFERENCES "question_paper_version_questions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "attempt_answers_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "question_options" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_attempt_answers" ("attempt_id", "created_at", "id", "integer_answer", "is_marked_for_review", "question_id", "saved_at", "selected_option_id", "updated_at") SELECT "attempt_id", "created_at", "id", "integer_answer", "is_marked_for_review", "question_id", "saved_at", "selected_option_id", "updated_at" FROM "attempt_answers";
DROP TABLE "attempt_answers";
ALTER TABLE "new_attempt_answers" RENAME TO "attempt_answers";
CREATE INDEX "attempt_answers_attempt_id_question_id_idx" ON "attempt_answers"("attempt_id", "question_id");
CREATE INDEX "attempt_answers_question_id_idx" ON "attempt_answers"("question_id");
CREATE INDEX "attempt_answers_assigned_question_id_idx" ON "attempt_answers"("assigned_question_id");
CREATE INDEX "attempt_answers_version_question_id_idx" ON "attempt_answers"("version_question_id");
CREATE UNIQUE INDEX "attempt_answers_attempt_id_question_id_key" ON "attempt_answers"("attempt_id", "question_id");
CREATE TABLE "new_attempt_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attempt_id" INTEGER NOT NULL,
    "assigned_paper_instance_id" INTEGER,
    "total_score" DECIMAL NOT NULL,
    "max_score" DECIMAL NOT NULL,
    "percentage" DECIMAL NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "wrong_count" INTEGER NOT NULL,
    "unattempted_count" INTEGER NOT NULL,
    "rank_exam" INTEGER,
    "rank_batch" INTEGER,
    "rank_overall" INTEGER,
    "result_released_at" DATETIME,
    "evaluated_question_paper_version_id" INTEGER,
    "evaluated_question_paper_version_number" INTEGER,
    "scoring_source" TEXT DEFAULT 'LEGACY_EXAM_QUESTIONS',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "attempt_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attempt_results_assigned_paper_instance_id_fkey" FOREIGN KEY ("assigned_paper_instance_id") REFERENCES "student_exam_paper_instances" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_attempt_results" ("attempt_id", "correct_count", "created_at", "evaluated_question_paper_version_id", "evaluated_question_paper_version_number", "id", "max_score", "percentage", "rank_batch", "rank_exam", "rank_overall", "result_released_at", "scoring_source", "total_score", "unattempted_count", "updated_at", "wrong_count") SELECT "attempt_id", "correct_count", "created_at", "evaluated_question_paper_version_id", "evaluated_question_paper_version_number", "id", "max_score", "percentage", "rank_batch", "rank_exam", "rank_overall", "result_released_at", "scoring_source", "total_score", "unattempted_count", "updated_at", "wrong_count" FROM "attempt_results";
DROP TABLE "attempt_results";
ALTER TABLE "new_attempt_results" RENAME TO "attempt_results";
CREATE UNIQUE INDEX "attempt_results_attempt_id_key" ON "attempt_results"("attempt_id");
CREATE INDEX "attempt_results_rank_exam_idx" ON "attempt_results"("rank_exam");
CREATE INDEX "attempt_results_rank_batch_idx" ON "attempt_results"("rank_batch");
CREATE INDEX "attempt_results_rank_overall_idx" ON "attempt_results"("rank_overall");
CREATE INDEX "attempt_results_attempt_id_idx" ON "attempt_results"("attempt_id");
CREATE INDEX "attempt_results_evaluated_question_paper_version_id_idx" ON "attempt_results"("evaluated_question_paper_version_id");
CREATE INDEX "attempt_results_assigned_paper_instance_id_idx" ON "attempt_results"("assigned_paper_instance_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
