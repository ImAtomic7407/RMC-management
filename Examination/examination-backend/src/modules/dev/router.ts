import { Router, type Response } from "express";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest } from "../../shared/auth";
import { clearDemoData } from "../../shared/demo-reset";
import { broadcastDemoDataCleared } from "../../shared/realtime";

const router = Router();

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN"));

router.post("/clear-demo-data", async (req: AuthenticatedRequest, res: Response) => {
  const confirm = req.body?.confirm === true || req.query.confirm === "true";
  if (!confirm) {
    res.status(400).json({
      status: "error",
      code: "CONFIRMATION_REQUIRED",
      message: "Pass confirm=true to clear demo data.",
    });
    return;
  }

  await clearDemoData();
  broadcastDemoDataCleared("admin reset");

  res.status(200).json({
    status: "success",
    message: "Demo exam data cleared.",
  });
});

export { router as devRouter };
