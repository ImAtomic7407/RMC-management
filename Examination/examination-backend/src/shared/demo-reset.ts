import { prisma } from "./prisma";

type DemoResetDb = typeof prisma;

export async function clearDemoData(db: DemoResetDb = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.practice_attempt_answers.deleteMany();
    await tx.practice_attempt_section_results.deleteMany();
    await tx.practice_attempt_results.deleteMany();
    await tx.practice_attempts.deleteMany();
    await tx.practice_question_attempts.deleteMany();
    await tx.attempt_answers.deleteMany();
    await tx.attempt_section_results.deleteMany();
    await tx.attempt_results.deleteMany();
    await tx.exam_attempt_violations.deleteMany();
    await tx.exam_attempts.deleteMany();
    await tx.exam_gate_sessions.deleteMany();
    await tx.student_exam_review_unlocks.deleteMany();
    await tx.student_exam_paper_questions.deleteMany();
    await tx.student_exam_paper_instances.deleteMany();
    await tx.exam_section_delivery_rules.deleteMany();
    await tx.exam_sections.deleteMany();
    await tx.exam_assignments.deleteMany();
    await tx.exams.deleteMany();
    await tx.question_paper_version_media.deleteMany();
    await tx.question_paper_version_options.deleteMany();
    await tx.question_paper_version_questions.deleteMany();
    await tx.question_paper_version_sections.deleteMany();
    await tx.question_paper_sections.deleteMany();
    await tx.paper_question_media.deleteMany();
    await tx.paper_question_options.deleteMany();
    await tx.paper_questions.deleteMany();
    await tx.question_paper_versions.deleteMany();
    await tx.question_papers.deleteMany();
    await tx.question_media.deleteMany();
    await tx.question_options.deleteMany();
    await tx.questions.deleteMany();
    await tx.leaderboard_entries.deleteMany();
  });
}
