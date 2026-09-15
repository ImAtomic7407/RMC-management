import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../shared/prisma";
import { generateStudentAssignedPaperInstance } from "../modules/exam-gate/assigned-paper.js";

type KnownPrismaError = {
  name?: string;
  code?: string;
  message?: string;
  meta?: unknown;
};

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function pickDuplicates(numbers: number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const n of numbers) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c > 1)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

async function barrierStart(label: string) {
  let resolve!: () => void;
  const start = new Promise<void>((res) => {
    resolve = res;
  });
  // Ensure this function is "used" so TS doesn't complain.
  void label;
  return { start, resolve: resolve! };
}

async function main() {
  const CONCURRENCY_SAME_STUDENT = Number(process.argv.includes("--same")
    ? (process.argv[process.argv.indexOf("--same") + 1] ?? "10")
    : "10");
  const CONCURRENCY_MULTI_STUDENTS = Number(process.argv.includes("--multi")
    ? (process.argv[process.argv.indexOf("--multi") + 1] ?? "9")
    : "9");

  const activeStudentProfiles = await prisma.student_profiles.findMany({
    where: { active: true },
    select: { id: true, student_uid: true, batch_id: true, class_name: true, roll_no: true, user: { select: { id: true } } },
    take: 30,
  });

  if (activeStudentProfiles.length < 5) {
    throw new Error(`Need at least 5 active student_profiles for smoke test, got ${activeStudentProfiles.length}.`);
  }

  const actor = await prisma.users.findFirst({
    where: { role: { in: ["ADMIN", "TEACHER"] } },
    select: { id: true, role: true },
  });
  if (!actor) {
    throw new Error("No ADMIN/TEACHER user found to use as created_by for temp exam assignments.");
  }

  const version = await prisma.question_paper_versions.findFirst({
    where: { created_from_status: { in: ["DRAFT", "ARCHIVED", "DRAFT"] } as any }, // defensive; any version should work
    include: {
      sections: true,
      question_paper: { select: { id: true } },
    },
    orderBy: { created_at: "desc" },
  });

  if (!version) {
    throw new Error("No question_paper_versions found.");
  }

  const examTitle = `RACE_SMOKE_EXAM_${nowIso()}`;

  // Create a temporary LIVE exam so generateStudentAssignedPaperInstance passes status checks.
  const tempExam = await prisma.exams.create({
    data: {
      title: examTitle,
      batch_id: activeStudentProfiles[0]!.batch_id,
      status: "LIVE",
      exam_mode: "LIVE",
      duration_seconds: 900,
      instructions: "Smoke test exam for assigned-paper race reproduction. Auto-deleted after smoke run.",
      solution_release_policy: "NEVER",
      exam_date_time: null,
      question_paper_id: version.question_paper.id,
      question_paper_version_id: version.id,
      created_by: actor.id,
      updated_by: actor.id,
      exam_sections: {
        createMany: {
          data: version.sections.map((s) => ({
            section_code: s.section_code,
            section_order: s.section_order,
            question_count_target: s.question_count_target,
            default_marks: s.default_marks,
            default_negative_marks: s.default_negative_marks,
          })),
        },
      },
    },
    include: { exam_sections: true },
  });

  const selectedStudents = activeStudentProfiles.slice(0, 1 + CONCURRENCY_MULTI_STUDENTS);
  const sameStudent = selectedStudents[0]!;
  const multiStudents = selectedStudents.slice(1);

  // Assign each selected student directly to the temp exam via exam_assignments.student_uid.
  await prisma.exam_assignments.createMany({
    data: selectedStudents.map((s) => ({
      exam_id: tempExam.id,
      batch_id: s.batch_id,
      student_uid: s.student_uid,
      visible_from: null,
      visible_until: null,
      created_by: actor.id,
    })),
  });

  // Create gate sessions (one per student) required by student_exam_paper_instances.gate_session_id relation.
  const gateSessions = await Promise.all(
    selectedStudents.map(async (s) => {
      const qrToken = crypto.randomBytes(24).toString("base64url");
      const qrTokenHash = crypto.createHash("sha256").update(qrToken).digest("hex");
      return prisma.exam_gate_sessions.create({
        data: {
          exam_id: tempExam.id,
          student_id: s.id,
          uid_snapshot: s.student_uid,
          device_id: `race_device_${s.id}_${crypto.randomBytes(4).toString("hex")}`,
          qr_token_hash: qrTokenHash,
          qr_expires_at: new Date(Date.now() + 60_000),
          gate_status: "VERIFIED",
          device_bind_status: "BOUND",
          paper_download_status: "NOT_STARTED",
          verified_at: new Date(),
          verified_by_teacher_id: null,
          attempt_id: null,
          assigned_paper_instance: undefined as any,
        },
      });
    }),
  );

  const sameGate = gateSessions[0]!;
  const multiGatesByStudentId = new Map<number, typeof gateSessions[number]>();
  for (let i = 1; i < gateSessions.length; i++) {
    multiGatesByStudentId.set(selectedStudents[i]!.id, gateSessions[i]!);
  }

  console.log(`Temp exam created: id=${tempExam.id}, title=${tempExam.title}`);
  console.log(`Case A (same student id=${sameStudent.id} concurrency=${CONCURRENCY_SAME_STUDENT}) gateSessionId=${sameGate.id}`);
  console.log(`Case B (multi students concurrency=${CONCURRENCY_MULTI_STUDENTS}) students=${multiStudents.map((s) => s.id).join(",")}`);

  const results: {
    caseLabel: string;
    studentId?: number;
    gateSessionId?: number;
    fulfilled?: { instanceId: number; assignedStudentNumber: number }[];
    rejected?: KnownPrismaError[];
  }[] = [];

  // Case A: same student/exam called concurrently.
  {
    const { start, resolve } = await barrierStart("caseA");
    const tasks = Array.from({ length: CONCURRENCY_SAME_STUDENT }).map((_, idx) =>
      (async () => {
        await start;
        try {
          const instance = await generateStudentAssignedPaperInstance(prisma, tempExam.id, sameStudent.id, sameGate.id);
          return { ok: true as const, idx, instanceId: instance.instance.id, assignedStudentNumber: instance.instance.assigned_student_number };
        } catch (e: unknown) {
          const err = e as any;
          const known: KnownPrismaError = {
            name: err?.name,
            code: err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined,
            message: err?.message,
            meta: err instanceof Prisma.PrismaClientKnownRequestError ? err.meta : undefined,
          };
          return { ok: false as const, idx, error: known };
        }
      })(),
    );

    // Release all tasks at once.
    resolve();
    const settled = await Promise.all(tasks);

    const fulfilled = settled
      .filter((x) => x.ok)
      .map((x) => ({ instanceId: x.instanceId, assignedStudentNumber: x.assignedStudentNumber }));
    const rejected = settled.filter((x) => !x.ok).map((x) => x.error);

    results.push({
      caseLabel: "A_same_student_concurrent",
      studentId: sameStudent.id,
      gateSessionId: sameGate.id,
      fulfilled,
      rejected,
    });

    console.log(`Case A results: fulfilled=${fulfilled.length}, rejected=${rejected.length}`);
    for (const [i, r] of rejected.entries()) {
      console.log(`Case A rejected[${i}]:`, r);
    }
  }

  // Case B: multiple students concurrently.
  {
    const target = multiStudents.slice(0, CONCURRENCY_MULTI_STUDENTS);
    const { start, resolve } = await barrierStart("caseB");

    const tasks = target.map(async (s, idx) => {
      const gate = multiGatesByStudentId.get(s.id);
      if (!gate) throw new Error(`Missing gate session for student ${s.id}`);
      await start;
      try {
        const instance = await generateStudentAssignedPaperInstance(prisma, tempExam.id, s.id, gate.id);
        return { ok: true as const, idx, studentId: s.id, instanceId: instance.instance.id, assignedStudentNumber: instance.instance.assigned_student_number };
      } catch (e: unknown) {
        const err = e as any;
        const known: KnownPrismaError = {
          name: err?.name,
          code: err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined,
          message: err?.message,
          meta: err instanceof Prisma.PrismaClientKnownRequestError ? err.meta : undefined,
        };
        return { ok: false as const, idx, studentId: s.id, error: known };
      }
    });

    resolve();
    const settled = await Promise.all(tasks);

    const fulfilled = settled
      .filter((x) => x.ok)
      .map((x) => ({ instanceId: x.instanceId, assignedStudentNumber: x.assignedStudentNumber }));
    const rejected = settled.filter((x) => !x.ok).map((x) => x.error);

    results.push({
      caseLabel: "B_multi_students_concurrent",
      fulfilled,
      rejected,
    });

    console.log(`Case B results: fulfilled=${fulfilled.length}, rejected=${rejected.length}`);
    for (const [i, r] of rejected.entries()) {
      console.log(`Case B rejected[${i}]:`, r);
    }
  }

  const instances = await prisma.student_exam_paper_instances.findMany({
    where: { exam_id: tempExam.id },
    select: { id: true, exam_id: true, student_id: true, assigned_student_number: true, gate_session_id: true, question_paper_version_id: true, status: true },
    orderBy: { student_id: "asc" },
  });

  console.log(`\nFinal assigned instances for temp exam (${instances.length}):`);
  for (const inst of instances) {
    console.log(
      `- instanceId=${inst.id} studentId=${inst.student_id} assigned_student_number=${inst.assigned_student_number} gateSessionId=${inst.gate_session_id} status=${inst.status}`,
    );
  }

  // Assigned_student_number uniqueness check per exam (this is NOT enforced by schema today).
  const assignedNumbers = instances.map((x) => x.assigned_student_number);
  const duplicates = pickDuplicates(assignedNumbers);
  if (duplicates.length) {
    console.log(`\nDUPLICATE assigned_student_number detected (race impact):`, duplicates);
  } else {
    console.log("\nNo duplicate assigned_student_number detected across created instances.");
  }

  // Idempotency: for same student, ensure only one instance exists.
  const sameStudentInstances = instances.filter((x) => x.student_id === sameStudent.id);
  if (sameStudentInstances.length !== 1) {
    console.log(`\nIDEMPOTENCY FAIL: expected exactly 1 instance for same student, got ${sameStudentInstances.length}`);
  } else {
    console.log("\nIdempotency check for same student: OK (exactly one instance exists).");
  }

  console.log("\nSmoke results summary:");
  console.log(JSON.stringify(results, null, 2));

  // Clean up temp exam (cascades should remove related gate sessions + assigned instances).
  try {
    await prisma.exams.delete({ where: { id: tempExam.id } });
    console.log(`Temp exam deleted: id=${tempExam.id}`);
  } catch (e) {
    console.warn(`Temp exam delete failed (manual cleanup may be needed):`, e);
  }
}

main()
  .then(() => {
    console.log("assigned-paper race smoke finished.");
  })
  .catch((e: unknown) => {
    console.error("assigned-paper race smoke failed:", e);
    process.exitCode = 1;
  });

