import { z } from "zod";

const activeSchema = z.boolean().optional().default(true);

export const batchUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  academic_year: z.string().max(20).optional().nullable(),
  active: activeSchema,
});

export const studentBridgeRecordSchema = z.object({
  source_system: z.string().min(1).max(50),
  source_uid: z.string().min(1).max(100),
  student_uid: z.string().min(1).max(64),
  username: z.string().min(1).max(100).optional(),
  full_name: z.string().min(1).max(150),
  phone: z.string().max(20).optional().nullable(),
  batch_name: z.string().min(1).max(120),
  batch_names: z.array(z.string().min(1).max(120)).min(1).optional(),
  class_name: z.string().max(50).optional().nullable(),
  roll_no: z.string().max(30).optional().nullable(),
  active: activeSchema,
});

export const teacherBridgeRecordSchema = z.object({
  source_system: z.string().min(1).max(50),
  source_uid: z.string().min(1).max(100),
  username: z.string().min(1).max(100),
  full_name: z.string().min(1).max(150),
  phone: z.string().max(20).optional().nullable(),
  employee_code: z.string().max(64).optional().nullable(),
  role: z.enum(["TEACHER", "ADMIN"]),
  active: activeSchema,
});

export const singleOrManyStudentSchema = z.union([
  studentBridgeRecordSchema,
  z.object({ students: z.array(studentBridgeRecordSchema).min(1) }),
]);

export const singleOrManyTeacherSchema = z.union([
  teacherBridgeRecordSchema,
  z.object({ teachers: z.array(teacherBridgeRecordSchema).min(1) }),
]);

export const singleBatchUpsertSchema = z.union([
  batchUpsertSchema,
  z.object({ batches: z.array(batchUpsertSchema).min(1) }),
]);
