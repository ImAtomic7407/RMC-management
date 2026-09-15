import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../../shared/prisma";

type BatchInput = {
  name: string;
  description?: string | null;
  academic_year?: string | null;
  active: boolean;
};

type StudentInput = {
  source_system: string;
  source_uid: string;
  student_uid: string;
  username?: string;
  full_name: string;
  phone?: string | null;
  batch_name: string;
  batch_names?: string[];
  class_name?: string | null;
  roll_no?: string | null;
  active: boolean;
  photo_url?: string | null;
};

type TeacherInput = {
  source_system: string;
  source_uid: string;
  username: string;
  full_name: string;
  phone?: string | null;
  employee_code?: string | null;
  role: "TEACHER" | "ADMIN";
  active: boolean;
};

type ImportedUserResult = {
  user_id: number;
  username: string;
  role: "ADMIN" | "TEACHER" | "STUDENT";
  status: string;
  login_provisioned: boolean;
};

type IdentityDb = Pick<
  typeof prisma,
  "batches" | "users" | "student_profiles" | "student_batch_memberships" | "teacher_profiles" | "identity_bridge" | "$executeRawUnsafe" | "$queryRawUnsafe"
>;

// RMC-imported accounts use a random unguessable password so the local
// /api/auth/login endpoint cannot be used to bypass RMC auth.
// Users imported from RMC must always log in via /api/auth/login/rmc/*.
function nextUserStatus(active: boolean): "ACTIVE" | "BLOCKED" {
  return active ? "ACTIVE" : "BLOCKED";
}

async function placeholderPasswordHash(): Promise<string> {
  // 32 random bytes — unguessable, never disclosed to anyone
  const randomPassword = crypto.randomBytes(32).toString("hex");
  return bcrypt.hash(randomPassword, 10);
}

function normalizeStudentBatchNames(input: StudentInput): string[] {
  const names = [input.batch_name, ...(input.batch_names ?? [])]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return Array.from(new Set(names));
}

function normalizeStudentLoginUsername(input: StudentInput): string {
  return (input.username ?? input.full_name).trim();
}

export async function upsertBatch(input: BatchInput) {
  return prisma.batches.upsert({
    where: { name: input.name },
    update: {
      description: input.description ?? null,
      academic_year: input.academic_year ?? null,
      active: input.active,
    },
    create: {
      name: input.name,
      description: input.description ?? null,
      academic_year: input.academic_year ?? null,
      active: input.active,
    },
  });
}

export async function verifyBatch(input: BatchInput) {
  const batch = await prisma.batches.findUnique({
    where: { name: input.name },
  });
  return {
    exists: Boolean(batch),
    batch,
    requested: input,
  };
}

export async function verifyStudentRecord(input: StudentInput) {
  const [bridge, batch, profile] = await Promise.all([
    prisma.identity_bridge.findUnique({
      where: {
        source_system_source_uid_role: {
          source_system: input.source_system,
          source_uid: input.source_uid,
          role: "STUDENT",
        },
      },
    }),
    prisma.batches.findUnique({
      where: { name: input.batch_name },
    }),
    prisma.student_profiles.findUnique({
      where: { student_uid: input.student_uid },
      include: { user: true, batch: true },
    }),
  ]);

  return {
    bridge_exists: Boolean(bridge),
    batch_exists: Boolean(batch),
    profile_exists: Boolean(profile),
    matched: Boolean(bridge || profile),
    batch,
    profile,
    requested: input,
  };
}

async function upsertStudentUserAndProfile(
  input: StudentInput,
  db: IdentityDb = prisma,
): Promise<
  ImportedUserResult & {
    source_system: string;
    source_uid: string;
    student_uid: string;
    full_name: string;
    batch_name: string;
    batch_names: string[];
    class_name: string | null;
    roll_no: string | null;
    active: boolean;
  }
