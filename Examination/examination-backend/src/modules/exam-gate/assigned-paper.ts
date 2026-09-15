import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { ExamGateError } from "./service.js";

const VARIANT_SALT = process.env.EXAM_VARIANT_SALT ?? "examination-assigned-paper-v1";

type AnyDb = any;

type SectionCode = "PHYSICS" | "CHEMISTRY" | "MATHS";

type LiveQuestionMediaRow = {
  id: number;
  purpose: "QUESTION" | "SOLUTION";
  storage_url: string;
  mime_type: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: Date;
};

type LiveOptionRow = {
  id: number;
  option_label: string;
  option_text: string | null;
  option_order: number;
};

type VersionQuestionRow = {
  id: number;
  section_code: SectionCode;
  question_type: "MCQ" | "INTEGER";
  question_order: number;
  question_text: string | null;
  correct_integer_answer: string | null;
  marks: string | number;
  negative_marks: string | number;
  is_active_snapshot: boolean;
  options: LiveOptionRow[];
  media: LiveQuestionMediaRow[];
};

type VersionSectionRow = {
  section_code: SectionCode;
  section_order: number;
  question_count_target: number;
  default_marks: string | number;
  default_negative_marks: string | number;
};

type DeliveryRuleRow = {
  section_code: SectionCode;
  questions_to_deliver: number;
  selection_strategy: "ALL" | "RANDOM_SUBSET" | "ROTATED_SUBSET";
  order_strategy: "ORIGINAL" | "SHUFFLED" | "ROTATED_SHUFFLED";
  section_time_limit_seconds: number | null;
};

type AssignedPaperInstanceRow = {
  id: number;
  exam_id: number;
  student_id: number;
  gate_session_id: number;
  question_paper_version_id: number;
  assigned_student_number: number;
  variant_seed: string;
  status: "GENERATED" | "DOWNLOADING" | "READY" | "FAILED" | "ARCHIVED";
  review_package_lock_status: "LOCKED" | "UNLOCKED" | "EXPIRED";
  review_key_id: string | null;
  live_package_checksum: string | null;
  locked_review_package_checksum: string | null;
  generated_at: Date | null;
  perturbation_count: number;
  max_neighbor_collision: number | null;
  questions?: AssignedPaperQuestionRow[];
};

type AssignedPaperQuestionRow = {
  id: number;
  instance_id: number;
  version_question_id: number;
  section_code: SectionCode;
  student_question_order: number;
  section_question_order: number;
  original_question_order: number;
};

type AssignedPaperLivePackageQuestion = {
  assigned_question_id: number;
  version_question_id: number;
  student_question_order: number;
  section_question_order: number;
  original_question_order: number;
  question_type: "MCQ" | "INTEGER";
  question_text: string | null;
  question_media: Array<{
    id: number;
    purpose: "QUESTION";
    mime_type: string;
    url: string;
    // Alias of `url` under the key the mobile client actually reads. The client
    // (examPaperCache / SecureAttemptScreen) keys media off `access_url`; the
    // assigned-paper payload historically only sent `url`, so images resolved to
    // `<base>undefined` and rendered blank. Emit both for compatibility.
    access_url: string;
    width: number | null;
    height: number | null;
  }>;
  options: Array<{
    version_option_id: number;
    option_label: string;
    option_text: string | null;
  }>;
};

type AssignedPaperLivePackageSection = {
  section_code: SectionCode;
  section_order: number;
  questions_to_deliver: number;
  section_time_limit_seconds: number | null;
  questions: AssignedPaperLivePackageQuestion[];
};

type AssignedPaperLivePackage = {
  instance_id: number;
  question_paper_version_id: number;
  assigned_student_number: number;
  variant_seed_public_id: string;
  sections: AssignedPaperLivePackageSection[];
  warnings: string[];
};

type AssignedPaperLockedReviewPackage = {
  lock_status: "LOCKED" | "UNLOCKED" | "EXPIRED";
  encrypted_payload_available: boolean;
  package_checksum: string | null;
  key_id: string | null;
};

type AssignedPaperPayload = {
  instance: AssignedPaperInstanceRow;
  livePackage: AssignedPaperLivePackage;
  lockedReviewPackage: AssignedPaperLockedReviewPackage;
};

