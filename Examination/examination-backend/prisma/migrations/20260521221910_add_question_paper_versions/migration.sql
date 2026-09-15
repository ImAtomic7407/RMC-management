-- CreateTable
CREATE TABLE "question_papers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "batch_id" INTEGER,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "instructions" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "question_papers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "question_papers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_paper_sections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "question_paper_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "section_order" INTEGER NOT NULL,
    "question_count_target" INTEGER NOT NULL,
    "default_marks" DECIMAL NOT NULL,
    "default_negative_marks" DECIMAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "question_paper_sections_question_paper_id_fkey" FOREIGN KEY ("question_paper_id") REFERENCES "question_papers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "paper_questions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "question_paper_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "question_order" INTEGER NOT NULL,
    "question_text" TEXT,
    "correct_integer_answer" TEXT,
    "marks" DECIMAL NOT NULL,
    "negative_marks" DECIMAL NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "paper_questions_question_paper_id_fkey" FOREIGN KEY ("question_paper_id") REFERENCES "question_papers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "paper_questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "paper_question_options" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paper_question_id" INTEGER NOT NULL,
    "option_label" TEXT NOT NULL,
    "option_text" TEXT,
    "option_order" INTEGER NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "paper_question_options_paper_question_id_fkey" FOREIGN KEY ("paper_question_id") REFERENCES "paper_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "paper_question_media" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paper_question_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "paper_question_media_paper_question_id_fkey" FOREIGN KEY ("paper_question_id") REFERENCES "paper_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "paper_question_media_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_paper_versions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "question_paper_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title_snapshot" TEXT NOT NULL,
    "instructions_snapshot" TEXT,
    "created_from_status" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "question_paper_versions_question_paper_id_fkey" FOREIGN KEY ("question_paper_id") REFERENCES "question_papers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "question_paper_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_paper_version_sections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "section_order" INTEGER NOT NULL,
    "question_count_target" INTEGER NOT NULL,
    "default_marks" DECIMAL NOT NULL,
    "default_negative_marks" DECIMAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "question_paper_version_sections_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "question_paper_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_paper_version_questions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version_id" INTEGER NOT NULL,
    "original_question_id" INTEGER,
    "section_code" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "question_order" INTEGER NOT NULL,
    "question_text" TEXT,
    "correct_integer_answer" TEXT,
    "marks" DECIMAL NOT NULL,
    "negative_marks" DECIMAL NOT NULL DEFAULT 0,
    "is_active_snapshot" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "question_paper_version_questions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "question_paper_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "question_paper_version_questions_original_question_id_fkey" FOREIGN KEY ("original_question_id") REFERENCES "paper_questions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_paper_version_options" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version_question_id" INTEGER NOT NULL,
    "original_option_id" INTEGER,
    "option_label" TEXT NOT NULL,
    "option_text" TEXT,
    "option_order" INTEGER NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "question_paper_version_options_version_question_id_fkey" FOREIGN KEY ("version_question_id") REFERENCES "question_paper_version_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "question_paper_version_options_original_option_id_fkey" FOREIGN KEY ("original_option_id") REFERENCES "paper_question_options" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_paper_version_media" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version_question_id" INTEGER NOT NULL,
    "original_media_id" INTEGER,
    "purpose" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "question_paper_version_media_version_question_id_fkey" FOREIGN KEY ("version_question_id") REFERENCES "question_paper_version_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "question_paper_version_media_original_media_id_fkey" FOREIGN KEY ("original_media_id") REFERENCES "paper_question_media" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_exams" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "batch_id" INTEGER NOT NULL,
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
    CONSTRAINT "exams_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exams_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_question_paper_id_fkey" FOREIGN KEY ("question_paper_id") REFERENCES "question_papers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "exams_question_paper_version_id_fkey" FOREIGN KEY ("question_paper_version_id") REFERENCES "question_paper_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_exams" ("batch_id", "closed_at", "created_at", "created_by", "duration_seconds", "exam_date_time", "exam_mode", "id", "instructions", "published_at", "result_released_at", "solution_release_policy", "status", "title", "updated_at", "updated_by") SELECT "batch_id", "closed_at", "created_at", "created_by", "duration_seconds", "exam_date_time", "exam_mode", "id", "instructions", "published_at", "result_released_at", "solution_release_policy", "status", "title", "updated_at", "updated_by" FROM "exams";
