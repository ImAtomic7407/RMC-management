import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const models = [
    'users',
    'student_profiles',
    'teacher_profiles',
    'batches',
    'exams',
    'question_papers',
    'paper_questions',
    'exam_assignments'
  ];

  for (const model of models) {
    try {
      const count = await (prisma as any)[model].count();
      console.log(`${model}: ${count} rows`);
    } catch (err: any) {
      console.log(`${model}: failed to count - ${err.message}`);
    }
  }

  // Also print all exams if any exist
  try {
    const exams = await prisma.exams.findMany({ select: { id: true, title: true, created_by: true } });
    console.log("Exams:", exams);
  } catch (e) {}

  // Also print all question papers if any exist
  try {
    const papers = await prisma.question_papers.findMany({ select: { id: true, title: true, created_by: true } });
    console.log("Question Papers:", papers);
  } catch (e) {}
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