type StudentProfileRow = {
  id: number;
  student_uid: string;
  batch_id: number;
  class_name: string | null;
  roll_no: string | null;
  active: boolean;
  batch_memberships: Array<{
    batch_id: number;
  }>;
  user: {
    id: number;
    full_name: string | null;
    phone: string | null;
  };
  batch: {
    id: number;
    name: string;
    active: boolean;
  };
};

class AsyncQueueLock {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

// Keyed by "examId:studentId" so students can generate concurrently.
// The assignedStudentNumber race is handled by DB unique-constraint + retry below.
const assignedPaperGenerationLocks = new Map<string, AsyncQueueLock>();

function withAssignedPaperGenerationLock<T>(examId: number, studentId: number, task: () => Promise<T>) {
  const key = `${examId}:${studentId}`;
  let lock = assignedPaperGenerationLocks.get(key);
  if (!lock) {
    lock = new AsyncQueueLock();
    assignedPaperGenerationLocks.set(key, lock);
  }
  return lock.runExclusive(task);
}

function hashText(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function gateError(code: string, status: number, message: string): never {
  throw new ExamGateError(code, status, message);
}

function seededRandom(seed: string): () => number {
  let state = parseInt(hashText(seed).slice(0, 8), 16) || 0x12345678;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic<T>(items: T[], seed: string): T[] {
  const output = [...items];
  const random = seededRandom(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function rotateArray<T>(items: T[], offset: number): T[] {
  if (items.length === 0) {
    return [];
  }
  const normalized = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function deriveVariantSeed(examId: number, studentId: number, gateSessionId: number, assignedStudentNumber: number, versionId: number) {
  return hashText([examId, studentId, gateSessionId, assignedStudentNumber, versionId, VARIANT_SALT].join(":"));
}

function buildQuestionMediaUrl(examId: number, versionQuestionId: number, mediaId: number) {
  return `/api/student/exams/${examId}/questions/${versionQuestionId}/media/${mediaId}`;
}

function buildLockedReviewChecksum(payload: Record<string, unknown>) {
  return hashText(JSON.stringify(payload));
}

// ─── Anti-collision helpers ────────────────────────────────────────────────────

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

/**
 * Returns the smallest prime > floor(poolSize/2) that is coprime with poolSize.
 *
 * Two properties this guarantees:
 * 1. Adjacent students' selection windows are displaced by ≈ P/2 (the geometric maximum).
 * 2. (n × step) % P visits every residue before cycling — full coverage.
 */
function selectionStepForPool(poolSize: number): number {
  if (poolSize <= 2) return 1;
  let candidate = Math.floor(poolSize / 2) + 1;
  while (candidate < poolSize) {
    if (isPrime(candidate) && poolSize % candidate !== 0) return candidate;
    candidate++;
  }
  // Fallback: largest prime < poolSize that is coprime with it.
  candidate = poolSize - 1;
  while (candidate > 1) {
    if (isPrime(candidate) && poolSize % candidate !== 0) return candidate;
    candidate--;
  }
  return 1;
}

type QuestionPosition = { version_question_id: number; student_question_order: number };

/**
 * Fraction of questions that appear at the exact same position in both papers.
 * For two independently random shuffles of Q items the expected value is 1/Q.
 */
export function computePositionCollisionRate(
  candidate: QuestionPosition[],
  neighbor: QuestionPosition[],
): number {
  if (candidate.length === 0 || neighbor.length === 0) return 0;
  const neighborPos = new Map<number, number>();
  for (const q of neighbor) neighborPos.set(q.version_question_id, q.student_question_order);
  let collisions = 0;
  for (const q of candidate) {
    if (neighborPos.get(q.version_question_id) === q.student_question_order) collisions++;
  }
  return collisions / Math.max(candidate.length, neighbor.length);
}

/**
 * Loads the last `k` committed paper instances before `beforeStudentNumber`
 * and returns their (questionId, position) lists for collision scoring.
 */
async function loadRecentNeighborPositions(
  db: AnyDb,
  examId: number,
  beforeStudentNumber: number,
  k: number,
): Promise<QuestionPosition[][]> {
  if (beforeStudentNumber <= 1) return [];
  const fromNumber = Math.max(1, beforeStudentNumber - k);
  const instances = await db.student_exam_paper_instances.findMany({
    where: {
      exam_id: examId,
      assigned_student_number: { gte: fromNumber, lt: beforeStudentNumber },
    },
    select: {
      questions: {
        select: { version_question_id: true, student_question_order: true },
      },
    },
  });
  return (instances as Array<{ questions: QuestionPosition[] }>).map((inst) => inst.questions);
}

/**
 * Selects and orders questions for a single section.
 *
 * SELECTION (when pool > deliver):
 *   Prime-step rotation ensures adjacent students' windows are ≈ P/2 apart.
 *   When pool == deliver, rotation is skipped (every student gets every question).
 *
 * ORDERING:
 *   Fisher-Yates seeded by `variantSeed:sectionCode`, optionally with a
 *   perturbation suffix so the shuffle can be retried while keeping the same
 *   selection window.
 */
function buildSectionOrdering(
  questionsInSection: VersionQuestionRow[],
  deliverCount: number,
  assignedStudentNumber: number,
  variantSeed: string,
  sectionCode: string,
  orderStrategy: string,
  perturbation: number,
): VersionQuestionRow[] {
  const available = questionsInSection.length;

  // ── Selection ──────────────────────────────────────────────────────────────
  let chosen: VersionQuestionRow[];
  if (deliverCount >= available) {
    // Delivering all: rotation is cosmetic, skip it entirely.
    chosen = [...questionsInSection];
  } else {
    const stepSize = selectionStepForPool(available);
    const offset = (assignedStudentNumber * stepSize) % available;
    chosen = rotateArray(questionsInSection, offset).slice(0, deliverCount);
  }

  // ── Ordering ───────────────────────────────────────────────────────────────
  if (orderStrategy === "ORIGINAL") {
    return [...chosen].sort((l, r) => l.question_order - r.question_order);
  }
  const shuffleSeed = perturbation === 0
    ? `${variantSeed}:${sectionCode}`
    : hashText(`${variantSeed}:${sectionCode}:p${perturbation}`);
  return shuffleDeterministic(chosen, shuffleSeed);
}

async function loadStudentProfile(db: AnyDb, studentId: number) {
  const student = await db.student_profiles.findFirst({
    where: { id: studentId, active: true },
    select: {
      id: true,
      student_uid: true,
      batch_id: true,
      class_name: true,
      roll_no: true,
      active: true,
      batch_memberships: {
        select: {
          batch_id: true,
        },
      },
      user: {
        select: {
          id: true,
          full_name: true,
          phone: true,
        },
      },
      batch: {
        select: {
          id: true,
          name: true,
          active: true,
        },
      },
    },
  });

  if (!student || !student.batch.active) {
    throw new Error("Student profile not found.");
  }

  return student;
}

async function loadExamForAssignment(db: AnyDb, examId: number, studentId: number) {
  const student = await loadStudentProfile(db, studentId);
  const batchIds = Array.from(
    new Set(
      [student.batch_id, ...(student.batch_memberships ?? []).map((membership: { batch_id: number }) => membership.batch_id)],
    ),
  );
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      status: {
        in: ["SCHEDULED", "LIVE", "PUBLISHED", "CLOSED", "RESULT_RELEASED"],
      },
      OR: [
        {
          exam_assignments: {
            some: {
              batch_id: {
                in: batchIds,
              },
            },
          },
        },
        {
          exam_assignments: {
            some: {
              student_uid: student.student_uid,
            },
          },
        },
      ],
    },
    include: {
      question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
          questions: {
            where: {
              is_active_snapshot: true,
            },
            orderBy: [
              { section_code: "asc" },
              { question_order: "asc" },
            ],
            include: {
              options: {
                orderBy: {
                  option_order: "asc",
                },
              },
              media: {
                orderBy: [
                  { purpose: "asc" },
                  { sort_order: "asc" },
                  { created_at: "asc" },
                ],
              },
            },
          },
        },
      },
      section_delivery_rules: {
        orderBy: {
          section_code: "asc",
        },
      },
    },
  });

  if (!exam || !exam.question_paper_version) {
    throw new Error("Exam not found.");
  }

  return { student, exam };
}

function normalizeRules(sections: VersionSectionRow[], rules: DeliveryRuleRow[]) {
  const ruleMap = new Map<SectionCode, DeliveryRuleRow>();
  for (const rule of rules) {
    ruleMap.set(rule.section_code, rule);
  }

  return sections.map((section) => {
    const rule = ruleMap.get(section.section_code);
    const questionsToDeliver = rule?.questions_to_deliver && rule.questions_to_deliver > 0
      ? rule.questions_to_deliver
      : section.question_count_target > 0
        ? section.question_count_target
        : 0;

    return {
      section,
      questionsToDeliver,
      selectionStrategy: rule?.selection_strategy ?? "ROTATED_SUBSET",
      orderStrategy: rule?.order_strategy ?? "ROTATED_SHUFFLED",
      sectionTimeLimitSeconds: rule?.section_time_limit_seconds ?? null,
    };
  });
}

function toPublicVariantSeedId(seed: string) {
  return `vsp_${seed.slice(0, 12)}`;
}

function buildAssignedPackage(instance: AssignedPaperInstanceRow, exam: any) {
  const questions = instance.questions ?? [];
  const version = exam.question_paper_version;
  const questionMap = new Map<number, VersionQuestionRow>();
  for (const question of version.questions as VersionQuestionRow[]) {
    questionMap.set(question.id, question);
  }

  const warnings: string[] = [];

  // Build a lookup for delivery rules so we can read section_time_limit_seconds
  const deliveryRuleMap = new Map<SectionCode, { section_time_limit_seconds: number | null }>();
  for (const rule of (exam.section_delivery_rules ?? []) as Array<{ section_code: SectionCode; section_time_limit_seconds?: number | null }>) {
    deliveryRuleMap.set(rule.section_code, { section_time_limit_seconds: rule.section_time_limit_seconds ?? null });
  }

  const sections = (version.sections as VersionSectionRow[]).map((section) => {
    const sectionQuestions = questions
      .filter((question) => question.section_code === section.section_code)
      .sort((left, right) => left.student_question_order - right.student_question_order)
      .map((assigned) => {
        const versionQuestion = questionMap.get(assigned.version_question_id);
        if (!versionQuestion) {
          return null;
        }
        return {
          assigned_question_id: assigned.id,
          version_question_id: versionQuestion.id,
          student_question_order: assigned.student_question_order,
          section_question_order: assigned.section_question_order,
          original_question_order: assigned.original_question_order,
          question_type: versionQuestion.question_type,
          question_text: versionQuestion.question_text,
          question_media: versionQuestion.media
            .filter((media) => media.purpose === "QUESTION")
            .map((media) => ({
              id: media.id,
              purpose: "QUESTION" as const,
              mime_type: media.mime_type,
              url: buildQuestionMediaUrl(exam.id, versionQuestion.id, media.id),
              access_url: buildQuestionMediaUrl(exam.id, versionQuestion.id, media.id),
              width: media.width,
              height: media.height,
            })),
          options: versionQuestion.options.map((option) => ({
            version_option_id: option.id,
            option_label: option.option_label,
            option_text: option.option_text,
          })),
        };
      })
      .filter(Boolean) as AssignedPaperLivePackageQuestion[];

    if (section.question_count_target > 0 && sectionQuestions.length < section.question_count_target) {
      warnings.push(
        `Section ${section.section_code} delivered ${sectionQuestions.length} of ${section.question_count_target} requested questions.`,
      );
    }

    return {
      section_code: section.section_code,
      section_order: section.section_order,
      questions_to_deliver: section.question_count_target > 0
        ? Math.min(section.question_count_target, sectionQuestions.length)
        : sectionQuestions.length,
      section_time_limit_seconds: deliveryRuleMap.get(section.section_code)?.section_time_limit_seconds ?? null,
      questions: sectionQuestions,
    };
  });

  const livePackage: AssignedPaperLivePackage = {
    instance_id: instance.id,
    question_paper_version_id: instance.question_paper_version_id,
    assigned_student_number: instance.assigned_student_number,
    variant_seed_public_id: toPublicVariantSeedId(instance.variant_seed),
    sections,
    warnings,
  };

  const lockedReviewPackage = {
    lock_status: instance.review_package_lock_status,
    encrypted_payload_available: false,
    package_checksum: instance.locked_review_package_checksum,
    key_id: instance.review_key_id,
  } satisfies AssignedPaperLockedReviewPackage;

  return {
    instance,
    livePackage,
    lockedReviewPackage,
  };
}

async function createDefaultDeliveryRulesIfMissing(db: AnyDb, exam: any) {
  const existing = await db.exam_section_delivery_rules.findMany({
    where: { exam_id: exam.id },
    select: {
      section_code: true,
    },
  });
  const existingCodes = new Set(existing.map((row: any) => row.section_code));
  const missingSections = (exam.question_paper_version.sections as VersionSectionRow[]).filter((section) => !existingCodes.has(section.section_code));
  if (missingSections.length === 0) {
    return;
  }

  try {
    await db.exam_section_delivery_rules.createMany({
      data: missingSections.map((section) => ({
        exam_id: exam.id,
        section_code: section.section_code,
        questions_to_deliver: section.question_count_target > 0 ? section.question_count_target : 0,
        selection_strategy: "ROTATED_SUBSET",
        order_strategy: "ROTATED_SHUFFLED",
      })),
    });
  } catch (error: unknown) {
    // Concurrent calls can race here; ignore the unique constraint collision.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    // SQLite can return timeouts under concurrency; treat as safe-noop since
    // question selection falls back to defaults when section delivery rules are missing.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P1008" || error.code === "P2028")
    ) {
      return;
    }
    throw error;
  }
}

