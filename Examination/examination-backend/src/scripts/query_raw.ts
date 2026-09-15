import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("=== SQLITE MASTER TABLES ===");
  const tables = await prisma.$queryRawUnsafe<any[]>(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );

  for (const table of tables) {
    if (table.name === 'sqlite_sequence') continue;
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as count FROM "${table.name}"`
    );
    const count = result[0]?.count;
    console.log(`Table ${table.name}: ${count?.toString()}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
