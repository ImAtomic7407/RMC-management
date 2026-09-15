process.env.DATABASE_URL = "file:A:/RMC_Local_Installer/Examination/examination-backend/prisma/dev.db";

import { prisma } from "./src/shared/prisma";
import { listStudentExams } from "./src/modules/student/service";

async function run() {
  const count = await prisma.users.count();
  console.log("Count in Prisma with absolute DB path:", count);

  const users = await prisma.users.findMany({
    where: {
      OR: [
        { username: { contains: "Satyam" } },
        { full_name: { contains: "Satyam" } }
      ]
    }
  });

  console.log("Users found:", users);

  for (const user of users) {
    try {
      const result = await listStudentExams(prisma, {
        id: user.id,
        username: user.username,
        role: "STUDENT"
      });
      console.log(`\n===================================\nResult for user: ${user.full_name} (${user.username}, ID ${user.id})`);
      console.log("Exams list:", result.exams.map(e => ({ id: e.id, title: e.title, status: e.status, attemptStatus: e.attempt.status })));
    } catch (err: any) {
      console.log(`\n===================================\nError for user: ${user.full_name} (${user.username}, ID ${user.id}):`, err.message);
    }
  }
}

run().catch(console.error);