async function loadAssignedPaperInstance(db: AnyDb, examId: number, studentId: number) {
  const instance = await db.student_exam_paper_instances.findFirst({
    where: {
      exam_id: examId,
      student_id: studentId,
    },
    include: {
      questions: {
        orderBy: {
          student_question_order: "asc",
        },
      },
    },
  });

  return instance as AssignedPaperInstanceRow | null;
}

export async function generateStudentAssignedPaperInstance(db: AnyDb, examId: number, studentId: number, gateSessionId: number) {
  const { student, exam } = await loadExamForAssignment(db, examId, studentId);
  await createDefaultDeliveryRulesIfMissing(db, exam);

  const rules = normalizeRules(
    exam.question_paper_version.sections as VersionSectionRow[],
    (exam.section_delivery_rules ?? []).map((rule: any) => ({
      section_code: rule.section_code,
      questions_to_deliver: rule.questions_to_deliver,
      selection_strategy: rule.selection_strategy,
      order_strategy: rule.order_strategy,
      section_time_limit_seconds: rule.section_time_limit_seconds ?? null,
    })),
  );

  const MAX_RETRIES = 8;
  let lastKnownError: unknown = null;

  return withAssignedPaperGenerationLock(exam.id, student.id, async () => {
    for (let retry = 0; retry < MAX_RETRIES; retry += 1) {
      const existing = await loadAssignedPaperInstance(db, exam.id, student.id);
      if (existing) {
        return buildAssignedPackage(existing, exam);
      }

      const existingCount = await db.student_exam_paper_instances.count({
        where: {
          exam_id: exam.id,
        },
      });
      const assignedStudentNumber = existingCount + 1;

      const variantSeed = deriveVariantSeed(exam.id, student.id, gateSessionId, assignedStudentNumber, exam.question_paper_version.id);

      // ── Anti-collision perturbation loop ────────────────────────────────────
      // We generate up to MAX_PERTURBATION candidate orderings and pick the one
      // with the lowest position-collision rate against the last K committed papers.
      const MAX_PERTURBATION = 5;
      const COLLISION_THRESHOLD = 0.12; // >12% same-position questions → try again
      const NEIGHBOR_CHECK_COUNT = 5;

      type SelectedEntry = {
        versionQuestion: VersionQuestionRow;
        section: VersionSectionRow;
        sectionQuestionOrder: number;
        studentQuestionOrder: number;
      };

      // Load neighbor papers once, outside the perturbation loop (single DB call).
      const neighborPositions = await loadRecentNeighborPositions(
        db, exam.id, assignedStudentNumber, NEIGHBOR_CHECK_COUNT,
      );

      let bestSelectedQuestions: SelectedEntry[] = [];
      let bestMaxCollision = 2.0; // sentinel > 1.0 so first candidate always wins
      let usedPerturbation = 0;

      for (let perturbation = 0; perturbation <= MAX_PERTURBATION; perturbation++) {
        const candidateQuestions: SelectedEntry[] = [];

        for (const sectionRule of rules) {
          const questionsInSection = (exam.question_paper_version.questions as VersionQuestionRow[])
            .filter((q) => q.section_code === sectionRule.section.section_code);
          const available = questionsInSection.length;
          const deliverCount = sectionRule.questionsToDeliver > 0
            ? Math.min(sectionRule.questionsToDeliver, available)
            : available;
          if (available === 0 || deliverCount === 0) continue;

          const ordered = buildSectionOrdering(
            questionsInSection,
            deliverCount,
            assignedStudentNumber,
            variantSeed,
            sectionRule.section.section_code,
            sectionRule.orderStrategy,
            perturbation,
          );

          ordered.forEach((versionQuestion, index) => {
            candidateQuestions.push({
              versionQuestion,
              section: sectionRule.section,
              sectionQuestionOrder: index + 1,
              studentQuestionOrder: candidateQuestions.length + 1,
            });
          });
        }

        // Score candidate against all loaded neighbors.
        const candidatePositions: QuestionPosition[] = candidateQuestions.map((q) => ({
          version_question_id: q.versionQuestion.id,
          student_question_order: q.studentQuestionOrder,
        }));
        const collisionRates = neighborPositions.map((n) =>
          computePositionCollisionRate(candidatePositions, n),
        );
        const maxCollision = collisionRates.length > 0 ? Math.max(...collisionRates) : 0;

        // Keep track of the best candidate seen so far.
        if (maxCollision < bestMaxCollision) {
          bestMaxCollision = maxCollision;
          bestSelectedQuestions = candidateQuestions;
          usedPerturbation = perturbation;
        }

        // Accept as soon as we're below threshold; otherwise keep trying.
        if (maxCollision <= COLLISION_THRESHOLD) break;
      }
      // ────────────────────────────────────────────────────────────────────────

      const reviewKeyId = crypto.randomUUID();

      let instance: AssignedPaperInstanceRow;
      try {
        instance = await db.$transaction(async (tx: AnyDb) => {
          // Diagnostic fields (perturbation_count, max_neighbor_collision) are written
          // in a separate best-effort update AFTER the transaction so that a missing
          // database migration does not break paper generation for students.
          const created = await tx.student_exam_paper_instances.create({
          data: {
            exam_id: exam.id,
            student_id: student.id,
            gate_session_id: gateSessionId,
            question_paper_version_id: exam.question_paper_version.id,
            assigned_student_number: assignedStudentNumber,
            variant_seed: variantSeed,
            status: "GENERATED",
            review_package_lock_status: "LOCKED",
            review_key_id: reviewKeyId,
            generated_at: new Date(),
            live_package_checksum: null,
            locked_review_package_checksum: null,
          },
        });

        await tx.student_exam_paper_questions.createMany({
          data: bestSelectedQuestions.map((entry) => ({
            instance_id: created.id,
            version_question_id: entry.versionQuestion.id,
            section_code: entry.section.section_code,
            student_question_order: entry.studentQuestionOrder,
            section_question_order: entry.sectionQuestionOrder,
            original_question_order: entry.versionQuestion.question_order,
          })),
        });

        const questionRows = await tx.student_exam_paper_questions.findMany({
          where: {
            instance_id: created.id,
          },
          orderBy: {
            student_question_order: "asc",
          },
        });

        const createdInstance = {
          ...created,
          questions: questionRows,
        } as AssignedPaperInstanceRow;

        const packageData = buildAssignedPackage(createdInstance, exam);
        const liveChecksum = hashText(JSON.stringify(packageData.livePackage));
        const lockedChecksum = buildLockedReviewChecksum({
          instance_id: createdInstance.id,
          exam_id: exam.id,
          student_id: student.id,
          question_paper_version_id: exam.question_paper_version.id,
          key_id: createdInstance.review_key_id,
          question_count: questionRows.length,
        });

        await tx.student_exam_paper_instances.update({
          where: {
            id: createdInstance.id,
          },
          data: {
            live_package_checksum: liveChecksum,
            locked_review_package_checksum: lockedChecksum,
          },
        });

        return {
          ...createdInstance,
          live_package_checksum: liveChecksum,
          locked_review_package_checksum: lockedChecksum,
        } as AssignedPaperInstanceRow;
        });

        // Best-effort: save collision diagnostics after the core transaction succeeds.
        // Wrapped in its own try-catch so a missing DB migration never fails the QR flow.
        if (instance) {
          db.student_exam_paper_instances.update({
            where: { id: instance.id },
            data: {
              perturbation_count: usedPerturbation,
              max_neighbor_collision: bestMaxCollision < 2.0 ? bestMaxCollision : null,
            },
          }).catch(() => { /* column not yet migrated — diagnostics skipped */ });
        }

      } catch (error: unknown) {
        lastKnownError = error;

        if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = (error.meta as any)?.target;
        const targetFields = Array.isArray(target) ? target.map((x) => String(x)) : [];

        // If the instance for this (exam_id, student_id) already got created by a racing request,
        // treat this call as idempotent and return the winner.
        if (targetFields.includes("student_id")) {
          const loaded = await loadAssignedPaperInstance(db, exam.id, student.id);
          if (loaded) {
            return buildAssignedPackage(loaded, exam);
          }
        }

        // If assigned_student_number collided with another student's instance,
        // re-compute a fresh candidate and retry.
        if (targetFields.includes("assigned_student_number")) {
          continue;
        }
      }

      // Under SQLite + concurrency, Prisma transactions can time out. If we retry,
      // the "existing instance" check at the top of the loop should succeed.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P1008" || error.code === "P2028")
      ) {
        continue;
      }

        throw error;
      }

      const loaded = await loadAssignedPaperInstance(db, exam.id, student.id);
      return loaded ? buildAssignedPackage(loaded, exam) : buildAssignedPackage(instance, exam);
    }

    const loaded = await loadAssignedPaperInstance(db, exam.id, student.id);
    if (loaded) {
      return buildAssignedPackage(loaded, exam);
    }
    throw lastKnownError ?? new Error("Failed to generate assigned paper instance after retries.");
  });
}

