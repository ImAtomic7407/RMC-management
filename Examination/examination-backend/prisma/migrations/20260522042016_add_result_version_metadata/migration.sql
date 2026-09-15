-- AlterTable
ALTER TABLE "attempt_results" ADD COLUMN "evaluated_question_paper_version_id" INTEGER;
ALTER TABLE "attempt_results" ADD COLUMN "evaluated_question_paper_version_number" INTEGER;
ALTER TABLE "attempt_results" ADD COLUMN "scoring_source" TEXT DEFAULT 'LEGACY_EXAM_QUESTIONS';

-- CreateIndex
CREATE INDEX "attempt_results_evaluated_question_paper_version_id_idx" ON "attempt_results"("evaluated_question_paper_version_id");
