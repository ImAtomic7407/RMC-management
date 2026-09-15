import { prisma } from "../shared/prisma";
import { clearDemoData } from "../shared/demo-reset";

async function main(): Promise<void> {
  if (process.env.ALLOW_EXAM_DEMO_RESET !== "true") {
    throw new Error("Set ALLOW_EXAM_DEMO_RESET=true to clear demo exam data.");
  }

  await clearDemoData(prisma);
  console.log("Demo exam data cleared.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
