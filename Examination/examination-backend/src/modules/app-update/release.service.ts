import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../../shared/prisma";
import { log } from "../../shared/logger";

const execAsync = promisify(exec);

export type AppUpdateStrategy = "PATCH_CHAIN" | "FULL_APK" | "NONE";

export interface UpdateResponse {
  updateAvailable: boolean;
  strategy: AppUpdateStrategy;
  targetVersionCode: number;
  targetVersionName: string;
  targetSha256: string;
  patches: {
    fromVersion: number;
    toVersion: number;
    url: string;
    sha256: string;
    size: number;
  }[];
  apkUrl: string | null;
  mandatory: boolean;
  releaseNotes: string[];
}

const MAX_PATCH_CHAIN = 3;
const PATCH_SAVINGS_THRESHOLD = 0.60; // total patch size must be < 60% of full APK

/**
 * Calculates SHA256 of a file
 */
export async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let bytesRead = 0;
  while ((bytesRead = (await handle.read(buffer, 0, buffer.length, null)).bytesRead) > 0) {
    hash.update(buffer.subarray(0, bytesRead));
  }
  await handle.close();
  return hash.digest("hex");
}

/**
 * Register a new APK release in the database and pre-generate patches against the last 3 releases
 */
export async function registerRelease(params: {
  versionCode: number;
  versionName: string;
  apkPath: string; // absolute or relative path to backend uploads
  releaseNotes: string[];
  mandatory: boolean;
}): Promise<any> {
  // 1. Validate apk path and get file size/sha256
  const fullPath = path.resolve(process.cwd(), params.apkPath);
  const stat = await fs.stat(fullPath);
  const sha256 = await calculateFileSha256(fullPath);

  // 2. Insert into DB (upsert)
  const release = await prisma.apk_releases.upsert({
    where: { version_code: params.versionCode },
    update: {
      version_name: params.versionName,
      apk_path: params.apkPath,
      file_size: stat.size,
      sha256,
      release_notes: JSON.stringify(params.releaseNotes),
      mandatory: params.mandatory,
    },
    create: {
      version_code: params.versionCode,
      version_name: params.versionName,
      apk_path: params.apkPath,
      file_size: stat.size,
      sha256,
      release_notes: JSON.stringify(params.releaseNotes),
      mandatory: params.mandatory,
    },
  });

  // 3. Trigger patch generation in the background
  // Generate patches from recent versions (up to MAX_PATCH_CHAIN versions behind)
  generatePatchesForNewRelease(params.versionCode, params.apkPath).catch((err) => {
    log.system.error("Failed to pre-generate patches in background:", err);
  });

  return release;
}

/**
 * Background runner to generate binary diffs for a new release against prior releases
 */
async function generatePatchesForNewRelease(newVersionCode: number, newApkPath: string) {
  const previousReleases = await prisma.apk_releases.findMany({
    where: {
      version_code: {
        lt: newVersionCode,
        gte: newVersionCode - MAX_PATCH_CHAIN,
      },
    },
    orderBy: { version_code: "desc" },
  });

  const scriptPath = path.resolve(process.cwd(), "scripts", "generate_patch.py");
  const newApkFullPath = path.resolve(process.cwd(), newApkPath);
  const patchesDir = path.resolve(process.cwd(), "uploads", "patches");
  await fs.mkdir(patchesDir, { recursive: true });

  for (const oldRelease of previousReleases) {
    const oldApkFullPath = path.resolve(process.cwd(), oldRelease.apk_path);
    const patchFileName = `v${oldRelease.version_code}_to_v${newVersionCode}.patch.gz`;
    const patchFullPath = path.join(patchesDir, patchFileName);
    const patchRelativePath = `uploads/patches/${patchFileName}`;

    try {
      log.system.info(`[OTA-Patch] Starting generation: v${oldRelease.version_code} -> v${newVersionCode}`);
      // Run Python bsdiff script
      const cmd = `python "${scriptPath}" "${oldApkFullPath}" "${newApkFullPath}" "${patchFullPath}"`;
      const { stdout } = await execAsync(cmd);

      // Parse metadata from stdout
      const metaMatch = stdout.match(/METADATA_JSON=(.*)/);
      if (!metaMatch) {
        throw new Error("Patch script output did not contain METADATA_JSON line");
      }

      const meta = JSON.parse(metaMatch[1].trim());
      const rawPatchSha256 = meta.raw_patch_sha256;
      const compressedSize = meta.patch_size;

      // Save to database
      await prisma.apk_patches.upsert({
        where: {
          from_version_code_to_version_code: {
            from_version_code: oldRelease.version_code,
            to_version_code: newVersionCode,
          },
        },
        update: {
          patch_path: patchRelativePath,
          patch_size: compressedSize,
          full_apk_size: newApkFullPath ? (await fs.stat(newApkFullPath)).size : 0,
          sha256: rawPatchSha256,
        },
        create: {
          from_version_code: oldRelease.version_code,
          to_version_code: newVersionCode,
          patch_path: patchRelativePath,
          patch_size: compressedSize,
          full_apk_size: newApkFullPath ? (await fs.stat(newApkFullPath)).size : 0,
          sha256: rawPatchSha256,
        },
      });

      log.system.info(`[OTA-Patch] Successfully generated patch: v${oldRelease.version_code} -> v${newVersionCode}`);
    } catch (err: any) {
      log.system.error(`[OTA-Patch] Failed generating patch v${oldRelease.version_code} -> v${newVersionCode}:`, err);
    }
  }
}