> {
  const batchNames = normalizeStudentBatchNames(input);
  if (batchNames.length === 0) {
    throw new Error("Student batch list is required.");
  }
  const loginUsername = normalizeStudentLoginUsername(input);

  const batches = [];
  for (const batchName of batchNames) {
    batches.push(await db.batches.upsert({
      where: { name: batchName },
      update: {
        description: null,
        academic_year: null,
        active: input.active,
      },
      create: {
        name: batchName,
        description: null,
        academic_year: null,
        active: input.active,
      },
    }));
  }

  const primaryBatch = batches[0];

  // ── Stable user resolution via identity_bridge ────────────────────────────
  // source_uid is the stable RMC identifier; student_uid can change between
  // syncs (e.g. re-registration). Look up the existing user_id via the bridge
  // first so we update the existing profile rather than creating a zombie.
  type BridgeRow = { user_id: number | null };
  let bridgeUserId: number | null = null;
  if (input.source_system && input.source_uid) {
    try {
      const rows = await db.$queryRawUnsafe<BridgeRow[]>(
        `SELECT user_id FROM identity_bridge WHERE source_system = ? AND source_uid = ? AND role = 'STUDENT' LIMIT 1`,
        input.source_system,
        input.source_uid,
      );
      bridgeUserId = rows[0]?.user_id ?? null;
    } catch {
      // Column not yet added via migration — fall back to legacy student_uid lookup
      bridgeUserId = null;
    }
  }

  // If bridge gave us a user_id, find the profile that belongs to that user.
  // The profile may have a different (old) student_uid — fix it in place.
  let existingProfileByBridge = bridgeUserId
    ? await db.student_profiles.findFirst({
        where: { user_id: bridgeUserId },
        include: { user: true },
      })
    : null;

  if (existingProfileByBridge && existingProfileByBridge.student_uid !== input.student_uid) {
    // student_uid changed in RMC — update it so the upsert below finds the
    // right record and doesn't create a second profile.
    await db.$executeRawUnsafe(
      `UPDATE student_profiles SET student_uid = ? WHERE id = ?`,
      input.student_uid,
      existingProfileByBridge.id,
    );
    existingProfileByBridge = { ...existingProfileByBridge, student_uid: input.student_uid };
  }

  const existingProfile = existingProfileByBridge
    ?? await db.student_profiles.findUnique({
        where: { student_uid: input.student_uid },
        include: { user: true },
      });

  const existingUserByUsername = await db.users.findUnique({
    where: { username: loginUsername },
    include: { student_profile: true },
  });

  // Reuse existingUserByUsername ONLY if it doesn't belong to another student_profile
  const reusableUser = existingUserByUsername && (!existingUserByUsername.student_profile || existingUserByUsername.student_profile.student_uid === input.student_uid)
    ? existingUserByUsername
    : null;

  // If we can't reuse the user by username because it belongs to someone else,
  // generate a unique username (e.g. by appending student_uid)
  const finalUsername = reusableUser
    ? loginUsername
    : `${loginUsername}_${input.student_uid}`;

  const user =
    existingProfile?.user ??
    reusableUser ??
    (await db.users.create({
      data: {
        username: finalUsername,
        password_hash: await placeholderPasswordHash(),
        role: "STUDENT",
        status: nextUserStatus(input.active),
        full_name: input.full_name,
        phone: input.phone ?? null,
      },
    }));

  const updatedUser = await db.users.update({
    where: { id: user.id },
    data: {
      username: finalUsername,
      full_name: input.full_name,
      phone: input.phone ?? null,
      role: "STUDENT",
      status: nextUserStatus(input.active),
    },
  });

  const studentProfile = await db.student_profiles.upsert({
    where: { student_uid: input.student_uid },
    update: {
      batch_id: primaryBatch.id,
      class_name: input.class_name ?? null,
      roll_no: input.roll_no ?? null,
      active: input.active,
    },
    create: {
      user_id: updatedUser.id,
      student_uid: input.student_uid,
      batch_id: primaryBatch.id,
      class_name: input.class_name ?? null,
      roll_no: input.roll_no ?? null,
      active: input.active,
    },
  });

  // photo_url added via migration 20260605000001 — update via raw SQL until
  // `prisma generate` runs on the server and the typed client reflects the column.
  if (input.photo_url !== undefined) {
    await db.$executeRawUnsafe(
      "UPDATE student_profiles SET photo_url = ? WHERE id = ?",
      input.photo_url ?? null,
      studentProfile.id,
    );
  }

  await db.student_batch_memberships.deleteMany({
    where: {
      student_id: studentProfile.id,
      batch_id: {
        notIn: batches.map((batch) => batch.id),
      },
    },
  });

  for (const batch of batches) {
    await db.student_batch_memberships.upsert({
      where: {
        student_id_batch_id: {
          student_id: studentProfile.id,
          batch_id: batch.id,
        },
      },
      update: {},
      create: {
        student_id: studentProfile.id,
        batch_id: batch.id,
      },
    });
  }

  await db.identity_bridge.upsert({
    where: {
      source_system_source_uid_role: {
        source_system: input.source_system,
        source_uid: input.source_uid,
        role: "STUDENT",
      },
    },
    update: {
      display_name: input.full_name,
      batch_id: primaryBatch.id,
      active: input.active,
      last_synced_at: new Date(),
    },
    create: {
      source_system: input.source_system,
      source_uid: input.source_uid,
      role: "STUDENT",
      display_name: input.full_name,
      batch_id: primaryBatch.id,
      active: input.active,
      last_synced_at: new Date(),
    },
  });

  // Store user_id on the bridge record (raw SQL until prisma generate runs on server).
  // This is what enables stable user resolution on future logins even if student_uid changes.
  try {
    await db.$executeRawUnsafe(
      `UPDATE identity_bridge SET user_id = ? WHERE source_system = ? AND source_uid = ? AND role = 'STUDENT'`,
      updatedUser.id,
      input.source_system,
      input.source_uid,
    );
  } catch {
    // Column not yet added via migration — will populate on next login after migration runs
  }

  return {
    user_id: updatedUser.id,
    username: updatedUser.username,
    role: "STUDENT",
    status: updatedUser.status,
    login_provisioned: false,
    source_system: input.source_system,
    source_uid: input.source_uid,
    student_uid: input.student_uid,
    full_name: input.full_name,
    batch_name: primaryBatch.name,
    batch_names: batchNames,
    class_name: input.class_name ?? null,
    roll_no: input.roll_no ?? null,
    active: input.active,
  };
}

