import { registerRelease } from "./modules/app-update/release.service";

async function main() {
  console.log("Registering release v30...");
  const release = await registerRelease({
    versionCode: 30,
    versionName: "1.5.14",
    apkPath: "uploads/apk/rmc-exam-v1.5.14.apk",
    releaseNotes: [
      "Fixed loop bug during gate scanning with missing permissions.",
      "Blocked auto-start transitions when accessibility permission is missing."
    ],
    mandatory: false,
  });
  console.log("Release registered successfully:", JSON.stringify(release, null, 2));
}

main().catch(console.error);
