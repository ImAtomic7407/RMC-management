import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ExamNavigator } from './ExamNavigator';
import { getExamBaseUrl, setExamBaseUrl, setExamWsPort, STORAGE_EXAM_TOKEN, STORAGE_EXAM_USER } from './services/api';
import { T } from './theme';

/**
 * Credentials handed in by the host RMC app for the currently logged-in user.
 *  - staff:   the RMC staff username + the password persisted at login time
 *  - student: the student_uid from the active student session
 *
 * `devUsername` / `devPassword` are an optional fallback used ONLY when the
 * RMC bridge login fails (e.g. the RMC backend is unreachable from the exam
 * backend during local testing). This keeps the embedded tab usable in the
 * test build without weakening the production bridge path.
 */
export type ExamCredentials =
  | { kind: 'staff'; username: string; password: string | null; devUsername?: string; devPassword?: string }
  | { kind: 'student'; uid: string; devUsername?: string; devPassword?: string };

interface ExamEntryProps {
  role: 'student' | 'teacher';
  /** Root URL of the EXAMINATION backend, e.g. http://192.168.1.5:4200 */
  examServerUrl: string;
  /** WebSocket port for the examination backend (defaults to 4200). */
  examWsPort?: number;
  credentials: ExamCredentials;
  onExit?: () => void;
}

type Phase = 'authenticating' | 'ready' | 'error';

async function postJson(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${getExamBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json };
}

async function storeSession(json: any) {
  const token = json?.access_token;
  if (!token) throw new Error('No access token returned by exam backend.');
  await SecureStore.setItemAsync(STORAGE_EXAM_TOKEN, token);
  if (json?.user) {
    await SecureStore.setItemAsync(STORAGE_EXAM_USER, JSON.stringify(json.user)).catch(() => {});
  }
}

/**
 * Obtain (and persist) an exam-backend JWT for the active RMC user.
 * Tries the production RMC bridge first; falls back to a standard dev login
 * only if dev credentials were supplied and the bridge failed.
 */
async function ensureExamSession(creds: ExamCredentials): Promise<void> {
  let bridge: { ok: boolean; status: number; json: any };

  if (creds.kind === 'staff') {
    bridge = await postJson('/auth/login/rmc/staff', {
      username: creds.username,
      password: creds.password ?? '',
    });
  } else {
    bridge = await postJson('/auth/login/rmc/student', { uid: creds.uid });
  }

  if (bridge.ok && bridge.json?.access_token) {
    await storeSession(bridge.json);
    return;
  }

  // Dev fallback (test builds only) — standard username/password login.
  if (creds.devUsername && creds.devPassword) {
    const dev = await postJson('/auth/login', {
      username: creds.devUsername,
      password: creds.devPassword,
    });
    if (dev.ok && dev.json?.access_token) {
      await storeSession(dev.json);
      return;
    }
    throw new Error(
      dev.json?.message || bridge.json?.message || `Exam login failed (${bridge.status}).`
    );
  }

  throw new Error(bridge.json?.message || `Exam login failed (${bridge.status}).`);
}

export function ExamEntry({ role, examServerUrl, examWsPort = 4200, credentials, onExit }: ExamEntryProps) {
  const [phase, setPhase] = useState<Phase>('authenticating');
  const [error, setError] = useState<string | null>(null);

  const authenticate = useCallback(async () => {
    setPhase('authenticating');
    setError(null);
    try {
      setExamBaseUrl(examServerUrl);
      setExamWsPort(examWsPort);
      await ensureExamSession(credentials);
      setPhase('ready');
    } catch (e: any) {
      setError(e?.message || 'Unable to start the examination module.');
      setPhase('error');
    }
  }, [examServerUrl, examWsPort, credentials]);

  useEffect(() => { authenticate(); }, [authenticate]);

  if (phase === 'authenticating') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={T.primary} />
        <Text style={s.loadingText}>Connecting to examination server…</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={s.center}>
        <Text style={s.errIcon}>⚠️</Text>
        <Text style={s.errTitle}>Examination Unavailable</Text>
        <Text style={s.errBody}>{error}</Text>
        <View style={s.errBtns}>
          <TouchableOpacity style={s.retryBtn} onPress={authenticate}>
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
          {onExit && (
            <TouchableOpacity style={s.exitBtn} onPress={onExit}>
              <Text style={s.exitBtnText}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return <ExamNavigator role={role} onExit={onExit} />;
}

const s = StyleSheet.create({
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.bg, padding: 28 },
  loadingText:{ color: T.textSecondary, marginTop: 16, fontSize: 15, fontWeight: '500' },
  errIcon:    { fontSize: 44, marginBottom: 12 },
  errTitle:   { fontSize: 19, fontWeight: '800', color: T.textPrimary, marginBottom: 8 },
  errBody:    { fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  errBtns:    { flexDirection: 'row', gap: 12 },
  retryBtn:   { backgroundColor: T.primary, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 100 },
  retryBtnText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  exitBtn:    { backgroundColor: T.surfaceAlt, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 100, borderWidth: 1.5, borderColor: T.border },
  exitBtnText:{ color: T.textSecondary, fontWeight: '700', fontSize: 15 },
});