export async function importStudentRecord(input: StudentInput) {
  return prisma.$transaction(async (tx) => {
    return upsertStudentUserAndProfile(input, tx);
  });
}

export async function verifyTeacherRecord(input: TeacherInput) {
  const [bridge, user, profile] = await Promise.all([
    prisma.identity_bridge.findUnique({
      where: {
        source_system_source_uid_role: {
          source_system: input.source_system,
          source_uid: input.source_uid,
          role: input.role,
        },
      },
    }),
    prisma.users.findUnique({
      where: { username: input.username },
      include: { teacher_profile: true },
    }),
    prisma.teacher_profiles.findFirst({
      where: {
        OR: [
          { employee_code: input.employee_code ?? undefined },
          {
            user: {
              username: input.username,
            },
          },
        ],
      },
      include: { user: true },
    }),
  ]);

  return {
    bridge_exists: Boolean(bridge),
    user_exists: Boolean(user),
    profile_exists: Boolean(profile),
    matched: Boolean(bridge || user || profile),
    user,
    profile,
    requested: input,
  };
}

async function upsertTeacherUserAndProfile(input: TeacherInput, db: IdentityDb = prisma): Promise<ImportedUserResult> {
  const existingProfile = await db.teacher_profiles.findFirst({
    where: {
      OR: [
        { employee_code: input.employee_code ?? undefined },
        {
          user: {
            username: input.username,
          },
        },
      ],
    },
    include: { user: true },
  });

  const existingUser = await db.users.findUnique({
    where: { username: input.username },
  });

  const user =
    existingProfile?.user ??
    existingUser ??
    (await db.users.create({
      data: {
        username: input.username,
        password_hash: await placeholderPasswordHash(),
        role: input.role,
        status: nextUserStatus(input.active),
        full_name: input.full_name,
        phone: input.phone ?? null,
      },
    }));

  const updatedUser = await db.users.update({
    where: { id: user.id },
    data: {
      username: input.username,
      full_name: input.full_name,
      phone: input.phone ?? null,
      role: input.role,
      status: nextUserStatus(input.active),
    },
  });

  await db.teacher_profiles.upsert({
    where: { user_id: updatedUser.id },
    update: {
      employee_code: input.employee_code ?? null,
      active: input.active,
    },
    create: {
      user_id: updatedUser.id,
      employee_code: input.employee_code ?? null,
      active: input.active,
    },
  });

  await db.identity_bridge.upsert({
    where: {
      source_system_source_uid_role: {
        source_system: input.source_system,
        source_uid: input.source_uid,
        role: input.role,
      },
    },
    update: {
      display_name: input.full_name,
      active: input.active,
      last_synced_at: new Date(),
    },
    create: {
      source_system: input.source_system,
      source_uid: input.source_uid,
      role: input.role,
      display_name: input.full_name,
      active: input.active,
      last_synced_at: new Date(),
    },
  });

  return {
    user_id: updatedUser.id,
    username: updatedUser.username,
    role: updatedUser.role,
    status: updatedUser.status,
    login_provisioned: false,
  };
}

export async function importTeacherRecord(input: TeacherInput) {
  return prisma.$transaction(async (tx) => {
    const user = await upsertTeacherUserAndProfile(input, tx);
    return {
      ...user,
      source_system: input.source_system,
      source_uid: input.source_uid,
      full_name: input.full_name,
      phone: input.phone ?? null,
      employee_code: input.employee_code ?? null,
      active: input.active,
    };
  });
}

export function normalizeStudentInputs(input: StudentInput | { students: StudentInput[] }): StudentInput[] {
  return "students" in input ? input.students : [input];
}

export function normalizeTeacherInputs(input: TeacherInput | { teachers: TeacherInput[] }): TeacherInput[] {
  return "teachers" in input ? input.teachers : [input];
}

export function normalizeBatchInputs(input: BatchInput | { batches: BatchInput[] }): BatchInput[] {
  return "batches" in input ? input.batches : [input];
}
