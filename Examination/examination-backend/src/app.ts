import express, { type Express, type Request, type Response } from "express";
import { prisma } from "./shared/prisma";
import { authRouter } from "./modules/auth";
import { identityRouter } from "./modules/identity";
import { examsRouter } from "./modules/exams";
import { leaderboardRouter } from "./modules/leaderboard";
import { mediaRouter } from "./modules/media";
import { questionPapersRouter } from "./modules/question-papers";
import { resultsRouter } from "./modules/results";
import { questionsRouter } from "./modules/questions";
import { appUpdateRouter } from "./modules/app-update/router";
import { devRouter } from "./modules/dev/router";
import { studentRouter } from "./modules/student";
import { sectionsRouter } from "./modules/sections";
import { attemptsRouter } from "./modules/attempts";
import { analyticsRouter } from "./modules/analytics";
import { auditRouter } from "./modules/audit";
import { getDatabaseReadiness } from "./shared/db-readiness";
import { requestLogger, errorLogger } from "./shared/request-logger";

export function createApp(): Express {
  const app = express();

  // Log the request metadata without touching the body stream.
  // Multipart uploads are parsed later by multer; attaching `data` listeners here
  // can consume bytes before multer sees them and trigger "Unexpected end of form".
  app.use((req, _res, next) => {
    if (req.path !== "/health") {
      console.log(`[RECV] ${req.method} ${req.path}`);
      console.log(`  ct=${req.headers["content-type"]}`);
      console.log(`  cl=${req.headers["content-length"]}`);
      console.log(`  te=${req.headers["transfer-encoding"]}`);
      console.log(`  expect=${req.headers["expect"]}`);
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(requestLogger);
  // NOTE: The raw `/uploads` static mount was removed (2026-06-28). It exposed all
  // question/solution media to anyone who could guess a URL, with no authentication.
  // Clients fetch media exclusively through authenticated `/api/.../media/:id` routes
  // (see questionMediaAccessUrl / safeMediaAccessUrl), which enforce ownership/role.
  app.use("/api/auth", authRouter);
  app.use("/api/identity", identityRouter);
  app.use("/api/exams", examsRouter);
  app.use("/api/question-papers", questionPapersRouter);
  app.use("/api/exams/:examId/questions", questionsRouter);
  app.use("/api/exams/:examId/questions/:questionId/media", mediaRouter);
  app.use("/api/question-papers/:paperId/questions/:questionId/media", mediaRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/results", resultsRouter);
  app.use("/api/student", studentRouter);
  app.use("/api/app", appUpdateRouter);
  app.use("/api/dev", devRouter);
  app.use("/api/sections", sectionsRouter);
  app.use("/api/attempts", attemptsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/audit", auditRouter);

  // Public server-time endpoint — used by Android to compute clock offset and
  // anchor exam countdowns to server time rather than device time.
  app.get("/api/time", (_req: Request, res: Response) => {
    res.json({ server_time: new Date().toISOString(), epoch_ms: Date.now() });
  });

  app.get("/health", async (_req: Request, res: Response) => {
    const readiness = await getDatabaseReadiness();
    res.status(200).json({
      status: "ok",
      name: "examination-backend",
      database: readiness,
      message: "Examination backend is running.",
    });
  });

  app.use(errorLogger);

  return app;
}
