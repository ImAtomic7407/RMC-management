import { readFile } from "node:fs/promises";
import path from "node:path";

export type AppUpdateManifest = {
  status: "available" | "not_available";
  latest_version_code: number;
  latest_version_name: string;
  minimum_supported_version_code?: number | null;
  download_url: string;
  release_notes: string[];
  mandatory: boolean;
  sha256?: string | null;
  published_at?: string | null;
};

const DEFAULT_MANIFEST: AppUpdateManifest = {
  status: "available",
  latest_version_code: 2,
  latest_version_name: "1.1.0",
  minimum_supported_version_code: 1,
  download_url: "/uploads/releases/examination-compose-v2-debug.apk",
  release_notes: [
    "Native in-app update check enabled.",
    "Teacher batch assignment visibility added.",
    "Secure exam and review flows remain connected.",
  ],
  mandatory: false,
  sha256: null,
  published_at: new Date().toISOString(),
};

const MANIFEST_PATH = path.resolve(process.cwd(), "uploads", "app-update.json");

export async function readAppUpdateManifest(): Promise<AppUpdateManifest> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppUpdateManifest>;
    return {
      ...DEFAULT_MANIFEST,
      ...parsed,
      status: parsed.status === "not_available" ? "not_available" : "available",
      latest_version_code: Number(parsed.latest_version_code ?? DEFAULT_MANIFEST.latest_version_code),
      latest_version_name: String(parsed.latest_version_name ?? DEFAULT_MANIFEST.latest_version_name),
      minimum_supported_version_code: parsed.minimum_supported_version_code == null
        ? DEFAULT_MANIFEST.minimum_supported_version_code
        : Number(parsed.minimum_supported_version_code),
      download_url: String(parsed.download_url ?? DEFAULT_MANIFEST.download_url),
      release_notes: Array.isArray(parsed.release_notes)
        ? parsed.release_notes.map((note) => String(note))
        : DEFAULT_MANIFEST.release_notes,
      mandatory: Boolean(parsed.mandatory ?? DEFAULT_MANIFEST.mandatory),
      sha256: parsed.sha256 == null ? DEFAULT_MANIFEST.sha256 : String(parsed.sha256),
      published_at: parsed.published_at == null ? DEFAULT_MANIFEST.published_at : String(parsed.published_at),
    };
  } catch {
    return DEFAULT_MANIFEST;
  }
}