/**
 * Calculates the best update path for a client
 */
export async function getBestUpdatePath(clientVersionCode: number): Promise<UpdateResponse> {
  // 1. Get the latest release
  const latestRelease = await prisma.apk_releases.findFirst({
    orderBy: { version_code: "desc" },
  });

  if (!latestRelease) {
    return {
      updateAvailable: false,
      strategy: "NONE",
      targetVersionCode: clientVersionCode,
      targetVersionName: "",
      targetSha256: "",
      patches: [],
      apkUrl: null,
      mandatory: false,
      releaseNotes: [],
    };
  }

  if (clientVersionCode >= latestRelease.version_code) {
    return {
      updateAvailable: false,
      strategy: "NONE",
      targetVersionCode: latestRelease.version_code,
      targetVersionName: latestRelease.version_name,
      targetSha256: latestRelease.sha256,
      patches: [],
      apkUrl: null,
      mandatory: false,
      releaseNotes: [],
    };
  }

  // Check if we can construct a patch chain from clientVersionCode to latestRelease.version_code
  const pathLength = latestRelease.version_code - clientVersionCode;
  
  if (pathLength <= MAX_PATCH_CHAIN && clientVersionCode > 0) {
    // 1. Try to find a direct patch from client version to latest release version
    const directPatch = await prisma.apk_patches.findUnique({
      where: {
        from_version_code_to_version_code: {
          from_version_code: clientVersionCode,
          to_version_code: latestRelease.version_code,
        },
      },
    });

    if (directPatch) {
      const totalPatchSize = directPatch.patch_size;
      const maxAllowedSize = latestRelease.file_size * PATCH_SAVINGS_THRESHOLD;
      if (totalPatchSize < maxAllowedSize) {
        const intermediateReleases = await prisma.apk_releases.findMany({
          where: {
            version_code: {
              gt: clientVersionCode,
              lte: latestRelease.version_code,
            },
            mandatory: true,
          },
        });
        const isMandatory = intermediateReleases.length > 0;

        let notes: string[] = [];
        try {
          notes = JSON.parse(latestRelease.release_notes);
        } catch {
          notes = [latestRelease.release_notes];
        }

        return {
          updateAvailable: true,
          strategy: "PATCH_CHAIN",
          targetVersionCode: latestRelease.version_code,
          targetVersionName: latestRelease.version_name,
          targetSha256: latestRelease.sha256,
          patches: [{
            fromVersion: directPatch.from_version_code,
            toVersion: directPatch.to_version_code,
            url: `/api/app/patches/v${directPatch.from_version_code}_to_v${directPatch.to_version_code}.patch.gz`,
            sha256: directPatch.sha256,
            size: directPatch.patch_size,
          }],
          apkUrl: null,
          mandatory: isMandatory,
          releaseNotes: notes,
        };
      }
    }

    // 2. Fall back to sequence of hops if no direct patch is found
    const patchChain: any[] = [];
    let currentCode = clientVersionCode;
    let chainBroken = false;
    let totalPatchSize = 0;

    for (let nextCode = clientVersionCode + 1; nextCode <= latestRelease.version_code; nextCode++) {
      const patch = await prisma.apk_patches.findUnique({
        where: {
          from_version_code_to_version_code: {
            from_version_code: currentCode,
            to_version_code: nextCode,
          },
        },
      });

      if (!patch) {
        chainBroken = true;
        break;
      }

      patchChain.push(patch);
      totalPatchSize += patch.patch_size;
      currentCode = nextCode;
    }

    if (!chainBroken) {
      // Check savings threshold: total patches size < PATCH_SAVINGS_THRESHOLD * full APK size
      const maxAllowedSize = latestRelease.file_size * PATCH_SAVINGS_THRESHOLD;
      if (totalPatchSize < maxAllowedSize) {
        // Find if any step in the path or future releases are mandatory
        const intermediateReleases = await prisma.apk_releases.findMany({
          where: {
            version_code: {
              gt: clientVersionCode,
              lte: latestRelease.version_code,
            },
            mandatory: true,
          },
        });
        const isMandatory = intermediateReleases.length > 0;

        let notes: string[] = [];
        try {
          notes = JSON.parse(latestRelease.release_notes);
        } catch {
          notes = [latestRelease.release_notes];
        }

        return {
          updateAvailable: true,
          strategy: "PATCH_CHAIN",
          targetVersionCode: latestRelease.version_code,
          targetVersionName: latestRelease.version_name,
          targetSha256: latestRelease.sha256,
          patches: patchChain.map((p) => ({
            fromVersion: p.from_version_code,
            toVersion: p.to_version_code,
            url: `/api/app/patches/v${p.from_version_code}_to_v${p.to_version_code}.patch.gz`,
            sha256: p.sha256,
            size: p.patch_size,
          })),
          apkUrl: null,
          mandatory: isMandatory,
          releaseNotes: notes,
        };
      }
    }
  }

  // Default fallback to full APK
  let notes: string[] = [];
  try {
    notes = JSON.parse(latestRelease.release_notes);
  } catch {
    notes = [latestRelease.release_notes];
  }

  return {
    updateAvailable: true,
    strategy: "FULL_APK",
    targetVersionCode: latestRelease.version_code,
    targetVersionName: latestRelease.version_name,
    targetSha256: latestRelease.sha256,
    patches: [],
    apkUrl: `/${latestRelease.apk_path}`,
    mandatory: latestRelease.mandatory,
    releaseNotes: notes,
  };
}
