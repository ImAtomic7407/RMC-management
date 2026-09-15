import { prisma } from "./src/shared/prisma";
import { env } from "./src/config/env";

async function run() {
  console.log("DATABASE_URL from process.env:", process.env.DATABASE_URL);
  console.log("DATABASE_URL from config/env:", env.DATABASE_URL);
  const count = await prisma.users.count();
  console.log("Count in Prisma:", count);
}

run().catch(console.error);
