import { Router, type Response } from "express";
import { requireAuthMiddleware, type AuthenticatedRequest, requireSchemaReady } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";

const router = Router();

router.use(requireAuthMiddleware);

// GET / - Returns list of SectionCodes
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({
    status: "success",
    sections: ["PHYSICS", "CHEMISTRY", "MATHS"],
  });
});

// GET /exam/:examId - Returns sections configured for an exam
router.get("/exam/:examId", async (req: AuthenticatedRequest, res: Response) => {
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
    const examSections = await prisma.exam_sections.findMany({
      where: { exam_id: examId },
      orderBy: { section_order: "asc" },
    });

    res.status(200).json({
      status: "success",
      sections: examSections,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to fetch exam sections.",
    });
  }
});

// GET /question-paper/:paperId - Returns sections configured for a question paper
router.get("/question-paper/:paperId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperId = parseInt(req.params.paperId as string, 10);
  if (isNaN(paperId)) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid paperId.",
    });
    return;
  }

  try {
    const paperSections = await prisma.question_paper_sections.findMany({
      where: { question_paper_id: paperId },
      orderBy: { section_order: "asc" },
    });

    res.status(200).json({
      status: "success",
      sections: paperSections,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to fetch question paper sections.",
    });
  }
});

export { router as sectionsRouter };
