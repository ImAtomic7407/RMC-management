-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "full_name" TEXT,
    "phone" TEXT,
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "student_uid" TEXT NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "class_name" TEXT,
    "roll_no" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_profiles_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "employee_code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "teacher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "academic_year" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "identity_bridge" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_system" TEXT NOT NULL,
    "source_uid" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "display_name" TEXT,
    "batch_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "identity_bridge_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exams" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "batch_id" INTEGER NOT NULL,
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
    CONSTRAINT "exams_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exam_sections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "section_order" INTEGER NOT NULL,
    "question_count_target" INTEGER NOT NULL,
    "default_marks" DECIMAL NOT NULL,
    "default_negative_marks" DECIMAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exam_sections_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "questions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "question_order" INTEGER NOT NULL,
    "question_text" TEXT,
    "correct_integer_answer" TEXT,
    "answer_explanation_text" TEXT,
    "marks" DECIMAL NOT NULL,
    "negative_marks" DECIMAL NOT NULL DEFAULT 0,
    "difficulty" TEXT,
    "topic" TEXT,
    "chapter" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'TEXT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "questions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "question_id" INTEGER NOT NULL,
    "option_label" TEXT NOT NULL,
    "option_text" TEXT NOT NULL,
    "option_order" INTEGER NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "question_media" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "question_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "question_media_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "question_media_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exam_assignments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "student_uid" TEXT,
    "visible_from" DATETIME,
    "visible_until" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "exam_assignments_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exam_assignments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exam_assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" DATETIME NOT NULL,
    "ends_at" DATETIME NOT NULL,
    "submitted_at" DATETIME,
    "last_heartbeat_at" DATETIME,
    "is_auto_submitted" BOOLEAN NOT NULL DEFAULT false,
    "device_id" TEXT,
    "server_time_offset_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exam_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exam_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attempt_answers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attempt_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "selected_option_id" INTEGER,
    "integer_answer" TEXT,
    "is_marked_for_review" BOOLEAN NOT NULL DEFAULT false,
    "saved_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attempt_answers_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "question_options" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attempt_section_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attempt_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "score" DECIMAL NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "wrong_count" INTEGER NOT NULL,
    "unattempted_count" INTEGER NOT NULL,
    "max_score" DECIMAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "attempt_section_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attempt_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attempt_id" INTEGER NOT NULL,
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "attempt_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "practice_question_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "student_id" INTEGER NOT NULL,
    "exam_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "wrong_count" INTEGER NOT NULL DEFAULT 0,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "last_answer" TEXT,
    "solution_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "solution_unlocked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "practice_question_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "practice_question_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "practice_question_attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope_type" TEXT NOT NULL,
    "scope_id" INTEGER,
    "attempt_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DECIMAL NOT NULL,
    "percentage" DECIMAL NOT NULL,
    "tie_break_value" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "leaderboard_entries_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leaderboard_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exam_audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actor_user_id" INTEGER,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata_json" TEXT,
    "ip_address" TEXT,
    "device_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exam_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_student_uid_key" ON "student_profiles"("student_uid");