export async function loadStudentAssignedPaperPayload(db: AnyDb, examId: number, studentId: number) {
  const { exam } = await loadExamForAssignment(db, examId, studentId);
  const instance = await loadAssignedPaperInstance(db, exam.id, studentId);
  if (!instance) {
    return null;
  }
  return buildAssignedPackage(instance, exam);
}

/**
 * Decide which version-paper questions a NON-ATTENDEE practises, applying the
 * SAME selection + ordering as the live gate (`normalizeRules` +
 * `buildSectionOrdering`) so a practice paper serves the same per-section
 * deliverCount as the real exam delivered — NOT the entire question bank.
 *
 * There is no canonical "served" paper for a non-attendee: every attendee got a
 * different rotation window. So we derive a STABLE pseudo student-number from
 * the UID, giving the non-attendee a valid per-student variant — exactly
 * analogous to how each attendee received their own variant.
 *
 * Read-only: does NOT create default delivery rules (if none exist,
 * `normalizeRules` falls back to the version section's question_count_target,
 * which equals what the default rule would have produced). Returns ONLY ids +
 * ordering; the caller loads question content + correct answers.
 */
export async function selectNonAttendeePracticeQuestions(
  db: AnyDb,
  examId: number,
  studentId: number,
): Promise<Array<{ version_question_id: number; section_code: SectionCode; student_question_order: number; section_question_order: number }>> {
  const { student, exam } = await loadExamForAssignment(db, examId, studentId);
  if (!exam.question_paper_version) {
    return [];
  }

  const rules = normalizeRules(
    exam.question_paper_version.sections as VersionSectionRow[],
    ((exam.section_delivery_rules ?? []) as any[]).map((rule) => ({
      section_code: rule.section_code,
      questions_to_deliver: rule.questions_to_deliver,
      selection_strategy: rule.selection_strategy,
      order_strategy: rule.order_strategy,
      section_time_limit_seconds: rule.section_time_limit_seconds ?? null,
    })),
  );

  const pseudoStudentNumber = (parseInt(hashText(`${student.student_uid}:${exam.id}`).slice(0, 8), 16) % 4096) + 1;
  const variantSeed = deriveVariantSeed(exam.id, student.id, 0, pseudoStudentNumber, exam.question_paper_version.id);

  const selected: Array<{ version_question_id: number; section_code: SectionCode; student_question_order: number; section_question_order: number }> = [];

  for (const sectionRule of rules) {
    const questionsInSection = (exam.question_paper_version.questions as VersionQuestionRow[]).filter(
      (q) => q.section_code === sectionRule.section.section_code,
    );
    const available = questionsInSection.length;
    const deliverCount = sectionRule.questionsToDeliver > 0 ? Math.min(sectionRule.questionsToDeliver, available) : available;
    if (available === 0 || deliverCount === 0) continue;

    const ordered = buildSectionOrdering(
      questionsInSection,
      deliverCount,
      pseudoStudentNumber,
      variantSeed,
      sectionRule.section.section_code,
      sectionRule.orderStrategy,
      0,
    );
    ordered.forEach((vq, index) => {
      selected.push({
        version_question_id: vq.id,
        section_code: sectionRule.section.section_code,
        section_question_order: index + 1,
        student_question_order: selected.length + 1,
      });
    });
  }

  return selected;
}

