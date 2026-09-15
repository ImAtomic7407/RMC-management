/**
 * Persistent JWT keystore — survives server restarts.
 *
 * Keeps the last MAX_KEYS signing secrets on disk.  New tokens are always
 * signed with the current (newest) key.  Verification tries the current key
 * first (fast path) and falls back to the previous keys so that tokens issued
 * before a restart remain valid until they naturally expire.
 *
 * Key rotation happens automatically on startup when:
 *   - The keystore file doesn't exist yet (first boot), or
 *   - The current key is older than KEY_ROTATION_DAYS days.
 *
 * The keystore file must live on persistent storage (same directory as the
 * database).  Set JWT_KEYSTORE_PATH env var to override the path.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_KEYS = 3;
const KEY_ROTATION_DAYS = 30;

interface KeyEntry {
  id: string;
  secret: string;
  createdAt: string; // ISO-8601
}

interface Keystore {
  currentKeyId: string;
  keys: KeyEntry[];
}

function defaultKeystorePath(): string {
  return (
    process.env.JWT_KEYSTORE_PATH ||
    path.join(process.cwd(), "prisma", "jwt-keystore.json")
  );
}

function loadFromDisk(filePath: string): Keystore | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Keystore;
    if (
      typeof parsed.currentKeyId === "string" &&
      Array.isArray(parsed.keys) &&
      parsed.keys.length > 0
    ) {
      return parsed;
    }
  } catch {
    // Missing or malformed — will create fresh
  }
  return null;
}

function saveToDisk(filePath: string, store: Keystore): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("[jwt-keystore] Failed to write keystore:", err);
  }
}

function generateKey(): KeyEntry {
  return {
    id: crypto.randomUUID(),
    secret: crypto.randomBytes(64).toString("hex"),
    createdAt: new Date().toISOString(),
  };
}

function needsRotation(currentKey: KeyEntry): boolean {
  const created = new Date(currentKey.createdAt).getTime();
  const ageMs = Date.now() - created;
  return ageMs > KEY_ROTATION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Singleton keystore loaded once at process start.
 * All reads/writes go through this object — no async, no DB.
 */
class JwtKeyStore {
  private store!: Keystore;
  private filePath!: string;

  init(filePath?: string): void {
    this.filePath = filePath ?? defaultKeystorePath();
    const existing = loadFromDisk(this.filePath);

    if (!existing) {
      // First boot: create a brand-new keystore.
      const key = generateKey();
      this.store = { currentKeyId: key.id, keys: [key] };
      saveToDisk(this.filePath, this.store);
      console.log(`[jwt-keystore] Created new keystore at ${this.filePath}`);
      return;
    }

    const currentKey = existing.keys.find((k) => k.id === existing.currentKeyId);
    if (!currentKey || needsRotation(currentKey)) {
      // Rotate: prepend a new key, keep the last MAX_KEYS.
      const newKey = generateKey();
      const trimmed = [newKey, ...existing.keys].slice(0, MAX_KEYS);
      this.store = { currentKeyId: newKey.id, keys: trimmed };
      saveToDisk(this.filePath, this.store);
      console.log(`[jwt-keystore] Rotated signing key (${trimmed.length} key(s) in store)`);
    } else {
      this.store = existing;
      console.log(
        `[jwt-keystore] Loaded ${existing.keys.length} key(s) from ${this.filePath} — ` +
        `current key age: ${Math.round((Date.now() - new Date(currentKey.createdAt).getTime()) / 86_400_000)}d`
      );
    }
  }

  /** The secret to use when signing new tokens. */
  get currentSecret(): string {
    const key = this.store.keys.find((k) => k.id === this.store.currentKeyId);
    if (!key) throw new Error("[jwt-keystore] Current key not found in store.");
    return key.secret;
  }

  /** The key-id to embed in the JWT header. */
  get currentKeyId(): string {
    return this.store.currentKeyId;
  }

  /**
   * Returns all secrets ordered: current first, then older ones.
   * Used during verification — try current first for speed, fall back
   * to older keys so tokens from the last N restarts still work.
   */
  get allSecrets(): { id: string; secret: string }[] {
    const current = this.store.keys.filter((k) => k.id === this.store.currentKeyId);
    const rest = this.store.keys.filter((k) => k.id !== this.store.currentKeyId);
    return [...current, ...rest].map(({ id, secret }) => ({ id, secret }));
  }
}

export const jwtKeyStore = new JwtKeyStore();
