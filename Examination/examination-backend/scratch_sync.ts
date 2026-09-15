process.env.DATABASE_URL = "file:A:/RMC_Local_Installer/Examination/examination-backend/prisma/dev.db";

import { syncRmcRoster } from "./src/modules/identity/rmc-sync";

async function run() {
  console.log("Running RMC Roster Sync on correct DB...");
  const result = await syncRmcRoster();
  console.log("Sync Result:", result);
}

run().catch(console.error);
