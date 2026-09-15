-- CreateTable
CREATE TABLE "exam_section_delivery_rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "questions_to_deliver" INTEGER NOT NULL,
    "selection_strategy" TEXT NOT NULL,
    "order_strategy" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "exam_section_delivery_rules_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "student_exam_paper_instances" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exam_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "gate_session_id" INTEGER NOT NULL,
    "question_paper_version_id" INTEGER NOT NULL,
    "assigned_student_number" INTEGER NOT NULL,
    "variant_seed" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "review_package_lock_status" TEXT NOT NULL DEFAULT 'LOCKED',
    "review_key_id" TEXT,
    "live_package_checksum" TEXT,
    "locked_review_package_checksum" TEXT,
    "generated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "student_exam_paper_instances_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_exam_paper_instances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_exam_paper_instances_gate_session_id_fkey" FOREIGN KEY ("gate_session_id") REFERENCES "exam_gate_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_exam_paper_instances_question_paper_version_id_fkey" FOREIGN KEY ("question_paper_version_id") REFERENCES "question_paper_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "student_exam_paper_questions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "instance_id" INTEGER NOT NULL,
    "version_question_id" INTEGER NOT NULL,
    "section_code" TEXT NOT NULL,
    "student_question_order" INTEGER NOT NULL,
    "section_question_order" INTEGER NOT NULL,
    "original_question_order" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_exam_paper_questions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "student_exam_paper_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_exam_paper_questions_version_question_id_fkey" FOREIGN KEY ("version_question_id") REFERENCES "question_paper_version_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "student_exam_review_unlocks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "instance_id" INTEGER NOT NULL,
    "attempt_id" INTEGER,
    "student_id" INTEGER NOT NULL,
    "exam_id" INTEGER NOT NULL,
    "unlock_token_hash" TEXT NOT NULL,
    "issued_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME,
    "used_at" DATETIME,
    CONSTRAINT "student_exam_review_unlocks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "student_exam_paper_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_exam_review_unlocks_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "student_exam_review_unlocks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_exam_review_unlocks_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "exam_section_delivery_rules_exam_id_idx" ON "exam_section_delivery_rules"("exam_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_section_delivery_rules_exam_id_section_code_key" ON "exam_section_delivery_rules"("exam_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_paper_instances_gate_session_id_key" ON "student_exam_paper_instances"("gate_session_id");

-- CreateIndex
CREATE INDEX "student_exam_paper_instances_exam_id_idx" ON "student_exam_paper_instances"("exam_id");

-- CreateIndex
CREATE INDEX "student_exam_paper_instances_student_id_idx" ON "student_exam_paper_instances"("student_id");

-- CreateIndex
CREATE INDEX "student_exam_paper_instances_question_paper_version_id_idx" ON "student_exam_paper_instances"("question_paper_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_paper_instances_exam_id_student_id_key" ON "student_exam_paper_instances"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "student_exam_paper_questions_instance_id_idx" ON "student_exam_paper_questions"("instance_id");

-- CreateIndex
CREATE INDEX "student_exam_paper_questions_version_question_id_idx" ON "student_exam_paper_questions"("version_question_id");

-- CreateIndex
CREATE INDEX "student_exam_paper_questions_section_code_idx" ON "student_exam_paper_questions"("section_code");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_paper_questions_instance_id_version_question_id_key" ON "student_exam_paper_questions"("instance_id", "version_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_paper_questions_instance_id_student_question_order_key" ON "student_exam_paper_questions"("instance_id", "student_question_order");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_paper_questions_instance_id_section_code_section_question_order_key" ON "student_exam_paper_questions"("instance_id", "section_code", "section_question_order");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_review_unlocks_instance_id_key" ON "student_exam_review_unlocks"("instance_id");

-- CreateIndex
CREATE INDEX "student_exam_review_unlocks_exam_id_student_id_idx" ON "student_exam_review_unlocks"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "student_exam_review_unlocks_issued_at_idx" ON "student_exam_review_unlocks"("issued_at");

-- CreateIndex
CREATE INDEX "student_exam_review_unlocks_attempt_id_idx" ON "student_exam_review_unlocks"("attempt_id");