-- CreateIndex
CREATE INDEX "student_profiles_batch_id_active_idx" ON "student_profiles"("batch_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_user_id_key" ON "teacher_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_employee_code_key" ON "teacher_profiles"("employee_code");

-- CreateIndex
CREATE INDEX "teacher_profiles_active_idx" ON "teacher_profiles"("active");

-- CreateIndex
CREATE UNIQUE INDEX "batches_name_key" ON "batches"("name");

-- CreateIndex
CREATE INDEX "batches_active_idx" ON "batches"("active");

-- CreateIndex
CREATE UNIQUE INDEX "identity_bridge_source_system_source_uid_role_key" ON "identity_bridge"("source_system", "source_uid", "role");

-- CreateIndex
CREATE INDEX "exams_batch_id_status_idx" ON "exams"("batch_id", "status");

-- CreateIndex
CREATE INDEX "exams_status_exam_date_time_idx" ON "exams"("status", "exam_date_time");

-- CreateIndex
CREATE INDEX "exams_created_by_created_at_idx" ON "exams"("created_by", "created_at");

-- CreateIndex
CREATE INDEX "exam_sections_exam_id_section_order_idx" ON "exam_sections"("exam_id", "section_order");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sections_exam_id_section_code_key" ON "exam_sections"("exam_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sections_exam_id_section_order_key" ON "exam_sections"("exam_id", "section_order");

-- CreateIndex
CREATE INDEX "questions_exam_id_section_code_question_order_idx" ON "questions"("exam_id", "section_code", "question_order");

-- CreateIndex
CREATE INDEX "questions_exam_id_question_type_idx" ON "questions"("exam_id", "question_type");

-- CreateIndex
CREATE INDEX "questions_created_by_created_at_idx" ON "questions"("created_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "questions_exam_id_section_code_question_order_key" ON "questions"("exam_id", "section_code", "question_order");

-- CreateIndex
CREATE INDEX "question_options_question_id_option_order_idx" ON "question_options"("question_id", "option_order");

-- CreateIndex
CREATE INDEX "question_options_question_id_is_correct_idx" ON "question_options"("question_id", "is_correct");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_option_label_key" ON "question_options"("question_id", "option_label");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_option_order_key" ON "question_options"("question_id", "option_order");

-- CreateIndex
CREATE INDEX "question_media_question_id_purpose_idx" ON "question_media"("question_id", "purpose");

-- CreateIndex
CREATE INDEX "question_media_question_id_purpose_sort_order_idx" ON "question_media"("question_id", "purpose", "sort_order");

-- CreateIndex
CREATE INDEX "question_media_uploaded_by_created_at_idx" ON "question_media"("uploaded_by", "created_at");

-- CreateIndex
CREATE INDEX "exam_assignments_exam_id_batch_id_idx" ON "exam_assignments"("exam_id", "batch_id");

-- CreateIndex
CREATE INDEX "exam_assignments_exam_id_student_uid_idx" ON "exam_assignments"("exam_id", "student_uid");

-- CreateIndex
CREATE INDEX "exam_assignments_batch_id_visible_from_idx" ON "exam_assignments"("batch_id", "visible_from");

-- CreateIndex
CREATE INDEX "exam_attempts_exam_id_status_idx" ON "exam_attempts"("exam_id", "status");

-- CreateIndex
CREATE INDEX "exam_attempts_student_id_started_at_idx" ON "exam_attempts"("student_id", "started_at");

-- CreateIndex
CREATE INDEX "exam_attempts_exam_id_student_id_status_idx" ON "exam_attempts"("exam_id", "student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempts_exam_id_student_id_key" ON "exam_attempts"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "attempt_answers_attempt_id_question_id_idx" ON "attempt_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "attempt_answers_question_id_idx" ON "attempt_answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_answers_attempt_id_question_id_key" ON "attempt_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "attempt_section_results_attempt_id_section_code_idx" ON "attempt_section_results"("attempt_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_section_results_attempt_id_section_code_key" ON "attempt_section_results"("attempt_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_results_attempt_id_key" ON "attempt_results"("attempt_id");

-- CreateIndex
CREATE INDEX "attempt_results_rank_exam_idx" ON "attempt_results"("rank_exam");

-- CreateIndex
CREATE INDEX "attempt_results_rank_batch_idx" ON "attempt_results"("rank_batch");

-- CreateIndex
CREATE INDEX "attempt_results_rank_overall_idx" ON "attempt_results"("rank_overall");

-- CreateIndex
CREATE INDEX "attempt_results_attempt_id_idx" ON "attempt_results"("attempt_id");

-- CreateIndex
CREATE INDEX "practice_question_attempts_student_id_exam_id_idx" ON "practice_question_attempts"("student_id", "exam_id");

-- CreateIndex
CREATE INDEX "practice_question_attempts_question_id_idx" ON "practice_question_attempts"("question_id");

-- CreateIndex
CREATE INDEX "practice_question_attempts_solution_unlocked_idx" ON "practice_question_attempts"("solution_unlocked");

-- CreateIndex
CREATE UNIQUE INDEX "practice_question_attempts_student_id_exam_id_question_id_key" ON "practice_question_attempts"("student_id", "exam_id", "question_id");

-- CreateIndex
CREATE INDEX "leaderboard_entries_scope_type_scope_id_rank_idx" ON "leaderboard_entries"("scope_type", "scope_id", "rank");

-- CreateIndex
CREATE INDEX "leaderboard_entries_scope_type_scope_id_score_percentage_idx" ON "leaderboard_entries"("scope_type", "scope_id", "score", "percentage");

-- CreateIndex
CREATE INDEX "leaderboard_entries_student_id_created_at_idx" ON "leaderboard_entries"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "exam_audit_logs_entity_type_entity_id_idx" ON "exam_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "exam_audit_logs_actor_user_id_created_at_idx" ON "exam_audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "exam_audit_logs_action_created_at_idx" ON "exam_audit_logs"("action", "created_at");
