import { Router, type Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest } from "../../shared/auth";
import { broadcastRealtimeEvent } from "../../shared/realtime";
import { getBestUpdatePath, registerRelease } from "./release.service";

const router = Router();

// GET /api/app/update-info?version_code=N
router.get("/update-info", async (req: AuthenticatedRequest, res: Response) => {
  const clientVersionCode = Number(req.query.version_code ?? 0);
  
  try {
    const updateResult = await getBestUpdatePath(clientVersionCode);
    res.status(200).json({
      status: "success",
      update: updateResult,
    });
  } catch (err: any) {
    res.status(500).json({
      status: "error",
      message: err.message || "Failed to fetch update info",
    });
  }
});

router.get("/patches/:filename", async (req: AuthenticatedRequest, res: Response) => {
  const filename = String(req.params.filename);
  // Prevent directory traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).json({ status: "error", message: "Invalid filename" });
  }

  const patchPath = path.resolve(process.cwd(), "uploads", "patches", filename);
  try {
    await fs.access(patchPath);
    res.sendFile(patchPath);
  } catch {
    res.status(404).json({
      status: "error",
      message: "Patch file not found",
    });
  }
});

// POST /api/app/publish (ADMIN ONLY)
// Publishes a new APK release and triggers differential patch generation
router.post("/publish", requireAuthMiddleware, requireRoleMiddleware("ADMIN"), async (req: AuthenticatedRequest, res: Response) => {
  const { versionCode, versionName, apkPath, releaseNotes, mandatory } = req.body;

  if (!versionCode || !versionName || !apkPath) {
    return res.status(400).json({
      status: "error",
      message: "versionCode, versionName, and apkPath are required fields",
    });
  }

  try {
    const release = await registerRelease({
      versionCode: Number(versionCode),
      versionName: String(versionName),
      apkPath: String(apkPath),
      releaseNotes: Array.isArray(releaseNotes) ? releaseNotes : [String(releaseNotes)],
      mandatory: Boolean(mandatory),
    });

    const updateInfo = await getBestUpdatePath(0); // overall latest

    // Announce the new update in real-time
    broadcastRealtimeEvent({
      type: "app.update.available",
      actor_role: "SYSTEM",
      payload: updateInfo as unknown as Record<string, unknown>,
    });

    res.status(200).json({
      status: "success",
      message: "APK published successfully. Differential patch generation started in background.",
      release,
    });
  } catch (err: any) {
    res.status(500).json({
      status: "error",
      message: err.message || "Failed to publish APK release",
    });
  }
});

export { router as appUpdateRouter };
