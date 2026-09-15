import { Router, type Response } from "express";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, requireSchemaReady } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";

const router = Router();

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

function isIntegerAnswerCorrect(submitted: string, correct: string): boolean {
  const sub = parseFloat(submitted);
  const exp = parseFloat(correct);
  if (!Number.isFinite(sub) || !Number.isFinite(exp)) {
    return false;
  }
  const diff = Math.abs(sub - exp);
  if (exp >= 0) {
    return sub >= 0 && diff <= 1.5;
  }
  return diff <= 1.5;
}

// GET /exam/:examId/stats - Exam level statistics
router.get("/exam/:examId/stats", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseInt(req.params.examId as string, 10);
  if (isNaN(examId)) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid examId.",
    });
    return;
  }

  try {
    const exam = await prisma.exams.findUnique({
      where: { id: examId },
    });

    if (!exam) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Exam not found.",
      });
      return;
    }

    const attempts = await prisma.exam_attempts.findMany({
      where: {
        exam_id: examId,
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      },
      include: {
        attempt_result: true,
      },
    });

    const results = attempts
      .map(a => a.attempt_result)
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const scores = results.map(r => Number(r.total_score)).sort((a, b) => a - b);
    const count = scores.length;

    let highest = 0;
    let lowest = 0;
    let average = 0;
    let median = 0;
    const distribution = {
      "0-20": 0,
      "21-40": 0,
      "41-60": 0,
      "61-80": 0,
      "81-100": 0,
    };

    if (count > 0) {
      highest = scores[count - 1];
      lowest = scores[0];
      const sum = scores.reduce((acc, s) => acc + s, 0);
      average = sum / count;

      if (count % 2 === 0) {
        median = (scores[count / 2 - 1] + scores[count / 2]) / 2;
      } else {
        median = scores[Math.floor(count / 2)];
      }

      results.forEach(r => {
        const pct = Number(r.percentage);
        if (pct <= 20) distribution["0-20"]++;
        else if (pct <= 40) distribution["21-40"]++;
        else if (pct <= 60) distribution["41-60"]++;
        else if (pct <= 80) distribution["61-80"]++;
        else distribution["81-100"]++;
      });
    }

    res.status(200).json({
      status: "success",
      stats: {
        highest,
        lowest,
        average,
        median,
        totalAttempts: count,
        distribution,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to compute stats.",
    });
  }
});

// GET /exam/:examId/question-analysis - Correct/wrong/unattempted percentages per question
router.get("/exam/:examId/question-analysis", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseInt(req.params.examId as string, 10);
  if (isNaN(examId)) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid examId.",
    });
    return;
  }

  try {
    const examQuestions = await prisma.questions.findMany({
      where: { exam_id: examId },
      orderBy: [{ section_code: "asc" }, { question_order: "asc" }],
    });

    const attempts = await prisma.exam_attempts.findMany({
      where: {
        exam_id: examId,
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      },
      include: {
        attempt_answers: {
          include: {
            selected_option: true,
          },
        },
      },
    });

    const questionAnalysis = examQuestions.map(q => {
      let correct = 0;
      let wrong = 0;
      let unattempted = 0;

      attempts.forEach(attempt => {
        const ans = attempt.attempt_answers.find(a => a.question_id === q.id);
        if (!ans) {
          unattempted++;
          return;
        }

        if (q.question_type === "MCQ") {
          const isCorrect = ans.selected_option?.is_correct || false;
          if (isCorrect) {
            correct++;
          } else {
            if (ans.selected_option_id) {
              wrong++;
            } else {
              unattempted++;
            }
          }
        } else if (q.question_type === "INTEGER") {
          const submittedVal = ans.integer_answer;
          const expectedVal = q.correct_integer_answer;
          if (submittedVal && expectedVal) {
            const isCorrect = isIntegerAnswerCorrect(submittedVal, expectedVal);
            if (isCorrect) {
              correct++;
            } else {
              wrong++;
            }
          } else {
            unattempted++;
          }
        } else {
          unattempted++;
        }
      });

      const total = attempts.length;
      return {
        questionId: q.id,
        sectionCode: q.section_code,
        questionOrder: q.question_order,
        questionType: q.question_type,
        correctCount: correct,
        wrongCount: wrong,
        unattemptedCount: unattempted,
        correctPercentage: total > 0 ? (correct / total) * 100 : 0,
        wrongPercentage: total > 0 ? (wrong / total) * 100 : 0,
        unattemptedPercentage: total > 0 ? (unattempted / total) * 100 : 0,
      };
    });

    res.status(200).json({
      status: "success",
      analysis: questionAnalysis,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to run question analysis.",
    });
  }
});

export { router as analyticsRouter };