DROP TABLE "exams";
ALTER TABLE "new_exams" RENAME TO "exams";
CREATE INDEX "exams_batch_id_status_idx" ON "exams"("batch_id", "status");
CREATE INDEX "exams_status_exam_date_time_idx" ON "exams"("status", "exam_date_time");
CREATE INDEX "exams_created_by_created_at_idx" ON "exams"("created_by", "created_at");
CREATE INDEX "exams_question_paper_id_idx" ON "exams"("question_paper_id");
CREATE INDEX "exams_question_paper_version_id_idx" ON "exams"("question_paper_version_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "question_papers_created_by_idx" ON "question_papers"("created_by");

-- CreateIndex
CREATE INDEX "question_papers_status_idx" ON "question_papers"("status");

-- CreateIndex
CREATE INDEX "question_papers_batch_id_status_idx" ON "question_papers"("batch_id", "status");

-- CreateIndex
CREATE INDEX "question_paper_sections_question_paper_id_section_order_idx" ON "question_paper_sections"("question_paper_id", "section_order");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_sections_question_paper_id_section_code_key" ON "question_paper_sections"("question_paper_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_sections_question_paper_id_section_order_key" ON "question_paper_sections"("question_paper_id", "section_order");

-- CreateIndex
CREATE INDEX "paper_questions_question_paper_id_section_code_question_order_idx" ON "paper_questions"("question_paper_id", "section_code", "question_order");

-- CreateIndex
CREATE INDEX "paper_questions_question_paper_id_question_type_idx" ON "paper_questions"("question_paper_id", "question_type");

-- CreateIndex
CREATE INDEX "paper_questions_created_by_created_at_idx" ON "paper_questions"("created_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "paper_questions_question_paper_id_section_code_question_order_key" ON "paper_questions"("question_paper_id", "section_code", "question_order");

-- CreateIndex
CREATE INDEX "paper_question_options_paper_question_id_option_order_idx" ON "paper_question_options"("paper_question_id", "option_order");

-- CreateIndex
CREATE INDEX "paper_question_options_paper_question_id_is_correct_idx" ON "paper_question_options"("paper_question_id", "is_correct");

-- CreateIndex
CREATE UNIQUE INDEX "paper_question_options_paper_question_id_option_label_key" ON "paper_question_options"("paper_question_id", "option_label");

-- CreateIndex
CREATE UNIQUE INDEX "paper_question_options_paper_question_id_option_order_key" ON "paper_question_options"("paper_question_id", "option_order");

-- CreateIndex
CREATE INDEX "paper_question_media_paper_question_id_purpose_idx" ON "paper_question_media"("paper_question_id", "purpose");

-- CreateIndex
CREATE INDEX "paper_question_media_paper_question_id_purpose_sort_order_idx" ON "paper_question_media"("paper_question_id", "purpose", "sort_order");

-- CreateIndex
CREATE INDEX "paper_question_media_uploaded_by_created_at_idx" ON "paper_question_media"("uploaded_by", "created_at");

-- CreateIndex
CREATE INDEX "question_paper_versions_question_paper_id_version_number_idx" ON "question_paper_versions"("question_paper_id", "version_number");

-- CreateIndex
CREATE INDEX "question_paper_versions_created_by_created_at_idx" ON "question_paper_versions"("created_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_versions_question_paper_id_version_number_key" ON "question_paper_versions"("question_paper_id", "version_number");

-- CreateIndex
CREATE INDEX "question_paper_version_sections_version_id_section_order_idx" ON "question_paper_version_sections"("version_id", "section_order");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_version_sections_version_id_section_code_key" ON "question_paper_version_sections"("version_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_version_sections_version_id_section_order_key" ON "question_paper_version_sections"("version_id", "section_order");

-- CreateIndex
CREATE INDEX "question_paper_version_questions_version_id_section_code_question_order_idx" ON "question_paper_version_questions"("version_id", "section_code", "question_order");

-- CreateIndex
CREATE INDEX "question_paper_version_questions_version_id_question_type_idx" ON "question_paper_version_questions"("version_id", "question_type");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_version_questions_version_id_section_code_question_order_key" ON "question_paper_version_questions"("version_id", "section_code", "question_order");

-- CreateIndex
CREATE INDEX "question_paper_version_options_version_question_id_option_order_idx" ON "question_paper_version_options"("version_question_id", "option_order");

-- CreateIndex
CREATE INDEX "question_paper_version_options_version_question_id_is_correct_idx" ON "question_paper_version_options"("version_question_id", "is_correct");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_version_options_version_question_id_option_label_key" ON "question_paper_version_options"("version_question_id", "option_label");

-- CreateIndex
CREATE UNIQUE INDEX "question_paper_version_options_version_question_id_option_order_key" ON "question_paper_version_options"("version_question_id", "option_order");

-- CreateIndex
CREATE INDEX "question_paper_version_media_version_question_id_purpose_idx" ON "question_paper_version_media"("version_question_id", "purpose");

-- CreateIndex
CREATE INDEX "question_paper_version_media_version_question_id_purpose_sort_order_idx" ON "question_paper_version_media"("version_question_id", "purpose", "sort_order");
