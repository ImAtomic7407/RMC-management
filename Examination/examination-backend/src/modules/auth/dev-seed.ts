import bcrypt from "bcryptjs";
import { prisma } from "../../shared/prisma";
import { requireSchemaReady, writeAuthAuditLog } from "../../shared/auth";

async function main(): Promise<void> {
  if (process.env.ENABLE_EXAM_DEV_SEED !== "true") {
    console.log("Dev seed skipped. Set ENABLE_EXAM_DEV_SEED=true to enable.");
    return;
  }

  if (!(await requireSchemaReady())) {
    console.log("Dev seed skipped because the database schema is not ready.");
    return;
  }

  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.users.upsert({
    where: { username: "admin1" },
    update: {},
    create: {
      username: "admin1",
      password_hash: passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      full_name: "Exam Admin",
    },
  });

  const teacher = await prisma.users.upsert({
    where: { username: "teacher1" },
    update: {},
    create: {
      username: "teacher1",
      password_hash: passwordHash,
      role: "TEACHER",
      status: "ACTIVE",
      full_name: "Exam Teacher",
    },
  });

  const student = await prisma.users.upsert({
    where: { username: "student1" },
    update: {},
    create: {
      username: "student1",
      password_hash: passwordHash,
      role: "STUDENT",
      status: "ACTIVE",
      full_name: "Exam Student",
    },
  });

  // Attach student1 to the first available real batch (or create one if none exist).
  // This ensures student1's batch_id matches batches the teacher already uses.
  const firstBatch = await prisma.batches.findFirst({ where: { active: true }, orderBy: { id: "asc" } })
    ?? await prisma.batches.create({
      data: { name: "Demo Batch A", description: "Default batch for development testing", academic_year: "2025-26", active: true },
    });

  // Create student profile so student1 can see and join exams
  await prisma.student_profiles.upsert({
    where: { user_id: student.id },
    update: { batch_id: firstBatch.id },
    create: {
      user_id: student.id,
      student_uid: "STU001",
      batch_id: firstBatch.id,
      class_name: "Class XII",
      roll_no: "001",
      active: true,
    },
  });

  console.log("Development auth seed completed.");

  await writeAuthAuditLog({
    actorUserId: admin.id,
    actorRole: "ADMIN",
    action: "DEV_SEED_AUTH_USERS",
    entityType: "system",
    entityId: "dev-seed",
    metadata: {
      adminUserId: admin.id,
      teacherUserId: teacher.id,
      studentUserId: student.id,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
