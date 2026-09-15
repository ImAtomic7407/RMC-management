-- Add per-question time limit (60–300 s, nullable) to live-exam questions
ALTER TABLE "questions" ADD COLUMN "question_time_limit_seconds" INTEGER;

-- Add timed_out flag to attempt_answers so the scoring engine can deduct
-- negative marks for questions the student ran out of time on without answering
ALTER TABLE "attempt_answers" ADD COLUMN "timed_out" BOOLEAN NOT NULL DEFAULT false;
