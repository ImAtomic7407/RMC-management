import { prisma } from "./shared/prisma";

async function main() {
  const releases = await prisma.apk_releases.findMany({
    orderBy: { version_code: 'desc' }
  });
  console.log("APK Releases:", JSON.stringify(releases, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
