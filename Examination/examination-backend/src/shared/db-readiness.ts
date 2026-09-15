import { prisma } from "./prisma";

export type DatabaseReadiness = {
  connected: boolean;
  schemaReady: boolean;
};

export async function getDatabaseReadiness(): Promise<DatabaseReadiness> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const tables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('users', 'student_profiles', 'teacher_profiles', 'exam_audit_logs')
    `;
    return {
      connected: true,
      schemaReady: tables.some((table) => table.name === "users"),
    };
  } catch {
    return {
      connected: false,
      schemaReady: false,
    };
  }
}