export async function issueStudentAssignedPaperReviewUnlock(
  db: AnyDb,
  examId: number,
  studentId: number,
  deviceId?: string | null,
) {
  const { student, exam } = await loadExamForAssignment(db, examId, studentId);
  const session = await db.exam_gate_sessions.findUnique({
    where: {
      exam_id_student_id: {
        exam_id: exam.id,
        student_id: student.id,
      },
    },
    select: {
      id: true,
      device_id: true,
      gate_status: true,
      device_bind_status: true,
    },
  });

  if (exam.status !== "RESULT_RELEASED") {
    // Device-binding is only enforced while results are not yet released (exam security).
    // Once results are out the student may review from any device.
    if (!session || session.gate_status !== "VERIFIED" || session.device_bind_status !== "BOUND") {
      gateError("DEVICE_NOT_BOUND", 403, "QR verification is required before unlocking review.");
    }
    if (deviceId && session.device_id !== deviceId) {
      gateError("DEVICE_BIND_MISMATCH", 403, "Device does not match the verified gate session.");
    }
    gateError("REVIEW_NOT_RELEASED", 403, "Review is not released yet.");
  }

  const attempt = await db.exam_attempts.findFirst({
    where: {
      exam_id: exam.id,
      student_id: student.id,
    },
    include: {
      attempt_result: true,
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (!attempt || (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED")) {
    gateError("ATTEMPT_NOT_SUBMITTED", 403, "Attempt is not submitted.");
  }
  if (!attempt.attempt_result) {
    gateError("REVIEW_NOT_RELEASED", 403, "Result is not available yet.");
  }

  const instance = await loadAssignedPaperInstance(db, exam.id, student.id);
  if (!instance) {
    gateError("ASSIGNED_PAPER_NOT_FOUND", 404, "Assigned paper not found.");
  }

  const reviewUnlockToken = crypto.randomUUID();
  const unlockTokenHash = hashText(reviewUnlockToken);

  const stored = await db.student_exam_review_unlocks.upsert({
    where: {
      instance_id: instance.id,
    },
    create: {
      instance_id: instance.id,
      attempt_id: attempt.id,
      student_id: student.id,
      exam_id: exam.id,
      unlock_token_hash: unlockTokenHash,
      issued_at: new Date(),
      expires_at: null,
      used_at: null,
    },
    update: {
      attempt_id: attempt.id,
      student_id: student.id,
      exam_id: exam.id,
      unlock_token_hash: unlockTokenHash,
      issued_at: new Date(),
      expires_at: null,
      used_at: null,
    },
  });

  await db.student_exam_paper_instances.update({
    where: {
      id: instance.id,
    },
    data: {
      review_package_lock_status: "UNLOCKED",
    },
  });

  return {
    student,
    exam,
    instance,
    unlock: {
      id: stored.id,
      instance_id: instance.id,
      lock_status: "UNLOCKED" as const,
      review_unlock_token: reviewUnlockToken,
      expires_at: stored.expires_at ? stored.expires_at.toISOString() : null,
    },
  };
}

export function mapAssignedPaperPayload(payload: Awaited<ReturnType<typeof loadStudentAssignedPaperPayload>>) {
  if (!payload) {
    return null;
  }
  return {
    assigned_paper: payload.livePackage,
    locked_review_package: payload.lockedReviewPackage,
  };
}
