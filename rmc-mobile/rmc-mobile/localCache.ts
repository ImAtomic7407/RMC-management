import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'rmcdeviceidv1';
const FALLBACK_DEVICE_ID_KEY = 'rmcdeviceidfallbackv1';

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function makeDeviceId() {
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function readLocalJson<T>(key: string): Promise<T | null> {
  try {
    return parseJson<T>(await Storage.getItem(key));
  } catch {
    return null;
  }
}

export async function writeLocalJson<T>(key: string, value: T): Promise<void> {
  try {
    await Storage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort storage. File cache remains the fallback.
  }
}

export async function removeLocalJson(key: string): Promise<void> {
  try {
    await Storage.removeItem(key);
  } catch {
    // Best-effort cleanup.
  }
}

export async function getOrCreateDeviceId(): Promise<string> {
  let secureValue: string | null = null;
  try {
    secureValue = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  } catch {
    // Fall through
  }

  const fallbackValue = await readLocalJson<string>(FALLBACK_DEVICE_ID_KEY);

  if (secureValue) {
    if (!fallbackValue) {
      await writeLocalJson(FALLBACK_DEVICE_ID_KEY, secureValue).catch(() => null);
    }
    return secureValue;
  }

  if (fallbackValue) {
    try {
      await SecureStore.setItemAsync(DEVICE_ID_KEY, fallbackValue);
    } catch {
      // Keep fallback copy
    }
    return fallbackValue;
  }

  const next = makeDeviceId();
  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, next);
  } catch {
    // Ignore
  }
  await writeLocalJson(FALLBACK_DEVICE_ID_KEY, next).catch(() => null);
  return next;
}

