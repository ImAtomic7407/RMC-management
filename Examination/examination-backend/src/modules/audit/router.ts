import { Router, type Response } from "express";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, requireSchemaReady } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";

const router = Router();

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

// GET / - List audit logs with pagination and filters
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const skip = (page - 1) * limit;

  const actorUserId = req.query.actorUserId ? parseInt(req.query.actorUserId as string, 10) : undefined;
  const action = req.query.action as string | undefined;
  const entityType = req.query.entityType as string | undefined;

  const where: any = {};
  if (!isNaN(actorUserId as number)) {
    where.actor_user_id = actorUserId;
  }
  if (action) {
    where.action = action;
  }
  if (entityType) {
    where.entity_type = entityType;
  }

  try {
    const logs = await prisma.exam_audit_logs.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
      include: {
        actor: {
          select: {
            username: true,
            full_name: true,
          },
        },
      },
    });

    const total = await prisma.exam_audit_logs.count({ where });

    res.status(200).json({
      status: "success",
      note: "Audit logs are queried from the exam_audit_logs table. Results may be empty or sparse if other parts of the application have not written audit records yet.",
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      logs,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to fetch audit logs.",
    });
  }
});

export { router as auditRouter };
