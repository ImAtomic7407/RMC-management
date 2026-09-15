import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import Pdf from 'react-native-pdf';
import * as XLSX from 'xlsx';
import { getOrCreateDeviceId, readLocalJson, writeLocalJson } from './localCache';
import { ExamEntry, type ExamCredentials } from './examination-module';

type StudentProfile = {
  id: number;
  name: string;
  student_uid: string;
  secure_token?: string | null;
  phone: string;
  father_name: string;
  guardian_phone: string;
  father_phone?: string;
  parent_phone?: string;
  address: string;
  student_class: string;
  current_batch: string;
  batch_name?: string;
  batches?: string[] | string;
  system_batches?: string[] | string;
  primary_system_batch?: string;
  aspiration: string;
  photo: string | null;
  photo_path?: string | null;
  qr_path?: string | null;
  fbc_no?: string;
  attendance_percent?: number;
  status: string;
};

type StaffUser = {
  id: number;
  username: string;
  full_name: string;
  role: 'teacher' | 'staff';
};

type StaffBootstrapPayload = {
  batches: Batch[];
  currentSession: AttendanceWorkspaceSession | null;
  students: CachedStudentRow[];
};

type SessionInfo = { type: 'student'; student: StudentProfile } | { type: 'staff'; user: StaffUser } | null;
type SessionKind = 'student' | 'staff' | undefined;
type GuestTab = 'welcome' | 'student' | 'staff' | 'register';
type StudentTab = 'overview' | 'doubts' | 'examination';
type StaffTab = 'home' | 'attendance' | 'students' | 'batches' | 'cards' | 'materials' | 'notifications' | 'reports' | 'fees' | 'sms' | 'doubts' | 'admin' | 'register' | 'examination';
type StaffSidebarItem = {
  key: StaffTab;
  label: string;
  requiredRole?: 'staff' | 'admin' | 'super_admin';
  hidden?: boolean;
};
type StaffNotificationSection = 'notices' | 'absentees' | 'leads' | 'id_requests';
type WorkspaceRole = 'student' | 'staff';

type FeeDashboardPlanRow = {
  id?: number;
  plan_id?: number;
  student_uid?: string;
  student_name?: string;
  batch_name?: string;
  status?: string;
  plan_mode?: string;
  net_amount?: number;
  total_paid?: number;
  amount_paid?: number;
  remaining_balance?: number;
  next_due_date?: string;
  due_date?: string;
  priority_label?: string;
  days_until_due?: number;
};

type FeeDashboardPayload = {
  status?: string;
  today_collection?: number;
  month_collection?: number;
  active_plan_count?: number;
  overdue_count?: number;
  upcoming_due_count?: number;
  overdue_plans?: FeeDashboardPlanRow[];
  recent_plans?: FeeDashboardPlanRow[];
};

type FeePriorityRow = {
  student_uid?: string;
  student_name?: string;
  batch_name?: string;
  next_due_date?: string;
  amount_due?: number;
  days_until_due?: number;
  priority_label?: string;
  plan_id?: number;
  installment_id?: number;
};

type FeeStudentSummaryPayload = {
  status?: string;
  student?: { student_uid?: string; name?: string; phone?: string; batch_name?: string } | null;
  summary?: Record<string, unknown> | null;
  plans?: FeeDashboardPlanRow[];
};

type FeeCreatePlanMode = 'one_time' | 'installment';

type FeeCreatePlanResponse = {
  status?: string;
  plan?: FeeDashboardPlanRow & {
    installments?: Array<Record<string, unknown>>;
  };
  student?: { student_uid?: string; name?: string; phone?: string; batch_name?: string } | null;
  snapshot?: FeeDashboardPlanRow & {
    installments?: Array<Record<string, unknown>>;
  };
};

type StaffNotification = {
  id: number;
  title?: string;
  content: string;
  notification_type?: string;
  created_at: string;
};

type MobileUpdateMode = 'none' | 'config' | 'ota' | 'apk';

type MobileAppConfig = {
  notification_preview_limit?: number;
  home_feed_limit?: number;
  welcome_hero_offset_y?: number;
};

type MobileFeedItem = {
  id: string;
  kind: 'notice' | 'material' | 'alert';
  title: string;
  body: string;
  created_at: string;
  target_batch?: string;
};

type MobileManifestPayload = {
  status: string;
  app: {
    version: string;
    min_version: string;
    apk_version?: string;
    apk_min_version?: string;
    update_mode: MobileUpdateMode;
    force_update: boolean;
    apk_url: string;
    config_version: number;
    release_notes?: string[];
    config?: MobileAppConfig;
  };
  feed?: {
    notices?: NoticeItem[];
    materials?: MaterialItem[];
    items?: MobileFeedItem[];
  };
  checked_at?: string;
};

function isStaffOtaUpdateMode(updateMode: unknown) {
  const normalized = String(updateMode || '').trim().toLowerCase();
  return normalized === 'config' || normalized === 'ota';
}

function isApkUpdateAvailable(currentVersion: string, manifestApp: MobileManifestPayload['app'] | null | undefined) {
  const normalizedCurrent = String(currentVersion || '').trim();
  const targetVersion = String(
    manifestApp?.apk_version ||
    manifestApp?.version ||
    manifestApp?.apk_min_version ||
    manifestApp?.min_version ||
    ''
  ).trim();
  if (!normalizedCurrent || !targetVersion) return false;
  return compareVersionStrings(normalizedCurrent, targetVersion) < 0;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return String(error.message || '').trim();
  return String(error || '').trim();
}

function isTransientExpoUpdateError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return [
    'invalid request',
    'request denied',
    'network request failed',
    'timed out',
    'timeout',
    'failed to fetch',
    'fetch failed',
    'unexpected error communicating with the server',
    'cannot connect',
    'service unavailable',
    'temporarily unavailable'
  ].some((needle) => message.includes(needle));
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options?: {
    attempts?: number;
    delaysMs?: number[];
    shouldRetry?: (error: unknown) => boolean;
  }
) {
  const attempts = Math.max(1, Math.floor(options?.attempts ?? 3));
  const delaysMs = Array.isArray(options?.delaysMs) && options.delaysMs.length > 0
    ? options.delaysMs
    : [350, 1200];
  const shouldRetry = options?.shouldRetry || (() => true);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = shouldRetry(error);
      if (!retryable || attempt >= attempts - 1) {
        throw error;
      }
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] || delaysMs[delaysMs.length - 1] || 250;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, delay)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Operation failed');
}

function shouldRetryManifestFetch(error: unknown) {
  const status = extractApiStatus(error);
  if (Number.isFinite(status)) {
    return status >= 500;
  }
  return true;
}

function syncExpoUpdateRequestHeadersForSession(sessionType: SessionKind) {
  if (Platform.OS === 'web' || !Updates.isEnabled || typeof Updates.setUpdateRequestHeadersOverride !== 'function') return;
  Updates.setUpdateRequestHeadersOverride(sessionType === 'staff'
    ? { 'expo-channel-name': 'staff' }
    : null);
}

type LeadItem = {
  id: number;
  name: string;
  phone: string;
  email?: string;
  message?: string;
  source?: string;
  created_at: string;
  is_read: number;
  id_card_allowed: number;
  id_card_allowed_by?: string | null;
  id_card_allowed_at?: string | null;
};

type Batch = {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
};

type BatchSummary = {
  name: string;
  description?: string;
  created_at?: string;
  strength: number;
  active_session?: {
    id: number;
    session_name: string;
    start_time: string;
    is_late: number;
  } | null;
  last_session?: {
    id: number;
    session_name: string;
    start_time: string;
    end_time: string;
  } | null;
};

type StudentRow = StudentProfile & {
  created_at?: string;
  batch_name?: string;
  batches?: string[] | string;
  system_batches?: string[] | string;
  primary_system_batch?: string;
  photo_path?: string | null;
  attendance_status?: number;
  attendance_marked_offline?: boolean;
  attendance_marked_at?: string;
  attendance_state?: 'not_marked' | 'present' | 'late' | 'absent';
};

type SessionCurrentResponse = {
  session_id: number;
  session_name: string;
  batch_id: string;
  column_name: string;
  is_late: number;
};

type AttendanceWorkspaceSession = SessionCurrentResponse & {
  sessionKey?: string;
  localSessionId?: string | null;
  serverSessionId?: number | null;
  sessionName?: string;
  columnName?: string;
  title?: string;
  displayName?: string;
  name?: string;
  syncStatus?: 'synced' | 'pending_create' | 'pending_sync' | 'failed';
  status?: 'open' | 'closed';
  created_at?: string;
  closed_at?: string | null;
  session_id?: number;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  lateSyncStatus?: 'synced' | 'pending_sync' | 'failed';
  lateAttemptCount?: number;
  lateNextAttemptAt?: string | null;
  lateLastAttemptAt?: string | null;
  lateLastError?: string | null;
  closeSyncStatus?: 'synced' | 'pending_sync' | 'failed';
  closeAttemptCount?: number;
  closeNextAttemptAt?: string | null;
  closeLastAttemptAt?: string | null;
  closeLastError?: string | null;
};

type AttendanceHistoryRow = {
  session_id?: number;
  batch_id?: string;
  date: string;
  present: number;
  late: number;
  total: number;
  session_name: string;
};

type SmsSessionCandidate = {
  key: string;
  label: string;
  sessionKey: string;
  sessionId: number;
  batchId: string;
  date: string;
  present: number;
  late: number;
  total: number;
  source: 'history' | 'local';
  localSessionId?: string | null;
  serverSessionId?: number | null;
  status?: 'open' | 'closed';
};

type SmsPreviewRecipient = {
  student_uid: string;
  name: string;
  phone: string;
  selected_phone: string;
  recipient_phone?: string;
  can_send?: boolean;
  sent?: boolean;
  sentAt?: string | null;
  selected_audience: 'student' | 'guardian';
  student_phone: string;
  guardian_phone: string;
  father_phone?: string;
  parent_phone?: string;
  status: string;
  batch_name: string;
  session_name: string;
  date: string;
  message: string;
  attendance_status?: number;
  attendance_marked_at?: string;
  arrival_time?: string;
};

type SmsPreviewState = {
  recipients: SmsPreviewRecipient[];
  emptyReason?: string;
  source?: 'local_session' | 'server_preview' | 'batch';
  count?: number;
  skipped?: number;
};

type WeeklyAlert = {
  id: number;
  batch_id: string;
  summary: string;
  low_count: number;
  total_students: number;
  created_at: string;
  lowAttendanceStudents: StudentProfile[];
};

type DoubtItem = {
  id: number;
  student_uid: string;
  student_name: string;
  batch_name: string;
  question_text: string;
  question_image: string | null;
  status: 'pending' | 'solved' | 'flagged';
  reply_image: string | null;
  created_at: string;
  replied_at: string | null;
};

type BatchReport = {
  batch: string;
  sessions: Array<{ id: number; label: string }>;
  students: StudentProfile[];
};

type SystemStats = {
  tables: Array<{ table: string; rows: number }>;
  db_size: number;
  uptime: number;
  sms_balance?: string;
};

type StaffCardPayload = {
  full_name: string;
  username: string;
  password: string;
  phone: string;
  role: 'teacher' | 'staff';
};

type RegistrationForm = {
  name: string;
  phone: string;
  father_name: string;
  guardian_phone: string;
  address: string;
  student_class: string;
  current_batches: string[];
  aspiration: string;
  photo: string;
};

type CreatedStaffCard = {
  username: string;
  role: string;
  full_name?: string;
  phone?: string;
  qr_path?: string;
  scan_url?: string;
  token?: string;
};

type StudentTestCard = {
  launch_id: number;
  paper_id: number;
  batch_name: string;
  title: string;
  subject: string;
  duration_minutes: number;
  question_count: number;
  status: 'active' | 'scheduled' | 'closed';
  starts_at?: string | null;
  closes_at?: string | null;
  closed_at?: string | null;
  submitted: boolean;
  submitted_at?: string | null;
  score?: number | null;
  total_questions?: number | null;
  scoreboard_published?: boolean;
};

type StudentScoreboardOption = {
  launch_id: number;
  title: string;
  subject: string;
  batch_name: string;
  scoreboard_published: boolean;
  closed_at?: string | null;
  submitted: boolean;
};

type StudentDashboardTests = {
  upcoming: StudentTestCard[];
  history: StudentTestCard[];
  scoreboard_tests: StudentScoreboardOption[];
};

type TestQuestion = {
  id: number;
  order: number;
  question_text: string;
  options: Record<'A' | 'B' | 'C' | 'D', string>;
  correct_option?: 'A' | 'B' | 'C' | 'D';
  selected_option?: 'A' | 'B' | 'C' | 'D' | '';
  is_correct?: boolean;
};

type TestAttemptPayload = {
  launch: {
    id: number;
    paper_id: number;
    title: string;
    subject: string;
    duration_minutes: number;
    question_count: number;
    batch_name: string;
    starts_at?: string | null;
    closes_at?: string | null;
    closed_at?: string | null;
    status: 'active' | 'scheduled' | 'closed';
    scoreboard_published: boolean;
  };
  questions: TestQuestion[];
  already_submitted: boolean;
  submission?: {
    score: number;
    total_questions: number;
    submitted_at?: string | null;
  } | null;
};

type ScoreboardRow = {
  rank: number;
  student_uid: string;
  student_name: string;
  batch_name: string;
  score: number;
  total_questions: number;
  submitted_at?: string;
};

type ScoreboardPayload = {
  launch: {
    id: number;
    title: string;
    subject: string;
    batch_name: string;
    closed_at?: string | null;
    status?: string;
    scoreboard_published: boolean;
  };
  scoreboard: ScoreboardRow[];
  your_entry?: ScoreboardRow | null;
};

type TestPaperSummary = {
  id: number;
  title: string;
  subject: string;
  duration_minutes: number;
  created_at?: string;
  updated_at?: string;
  question_count: number;
};

type TestLaunchSummary = {
  id: number;
  paper_id: number;
  batch_name: string;
  status: 'active' | 'scheduled' | 'closed';
  scoreboard_published: number | boolean;
  starts_at?: string;
  closes_at?: string | null;
  closed_at?: string | null;
  created_at?: string;
  title: string;
  subject: string;
  duration_minutes: number;
  question_count: number;
  submission_count: number;
};

type StaffSubmissionRow = {
  id: number;
  launch_id: number;
  paper_id: number;
  student_uid: string;
  student_name: string;
  batch_name: string;
  score: number;
  total_questions: number;
  submitted_at: string;
  launch_status: string;
  scoreboard_published: number | boolean;
  closed_at?: string | null;
  title: string;
  subject: string;
};

type DraftTestQuestion = {
  question_text: string;
  options: Record<'A' | 'B' | 'C' | 'D', string>;
  correct_option: 'A' | 'B' | 'C' | 'D';
};

type MaterialItem = {
  id: number;
  title: string;
  description: string;
  file_path: string | null;
  download_path: string | null;
  access_mode: 'view' | 'download';
  batch_id: string | null;
  batch_name?: string | null;
  created_at?: string;
};

type NoticeItem = {
  id: number;
  title: string;
  content: string;
  target_batch: string;
  created_at: string;
};

type PersonalNotification = {
  id: number;
  title: string;
  content: string;
  created_at: string;
};

const STORAGE_BASE_URL = 'rmcmobilebaseurlv2_clone';
const STORAGE_COOKIE = 'rmcmobilecookiev2_clone';
const LOCKED_SERVER_URL = 'https://login.riteshmathematics.in';
const EMULATOR_SERVER_URL = 'http://10.0.2.2:8081';
const LOCALHOST_SERVER_URL = 'http://127.0.0.1:8081';
const STARTUP_SERVER_PATHS = ['/healthz', '/api/public/batches'];
const HEALTH_PROBE_SUCCESS_TTL_MS = 20 * 1000;
const HEALTH_PROBE_FAILURE_TTL_MS = 5 * 1000;
const healthProbeInFlightByUrl = new Map<string, Promise<boolean>>();
const healthProbeCacheByUrl = new Map<string, { at: number; result: boolean }>();

function normalizeBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function isProbablyAndroidEmulator() {
  const constants = Platform.constants as Record<string, unknown> | undefined;
  const model = String(constants?.Model || constants?.model || '').toLowerCase();
  const manufacturer = String(constants?.Manufacturer || constants?.manufacturer || '').toLowerCase();
  return /sdk_gphone|emulator|android sdk built for|generic/.test(model) || /google|unknown/.test(manufacturer);
}

function shouldSkipPushRegistration() {
  return Platform.OS === 'android' && isProbablyAndroidEmulator();
}

function getDefaultServerUrl() {
  return Platform.OS === 'android' && !isProbablyAndroidEmulator()
    ? LOCKED_SERVER_URL
    : LOCALHOST_SERVER_URL;
}

async function probeServerUrl(baseUrl: string, force = false) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return false;
  const cached = healthProbeCacheByUrl.get(normalized);
  const now = Date.now();
  if (!force && cached) {
    const ttl = cached.result ? HEALTH_PROBE_SUCCESS_TTL_MS : HEALTH_PROBE_FAILURE_TTL_MS;
    if (now - cached.at < ttl) return cached.result;
  }
  const inFlight = healthProbeInFlightByUrl.get(normalized);
  if (inFlight) return inFlight;
  const pending = (async () => {
  for (const probePath of STARTUP_SERVER_PATHS) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2200) : null;
    try {
      const response = await fetch(makeAbsoluteUrl(normalized, probePath), {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller?.signal
      });
      if (response.ok) {
        healthProbeCacheByUrl.set(normalized, { at: Date.now(), result: true });
        return true;
      }
    } catch {
      // Try the next probe path or fallback server.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  healthProbeCacheByUrl.set(normalized, { at: Date.now(), result: false });
  return false;
  })();
  healthProbeInFlightByUrl.set(normalized, pending);
  try {
    return await pending;
  } finally {
    if (healthProbeInFlightByUrl.get(normalized) === pending) {
      healthProbeInFlightByUrl.delete(normalized);
    }
  }
}

async function resolveStartupBaseUrl(storedBaseUrl: string, force = false) {
  const preferred = normalizeBaseUrl(storedBaseUrl);
  const defaultServerUrl = getDefaultServerUrl();
  const candidates = isProbablyAndroidEmulator()
    ? [
      defaultServerUrl,
      EMULATOR_SERVER_URL,
      preferred && (preferred === LOCALHOST_SERVER_URL || preferred === EMULATOR_SERVER_URL ? preferred : ''),
      LOCKED_SERVER_URL
    ]
    : [
      defaultServerUrl,
      preferred && preferred !== LOCALHOST_SERVER_URL && preferred !== EMULATOR_SERVER_URL ? preferred : LOCKED_SERVER_URL
    ];
  const uniqueCandidates = candidates.filter((value, index, array) => Boolean(value) && array.indexOf(value) === index) as string[];

  for (const candidate of uniqueCandidates) {
    if (await probeServerUrl(candidate, force)) return candidate;
  }
  return uniqueCandidates[0] || defaultServerUrl;
}

function makeAbsoluteUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

type DownloadProgressCallback = (progress: number) => void;

async function downloadWithProgress(
  sourceUrl: string,
  destinationUri: string,
  cookieValue: string,
  onProgress?: DownloadProgressCallback
) {
  const task = FileSystem.createDownloadResumable(
    sourceUrl,
    destinationUri,
    {
      headers: cookieValue ? { Cookie: cookieValue } : undefined
    },
    (progress) => {
      const total = Number(progress.totalBytesExpectedToWrite || 0);
      if (total <= 0) return;
      const percent = Math.max(0, Math.min(100, Math.round((progress.totalBytesWritten / total) * 100)));
      onProgress?.(percent);
    }
  );
  const result = await task.downloadAsync();
  if (!result?.uri) {
    throw new Error('Download failed.');
  }
  onProgress?.(100);
  return result;
}

function cookieHeaderToMap(cookieHeader: string) {
  const map = new Map<string, string>();
  cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((token) => {
      const eqIndex = token.indexOf('=');
      if (eqIndex <= 0) return;
      map.set(token.slice(0, eqIndex).trim(), token.slice(eqIndex + 1).trim());
    });
  return map;
}

function mergeCookieHeaders(existing: string, setCookieHeader: string | null) {
  if (!setCookieHeader) return existing;
  const next = cookieHeaderToMap(existing);
  const matches = setCookieHeader.match(/rmc\.[^=]+=[^;,\s]+/g) || [];
  matches.forEach((token) => {
    const eqIndex = token.indexOf('=');
    next.set(token.slice(0, eqIndex).trim(), token.slice(eqIndex + 1).trim());
  });
  return Array.from(next.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

function extractApiStatus(error: unknown) {
  if (!(error instanceof Error)) return NaN;
  const match = error.message.match(/^API Error:\s*(\d+)/i) || error.message.match(/^Upload Error:\s*(\d+)/i);
  return match ? Number(match[1]) : NaN;
}

const SESSION_SYNC_CONFLICT_BLOCKED_ERROR = 'SESSION_SYNC_CONFLICT_BLOCKED';

async function readResponseBodyText(response: Response) {
  const rawText = await response.text().catch(() => '');
  let json: any = null;
  const trimmed = String(rawText || '').trim();
  if (trimmed) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      json = null;
    }
  }
  return { rawText, json };
}

function extractSessionSyncServerSessionId(payload: unknown): number | null {
  const seen = new Set<unknown>();
  const candidates: unknown[] = [payload];
  while (candidates.length) {
    const current = candidates.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, any>;
    const directValues = [
      record.server_session_id,
      record.serverSessionId,
      record.session_id,
      record.existing_session_id,
      record.existingSessionId,
      record.existing_server_session_id,
      record.existingServerSessionId,
      record.data?.server_session_id,
      record.data?.serverSessionId,
      record.data?.session_id,
      record.result?.server_session_id,
      record.result?.serverSessionId,
      record.result?.session_id
    ];
    for (const value of directValues) {
      const parsed = Number(value || 0);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    if (record.data && typeof record.data === 'object') candidates.push(record.data);
    if (record.result && typeof record.result === 'object') candidates.push(record.result);
  }
  return null;
}

function isSessionSyncConflictBlocked(session: CanonicalSession | AttendanceWorkspaceSession | null | undefined) {
  if (!session) return false;
  const syncStatus = String((session as any).syncStatus || '').trim();
  const lastError = String((session as any).lastError || '').trim();
  return syncStatus === 'failed' && lastError === SESSION_SYNC_CONFLICT_BLOCKED_ERROR;
}

function prettyDate(value?: string) {
  if (!value) return 'N/A';
  const normalizedValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return value;
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  return formatter.format(date).replace(',', '');
}

function todayDateInput() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatMoney(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return '—';
  return `₹${new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2
  }).format(number)}`;
}

const POLL_FAST_MS = 1000;
const POLL_MED_MS = 5000;
const POLL_SLOW_MS = 20000;
const APP_VERSION = String(Constants.expoConfig?.version || '1.0.17').trim() || '1.0.17';
const APP_BUILD_VERSION = String(Constants.nativeBuildVersion || Constants.expoConfig?.android?.versionCode || '0').trim() || '0';
const ATTENDANCE_SESSION_RESET_MARKER_KEY = 'rmc.attendance_session_reset_marker.v1';
const ATTENDANCE_SESSION_RESET_BUILD_ID = `${APP_VERSION}:${APP_BUILD_VERSION}`;
const EXPO_PROJECT_ID = '8f8b8a8a-13ec-484e-9c4c-ff9b4056a943';
const MOBILE_ALERT_CHANNEL_ID = 'rmc_updates';
const DEFAULT_MOBILE_CONFIG: MobileAppConfig = {
  notification_preview_limit: 4,
  home_feed_limit: 4
};
const RMC_LOGO = require('./assets/rmc-logo.png');
const MATERIAL_CACHE_ROOT = `${FileSystem.documentDirectory || FileSystem.cacheDirectory || ''}rmc-material-cache`;

function stripToken(raw: string) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

function normalizeScanToken(raw: string) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withoutQuery = trimmed.split('?')[0];
  const lastSegment = withoutQuery.split('/').pop() || withoutQuery;
  return decodeURIComponent(lastSegment);
}

function compareVersionStrings(left: string, right: string) {
  const parse = (value: string) => value.split('.').map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function sanitizeSecureStoreKeyPart(value: string, fallback: string) {
  const sanitized = String(value || '').trim().replace(/[^a-zA-Z0-9]/g, '');
  return sanitized || fallback;
}

function splitBatchNames(value?: string | string[]) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split(',').map((batch) => batch.trim()).filter(Boolean);
}

function normalizeBatchIdentity(value?: string | string[] | null) {
  return String(Array.isArray(value) ? value.join(',') : value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function normalizePhoneDigits(value: string, maxLength = 10) {
  return String(value || '').replace(/\D/g, '').slice(0, maxLength);
}

function isTenDigitPhone(value: string) {
  return /^\d{10}$/.test(String(value || '').trim());
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

function safeFileSlug(value: string) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default';
}

function inferFileExtension(pathName: string) {
  const clean = String(pathName || '').split('?')[0].split('#')[0];
  const match = clean.match(/\.([a-zA-Z0-9]{1,8})$/);
  return match ? `.${match[1].toLowerCase()}` : '.bin';
}

function getFileNameFromPath(pathName: string) {
  const clean = String(pathName || '').split('?')[0].split('#')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean || 'download';
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPreviewableFileName(fileName: string) {
  const ext = inferFileExtension(fileName).toLowerCase();
  return ext === '.pdf' || ext === '.csv' || ext === '.xls' || ext === '.xlsx' || ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp';
}

function isImageFileName(fileName: string) {
  const ext = inferFileExtension(fileName).toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp';
}

function makeSpreadsheetPreviewHtml(fileName: string, sheetName: string, rows: Array<Array<unknown>>) {
  const headers = rows[0] || [];
  const bodyRows = rows.slice(1);
  const maxColumns = Math.max(headers.length, ...bodyRows.map((row) => row.length), 0);
  const headerCells = Array.from({ length: maxColumns }, (_, index) => {
    const value = headers[index] ?? `Column ${index + 1}`;
    return `<th>${escapeHtml(value)}</th>`;
  }).join('');

  const body = (bodyRows.length ? bodyRows : [headers]).map((row) => {
    const cells = Array.from({ length: maxColumns }, (_, index) => `<td>${escapeHtml(row[index] ?? '')}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>
          :root { color-scheme: light; --bg: #f5f7f5; --card: #fff; --line: rgba(15, 23, 42, 0.10); --text: #10221a; --muted: #5c6b61; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: linear-gradient(180deg, #eef5ee 0%, var(--bg) 100%); color: var(--text); }
          .shell { padding: 16px; }
          .hero { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 16px; box-shadow: 0 10px 28px rgba(16, 34, 26, 0.08); margin-bottom: 14px; }
          .title { font-size: 20px; font-weight: 900; margin: 0 0 6px; }
          .meta { color: var(--muted); font-size: 13px; margin: 0; }
          .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 20px; overflow: auto; box-shadow: 0 10px 28px rgba(16, 34, 26, 0.08); }
          table { width: 100%; border-collapse: collapse; min-width: 640px; }
          thead th { position: sticky; top: 0; background: #0f4d31; color: #fff; text-align: left; font-size: 13px; font-weight: 800; padding: 12px 10px; }
          tbody td { padding: 10px; border-top: 1px solid var(--line); font-size: 13px; color: var(--text); vertical-align: top; }
          tbody tr:nth-child(even) td { background: rgba(21, 128, 61, 0.03); }
          .empty { padding: 18px; color: var(--muted); font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="hero">
            <p class="title">${escapeHtml(fileName)}</p>
            <p class="meta">Sheet: ${escapeHtml(sheetName || 'Sheet1')} · ${rows.length} row(s)</p>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>${headerCells}</tr></thead>
              <tbody>${body || `<tr><td class="empty">No data found in this sheet.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </body>
    </html>`;
}

function makePdfViewerHtml(base64Data: string, title: string) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>
          :root { color-scheme: light; --bg: #eef5ee; --card: #fff; --line: rgba(15, 23, 42, 0.08); --text: #10221a; --muted: #5c6b61; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: linear-gradient(180deg, #edf5ee 0%, var(--bg) 100%); color: var(--text); }
          .shell { padding: 16px; }
          .hero { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 16px; box-shadow: 0 10px 28px rgba(16, 34, 26, 0.08); margin-bottom: 14px; }
          .title { font-size: 20px; font-weight: 900; margin: 0 0 6px; }
          .meta { color: var(--muted); font-size: 13px; margin: 0; }
          .loading { padding: 24px; color: var(--muted); font-size: 14px; text-align: center; }
          canvas { width: 100%; height: auto; display: block; margin: 0 auto 16px; background: #fff; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); }
        </style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.js"></script>
      </head>
      <body>
        <div class="shell">
          <div class="hero">
            <p class="title">${escapeHtml(title)}</p>
            <p class="meta">PDF preview inside the app</p>
          </div>
          <div id="pages" class="loading">Loading PDF preview...</div>
        </div>
        <script>
          (function() {
            const base64Data = ${JSON.stringify(base64Data)};
            const pages = document.getElementById('pages');
            if (!window.pdfjsLib) {
              pages.textContent = 'PDF preview library could not load.';
              return;
            }
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js';
            const raw = atob(base64Data);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            pdfjsLib.getDocument({ data: bytes }).promise.then(async (pdf) => {
              pages.textContent = '';
              for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.4 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d');
                await page.render({ canvasContext: context, viewport: viewport }).promise;
                pages.appendChild(canvas);
              }
            }).catch((err) => {
              pages.textContent = 'Could not render PDF preview: ' + (err && err.message ? err.message : 'Unknown error');
            });
          })();
        </script>
      </body>
    </html>`;
}

async function buildDocumentPreviewHtml(localUri: string, fileName: string) {
  const ext = inferFileExtension(fileName || localUri).toLowerCase();
  const title = fileName || getFileNameFromPath(localUri);

  if (ext === '.csv') {
    const raw = await FileSystem.readAsStringAsync(localUri);
    const workbook = XLSX.read(raw, { type: 'string', raw: false });
    const sheetName = workbook.SheetNames[0] || 'Sheet1';
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' }) as Array<Array<unknown>>;
    return makeSpreadsheetPreviewHtml(title, sheetName, rows);
  }

  if (ext === '.xls' || ext === '.xlsx') {
    const raw = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' as any });
    const workbook = XLSX.read(raw, { type: 'base64', cellDates: true });
    const sheetName = workbook.SheetNames[0] || 'Sheet1';
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' }) as Array<Array<unknown>>;
    return makeSpreadsheetPreviewHtml(title, sheetName, rows);
  }

  if (ext === '.pdf') {
    const raw = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' as any });
    return makePdfViewerHtml(raw, title);
  }

  throw new Error('This file type is not previewable.');
}

async function ensureDirectoryExists(dir: string) {
  if (!dir) return;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

type CachedMaterial = {
  material_id: number;
  title: string;
  source_url: string;
  local_uri: string;
  downloaded_at: string;
  batch_name?: string | null;
  file_name: string;
};

type DocumentPreviewState = {
  title: string;
  fileName: string;
  localUri: string;
  kind: 'pdf' | 'sheet' | 'image';
  html: string;
  memoryKey?: string;
  initialPage?: number;
};

function getStudentMaterialCacheDir(studentUid: string) {
  return `${MATERIAL_CACHE_ROOT}/${safeFileSlug(studentUid)}`;
}

function getStudentMaterialManifestPath(studentUid: string) {
  return `${getStudentMaterialCacheDir(studentUid)}/manifest.json`;
}

async function readStudentMaterialCache(studentUid: string) {
  const local = await readLocalJson<{ items?: CachedMaterial[] }>(`rmc.student_materials.v1:${safeFileSlug(studentUid)}`);
  if (local && Array.isArray(local.items)) {
    return local.items as CachedMaterial[];
  }
  const manifestPath = getStudentMaterialManifestPath(studentUid);
  const info = await FileSystem.getInfoAsync(manifestPath);
  if (!info.exists) return [];
  try {
    const raw = await FileSystem.readAsStringAsync(manifestPath);
    const payload = JSON.parse(raw);
    const next = Array.isArray(payload?.items) ? payload.items as CachedMaterial[] : [];
    void writeLocalJson(`rmc.student_materials.v1:${safeFileSlug(studentUid)}`, { items: next }).catch(() => null);
    return next;
  } catch {
    return [];
  }
}

async function writeStudentMaterialCache(studentUid: string, items: CachedMaterial[]) {
  const dir = getStudentMaterialCacheDir(studentUid);
  await ensureDirectoryExists(dir);
  await FileSystem.writeAsStringAsync(getStudentMaterialManifestPath(studentUid), JSON.stringify({ items }, null, 2));
  await writeLocalJson(`rmc.student_materials.v1:${safeFileSlug(studentUid)}`, { items }).catch(() => null);
}

async function cacheMaterialForStudent(
  studentUid: string,
  material: MaterialItem,
  sourceUrl: string,
  cookieValue: string,
  onProgress?: DownloadProgressCallback
) {
  const cacheDir = getStudentMaterialCacheDir(studentUid);
  await ensureDirectoryExists(cacheDir);

  const existingItems = await readStudentMaterialCache(studentUid);
  const existing = existingItems.find((item) => item.material_id === material.id);
  if (existing) {
    const existingInfo = await FileSystem.getInfoAsync(existing.local_uri);
    if (existingInfo.exists) {
      return existing;
    }
  }

  const fileHint = material.file_path || material.download_path || material.title || `material_${material.id}`;
  const fileName = `${material.id}_${safeFileSlug(fileHint)}${inferFileExtension(fileHint)}`;
  const destination = new File(cacheDir, fileName);
  await FileSystem.deleteAsync(destination.uri, { idempotent: true });
  const downloadResult = await downloadWithProgress(sourceUrl, destination.uri, cookieValue, onProgress);

  const nextItem: CachedMaterial = {
    material_id: material.id,
    title: material.title,
    source_url: sourceUrl,
    local_uri: downloadResult.uri,
    downloaded_at: new Date().toISOString(),
    batch_name: material.batch_name || null,
    file_name: fileName
  };

  const merged = [nextItem, ...existingItems.filter((item) => item.material_id !== material.id)];
  await writeStudentMaterialCache(studentUid, merged);
  return nextItem;
}

type CachedStudentAsset = {
  student_uid: string;
  source_url: string;
  local_uri: string;
  downloaded_at: string;
  file_name: string;
};

const STUDENT_PHOTO_CACHE_ROOT = `${MATERIAL_CACHE_ROOT}/student-photo-cache`;

function getStudentPhotoCacheDir(studentUid: string) {
  return `${STUDENT_PHOTO_CACHE_ROOT}/${safeFileSlug(studentUid)}`;
}

function getStudentPhotoManifestPath(studentUid: string) {
  return `${getStudentPhotoCacheDir(studentUid)}/manifest.json`;
}

async function readStudentPhotoCache(studentUid: string): Promise<CachedStudentAsset | null> {
  const local = await readLocalJson<CachedStudentAsset>(`rmc.student_photo.v1:${safeFileSlug(studentUid)}`);
  if (local?.local_uri) {
    const cached = await FileSystem.getInfoAsync(local.local_uri);
    if (cached.exists) return local;
  }
  try {
    const info = await FileSystem.getInfoAsync(getStudentPhotoManifestPath(studentUid));
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(getStudentPhotoManifestPath(studentUid));
    const parsed = JSON.parse(raw) as CachedStudentAsset;
    if (!parsed?.local_uri) return null;
    const cached = await FileSystem.getInfoAsync(parsed.local_uri);
    if (!cached.exists) return null;
    void writeLocalJson(`rmc.student_photo.v1:${safeFileSlug(studentUid)}`, parsed).catch(() => null);
    return parsed;
  } catch {
    return null;
  }
}

async function writeStudentPhotoCache(studentUid: string, payload: CachedStudentAsset) {
  const dir = getStudentPhotoCacheDir(studentUid);
  await ensureDirectoryExists(dir);
  await FileSystem.writeAsStringAsync(getStudentPhotoManifestPath(studentUid), JSON.stringify(payload, null, 2));
  await writeLocalJson(`rmc.student_photo.v1:${safeFileSlug(studentUid)}`, payload).catch(() => null);
}

async function cacheStudentPhoto(studentUid: string, sourceUrl: string, cookieValue: string) {
  const normalized = String(sourceUrl || '').trim();
  if (!studentUid || !normalized) return null;
  if (/^file:\/\//i.test(normalized)) {
    return {
      student_uid: studentUid,
      source_url: normalized,
      local_uri: normalized,
      downloaded_at: new Date().toISOString(),
      file_name: getFileNameFromPath(normalized) || `${safeFileSlug(studentUid)}.jpg`
    } satisfies CachedStudentAsset;
  }

  const cached = await readStudentPhotoCache(studentUid);
  if (cached) return cached;

  const fileName = `${safeFileSlug(studentUid)}${inferFileExtension(normalized) || '.jpg'}`;
  const destination = new File(getStudentPhotoCacheDir(studentUid), fileName);
  await FileSystem.deleteAsync(destination.uri, { idempotent: true });
  const downloadResult = await downloadWithProgress(normalized, destination.uri, cookieValue);
  const nextItem: CachedStudentAsset = {
    student_uid: studentUid,
    source_url: normalized,
    local_uri: downloadResult.uri,
    downloaded_at: new Date().toISOString(),
    file_name: fileName
  };
  await writeStudentPhotoCache(studentUid, nextItem);
  return nextItem;
}

type CachedStudentDetail = {
  savedAt: number;
  student: StudentProfile;
};

const STUDENT_DETAIL_CACHE_ROOT = `${MATERIAL_CACHE_ROOT}/student-detail-cache`;

function getStudentDetailCacheDir(studentUid: string) {
  return `${STUDENT_DETAIL_CACHE_ROOT}/${safeFileSlug(studentUid)}`;
}

function getStudentDetailManifestPath(studentUid: string) {
  return `${getStudentDetailCacheDir(studentUid)}/detail.json`;
}

async function readStudentDetailCache(studentUid: string): Promise<StudentProfile | null> {
  const local = await readLocalJson<CachedStudentDetail>(`rmc.student_detail.v1:${safeFileSlug(studentUid)}`);
  if (local?.student?.student_uid) return local.student;
  try {
    const info = await FileSystem.getInfoAsync(getStudentDetailManifestPath(studentUid));
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(getStudentDetailManifestPath(studentUid));
    const parsed = JSON.parse(raw) as CachedStudentDetail;
    const student = parsed?.student;
    if (!student || !student.student_uid) return null;
    void writeLocalJson(`rmc.student_detail.v1:${safeFileSlug(studentUid)}`, parsed).catch(() => null);
    return student;
  } catch {
    return null;
  }
}

async function writeStudentDetailCache(student: StudentProfile) {
  const dir = getStudentDetailCacheDir(student.student_uid);
  await ensureDirectoryExists(dir);
  const payload: CachedStudentDetail = {
    savedAt: Date.now(),
    student
  };
  await FileSystem.writeAsStringAsync(getStudentDetailManifestPath(student.student_uid), JSON.stringify(payload, null, 2));
  await writeLocalJson(`rmc.student_detail.v1:${safeFileSlug(student.student_uid)}`, payload).catch(() => null);
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next === undefined) break;
      await worker(next);
    }
  });
  await Promise.all(runners);
}

type CachedStudentRow = Pick<
  StudentRow,
  'id' | 'name' | 'student_uid' | 'secure_token' | 'phone' | 'father_name' | 'guardian_phone' | 'father_phone' | 'parent_phone' | 'address' | 'student_class' | 'current_batch' | 'batch_name' | 'batches' | 'system_batches' | 'primary_system_batch' | 'aspiration' | 'attendance_percent' | 'status' | 'photo' | 'photo_path' | 'qr_path' | 'fbc_no'
> & {
  created_at?: string;
  attendance_status?: number;
  attendance_marked_offline?: boolean;
  attendance_marked_at?: string;
};

type StoredSessionSnapshot =
  | {
      type: 'student';
      student: Pick<StudentProfile, 'id' | 'name' | 'student_uid' | 'secure_token' | 'phone' | 'father_name' | 'guardian_phone' | 'address' | 'student_class' | 'current_batch' | 'batch_name' | 'batches' | 'system_batches' | 'primary_system_batch' | 'aspiration' | 'attendance_percent' | 'status' | 'photo' | 'photo_path' | 'qr_path' | 'fbc_no'>;
    }
  | {
      type: 'staff';
      user: Pick<StaffUser, 'id' | 'username' | 'full_name' | 'role'>;
    };

type TrustedSessionRecord = {
  device_id: string;
  kind: 'student' | 'staff';
  identifier: string;
  savedAt: number;
  session: StoredSessionSnapshot;
  hints?: {
    name?: string;
    phone?: string;
    father?: string;
    full_name?: string;
  };
};

const STAFF_LOGIN_SECRET_PREFIX = 'rmcstaffloginsecretv1';

type AppUiSnapshot = {
  attendanceBatch: string;
  studentBatchFilter: string;
  reportBatch: string;
  doubtBatchFilter: string;
  testBatch: string;
  smsBatch: string;
  selectedLaunchId: string;
  selectedPaperId: string;
  selectedAbsenteeSessionId: string;
  selectedScoreboardLaunchId: string;
  studentTab: StudentTab;
  staffTab: StaffTab;
  staffNotificationSection: StaffNotificationSection;
};

type CanonicalSession = {
  sessionKey: string;
  serverSessionId?: number | string | null;
  localSessionId?: string | null;
  session_id?: number;
  is_late?: number;
  batchName: string;
  session_name?: string;
  sessionName?: string;
  column_name?: string;
  columnName?: string;
  title?: string;
  displayName?: string;
  name?: string;
  status: 'open' | 'closed';
  createdAt: string;
  closedAt?: string | null;
  syncStatus: 'synced' | 'pending_create' | 'pending_sync' | 'failed';
  lastError?: string | null;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  lateSyncStatus?: 'synced' | 'pending_sync' | 'failed';
  lateAttemptCount?: number;
  lateNextAttemptAt?: string | null;
  lateLastAttemptAt?: string | null;
  lateLastError?: string | null;
  closeSyncStatus?: 'synced' | 'pending_sync' | 'failed';
  closeAttemptCount?: number;
  closeNextAttemptAt?: string | null;
  closeLastAttemptAt?: string | null;
  closeLastError?: string | null;
};

type CanonicalAttendanceMark = {
  markKey: string;
  sessionKey: string;
  studentUid: string;
  status: 'present' | 'late' | 'absent';
  markedAt: string;
  syncStatus: 'synced' | 'pending_sync' | 'failed';
  lastError?: string | null;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
};

type SyncQueueItem = {
  queueKey: string;
  kind: 'session_create' | 'attendance_mark' | 'late_mode' | 'close_session';
  sessionKey: string;
  markKey?: string;
  studentUid?: string;
  status?: 'present' | 'late' | 'absent';
  createdAt: string;
  updatedAt: string;
  syncStatus: 'synced' | 'pending_sync' | 'failed';
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
};

type LocalAttendanceCache = {
  studentsByUid: Record<string, CachedStudentRow>;
  rosterByBatch: Record<string, string[]>;
  sessionsByKey: Record<string, CanonicalSession>;
  attendanceMarksBySession: Record<string, Record<string, CanonicalAttendanceMark>>;
  syncQueue: SyncQueueItem[];
  sessionAliasMap: Record<string, string>;
  cacheVersion: number;
  updatedAt: string;
};

type OfflineAttendanceAction =
  | {
      id: string;
      type: 'start_session';
      batch_id: string;
      session_name: string;
      session_key: string;
      created_at: string;
    }
  | {
      id: string;
      type: 'mark_qr';
      batch_id: string;
      token: string;
      session_key: string;
      created_at: string;
    }
  | {
      id: string;
      type: 'late_mode';
      batch_id: string;
      session_key: string;
      created_at: string;
    }
  | {
      id: string;
      type: 'close_session';
      batch_id: string;
      session_key: string;
      created_at: string;
    };

type AppCachePayload = {
  session?: StoredSessionSnapshot | null;
  currentSession?: AttendanceWorkspaceSession | null;
  ui?: AppUiSnapshot;
  workspaceRole?: WorkspaceRole | null;
  publicBatches?: Batch[];
  batches?: Batch[];
  students?: CachedStudentRow[];
  materials?: MaterialItem[];
  notices?: NoticeItem[];
  leads?: LeadItem[];
  systemStats?: SystemStats | null;
  testPapers?: TestPaperSummary[];
  testLaunches?: TestLaunchSummary[];
  testSubmissions?: StaffSubmissionRow[];
  studentMaterials?: MaterialItem[];
  studentNotices?: NoticeItem[];
  studentNotifications?: PersonalNotification[];
  downloadedMaterials?: CachedMaterial[];
  mobileManifest?: MobileManifestPayload | null;
  mobileFeed?: MobileFeedItem[];
  mobileConfig?: MobileAppConfig;
  pdfReadingPositions?: Record<string, number>;
  resourceCache?: Record<string, CachedResourceEntry<unknown>>;
  attendanceQueue?: OfflineAttendanceAction[];
  studentsByUid?: Record<string, CachedStudentRow>;
  rosterByBatch?: Record<string, string[]>;
  sessionsByKey?: Record<string, CanonicalSession>;
  attendanceMarksBySession?: Record<string, Record<string, CanonicalAttendanceMark>>;
  smsBatchHistoryByBatch?: Record<string, AttendanceHistoryRow[]>;
  syncQueue?: SyncQueueItem[];
  sessionAliasMap?: Record<string, string>;
  staffOtaAppliedConfigVersion?: number;
  cacheVersion?: number;
  updatedAt?: string;
};

type CachedResourceEntry<T = unknown> = {
  savedAt: number;
  data: T;
};

const LOCAL_ATTENDANCE_CACHE_VERSION = 1;
const APP_CACHE_FILE = `${MATERIAL_CACHE_ROOT}/app_cache.json`;
const STUDENT_DIRECTORY_CACHE_FILE = `${MATERIAL_CACHE_ROOT}/student_directory.json`;
const APP_CACHE_KEY = 'rmc.app_cache.v1';
const STAFF_OTA_APPLIED_CONFIG_VERSION_KEY = 'rmc.staff_ota_applied_config_version.v1';
const STUDENT_DIRECTORY_CACHE_KEY = 'rmc.student_directory.v1';
const STAFF_CORE_CACHE_KEY = 'rmc.staff_core.v1';
const TRUSTED_SESSION_CACHE_KEY = 'rmc.trusted_sessions.v1';
const RESOURCE_CACHE_TTL_MS = 5 * 60 * 1000;
const STUDENT_DIRECTORY_CACHE_TTL_MS = 3 * 60 * 1000;

function normalizeAttendanceStatusLabel(value: unknown): 'present' | 'late' | 'absent' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'late' || raw === '2') return 'late';
  if (raw === 'absent' || raw === '0') return 'absent';
  return 'present';
}

function attendanceStatusLabelToCode(value: 'present' | 'late' | 'absent') {
  if (value === 'late') return 2;
  if (value === 'absent') return 0;
  return 1;
}

function getMarkKey(sessionKey: string, studentUid: string) {
  return `${String(sessionKey || '').trim()}:${String(studentUid || '').trim()}`;
}

function getServerSessionKey(serverSessionId: number | string | null | undefined) {
  const normalized = Number(serverSessionId);
  return Number.isFinite(normalized) && normalized > 0 ? `server:${normalized}` : '';
}

function getLocalSessionKey(localSessionId: string | number | null | undefined) {
  const normalized = String(localSessionId || '').trim();
  return normalized ? `local:${normalized}` : '';
}

function getSessionIdsFromKey(sessionKey: string) {
  const normalized = String(sessionKey || '').trim();
  if (!normalized) {
    return {
      sessionKey: '',
      localSessionId: null as string | null,
      serverSessionId: null as number | null
    };
  }

  if (normalized.startsWith('server:')) {
    const serverSessionId = Number(normalized.slice('server:'.length));
    return {
      sessionKey: Number.isFinite(serverSessionId) && serverSessionId > 0 ? `server:${serverSessionId}` : normalized,
      localSessionId: null as string | null,
      serverSessionId: Number.isFinite(serverSessionId) && serverSessionId > 0 ? serverSessionId : null
    };
  }

  if (normalized.startsWith('local:')) {
    const localSessionId = normalized.slice('local:'.length).trim();
    return {
      sessionKey: localSessionId ? `local:${localSessionId}` : normalized,
      localSessionId: localSessionId || null,
      serverSessionId: null as number | null
    };
  }

  return {
    sessionKey: normalized,
    localSessionId: null as string | null,
    serverSessionId: null as number | null
  };
}

function getLocalSessionNumericId(localSessionId: string) {
  const normalized = String(localSessionId || '').trim();
  if (!normalized) return -1;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}

function getSessionKeyForIdentity(session: AttendanceWorkspaceSession | null | undefined) {
  if (!session) return '';
  const parsedSessionKey = getSessionIdsFromKey(session.sessionKey || '');
  if (parsedSessionKey.sessionKey) return parsedSessionKey.sessionKey;
  const localSessionKey = getLocalSessionKey(session.localSessionId);
  if (localSessionKey) return localSessionKey;
  const serverSessionKey = getServerSessionKey(session.serverSessionId ?? session.session_id);
  if (serverSessionKey) return serverSessionKey;
  return '';
}

function getResolvedAttendanceSessionKey(session: AttendanceWorkspaceSession | null | undefined, aliasMap?: Record<string, string>) {
  return resolveSessionKey(getSessionKeyForIdentity(session), aliasMap);
}

function extractSessionDisplayMetadata(session: Record<string, unknown> | null | undefined, fallbackBatchName = '') {
  const source = (session || {}) as Record<string, unknown>;
  const batchName = String(source.batch_id || source.batchName || source.batch || fallbackBatchName || '').trim();
  const sessionNameRaw = String(source.session_name || source.sessionName || source.name || '').trim();
  const columnNameRaw = String(source.column_name || source.columnName || '').trim();
  const titleRaw = String(source.title || '').trim();
  const displayNameRaw = String(source.displayName || '').trim();
  const sessionName = sessionNameRaw || titleRaw || displayNameRaw || columnNameRaw || batchName || 'Attendance Session';
  const columnName = columnNameRaw || sessionNameRaw || titleRaw || displayNameRaw || batchName || 'attendance';
  const title = titleRaw || displayNameRaw || sessionNameRaw || columnNameRaw || batchName || 'Attendance Session';
  const displayName = displayNameRaw || titleRaw || sessionNameRaw || columnNameRaw || batchName || 'Attendance Session';
  return {
    batchName,
    sessionName,
    columnName,
    title,
    displayName,
    name: sessionName
  };
}

function getSessionLabel(session: Record<string, unknown> | null | undefined, fallbackBatchName = '') {
  const source = (session || {}) as Record<string, unknown>;
  const explicitLabel = String(
    source.session_name ||
    source.sessionName ||
    source.name ||
    source.title ||
    source.displayName ||
    source.column_name ||
    source.columnName ||
    ''
  ).trim();
  const dateSource = String(
    source.date ||
    source.createdAt ||
    source.created_at ||
    source.closedAt ||
    source.closed_at ||
    ''
  ).trim();
  const formattedDate = dateSource ? prettyDate(dateSource) : '';
  const batchName = String(source.batch_id || source.batchName || source.batch || fallbackBatchName || '').trim();
  return explicitLabel || (formattedDate && formattedDate !== 'N/A' ? formattedDate : '') || batchName || 'Attendance Session';
}

function normalizeAttendanceWorkspaceSession(session: any): AttendanceWorkspaceSession | null {
  if (!session || typeof session !== 'object') return null;
  const parsedSessionKey = getSessionIdsFromKey(session.sessionKey || '');
  const localSessionId = String(session.localSessionId || parsedSessionKey.localSessionId || '').trim() || null;
  const rawServerSessionId = Number(session.serverSessionId ?? session.session_id ?? parsedSessionKey.serverSessionId);
  const serverSessionId = Number.isFinite(rawServerSessionId) && rawServerSessionId > 0
    ? rawServerSessionId
    : null;
  const display = extractSessionDisplayMetadata(session);
  const isLate = Number.isFinite(Number(session.is_late)) ? Number(session.is_late) : 0;
  const sessionKey = String(
    session.sessionKey ||
    getLocalSessionKey(localSessionId) ||
    getServerSessionKey(serverSessionId) ||
    ''
  ).trim();
  const normalizedSessionId = Number.isFinite(Number(session.session_id))
    ? Number(session.session_id)
    : serverSessionId || (localSessionId ? getLocalSessionNumericId(localSessionId) : 0);
  return {
    ...session,
    session_id: normalizedSessionId,
    sessionKey,
    localSessionId,
    serverSessionId,
    session_name: display.sessionName,
    sessionName: display.sessionName,
    batch_id: display.batchName,
    batchName: display.batchName,
    column_name: display.columnName,
    columnName: display.columnName,
    title: display.title,
    displayName: display.displayName,
    name: display.name,
    is_late: isLate,
    syncStatus: session.syncStatus || (serverSessionId ? 'synced' : 'pending_create'),
    status: session.status === 'closed' ? 'closed' : 'open',
    created_at: session.created_at || new Date().toISOString(),
    closed_at: session.closed_at ?? null
  };
}

function normalizeSessionAliasMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, nextValue]) => {
    const aliasKey = String(key || '').trim();
    const aliasValue = String(nextValue || '').trim();
    if (aliasKey && aliasValue) {
      acc[aliasKey] = aliasValue;
    }
    return acc;
  }, {});
}

function resolveSessionKey(sessionKey: string, aliasMap?: Record<string, string>) {
  const visited = new Set<string>();
  let current = String(sessionKey || '').trim();
  const map = aliasMap || {};

  while (current && map[current] && !visited.has(current)) {
    visited.add(current);
    current = String(map[current] || '').trim();
  }

  return current;
}

function isCanonicalSessionClosed(session: Partial<CanonicalSession> | Partial<AttendanceWorkspaceSession> | null | undefined) {
  if (!session || typeof session !== 'object') return false;
  const status = String((session as { status?: unknown }).status || '').trim().toLowerCase();
  if (status === 'closed') return true;
  const closedAt = (session as { closedAt?: unknown; closed_at?: unknown }).closedAt
    ?? (session as { closedAt?: unknown; closed_at?: unknown }).closed_at
    ?? null;
  return Boolean(String(closedAt || '').trim());
}

function findOpenLocalAttendanceSession(cache: AppCachePayload | null | undefined) {
  const currentCache = normalizeLocalAttendanceCache(cache);
  const openLocalSessions = Object.values(currentCache.sessionsByKey || {})
    .map((session) => normalizeAttendanceWorkspaceSession(session))
    .filter((session): session is AttendanceWorkspaceSession => Boolean(session))
    .filter((session) => {
      const sessionKey = String(session.sessionKey || '').trim();
      return sessionKey.startsWith('local:')
        && session.status === 'open'
        && !isSessionSyncConflictBlocked(session)
        && Boolean(String(session.batch_id || '').trim());
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return openLocalSessions[0] || null;
}

function findOpenAttendanceSession(cache: AppCachePayload | null | undefined, batchName?: string | null) {
  const currentCache = normalizeLocalAttendanceCache(cache);
  const normalizedBatch = String(batchName || '').trim();
  const candidates = Object.values(currentCache.sessionsByKey || {})
    .map((session) => normalizeAttendanceWorkspaceSession(session))
    .filter((session): session is AttendanceWorkspaceSession => Boolean(session))
    .filter((session) => {
      const sessionKey = String(session.sessionKey || '').trim();
      if (!sessionKey || session.status !== 'open' || isSessionSyncConflictBlocked(session) || isSessionLocallyClosed(session, currentCache)) {
        return false;
      }
      if (!normalizedBatch) return true;
      return normalizeBatchIdentity(session.batch_id || (session as Partial<CanonicalSession>).batchName || '') === normalizeBatchIdentity(normalizedBatch);
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return candidates[0] || null;
}

function resolveActiveAttendanceSessionFromLedger(params: {
  cache: AppCachePayload | null | undefined;
  preferredSession?: AttendanceWorkspaceSession | null;
  serverSession?: AttendanceWorkspaceSession | null;
  attendanceBatch?: string;
  attendanceSessionName?: string;
  offlineAttendanceSessionKey?: string | null;
  preferLocalOpenSession?: boolean;
  allowLocalOpenSession?: boolean;
}): AttendanceSessionResolution {
  const rawCache = params.cache || {};
  const currentCache = normalizeLocalAttendanceCache(rawCache);
  void params.attendanceSessionName;
  const fallbackBatch = String(params.attendanceBatch || '').trim();
  const queuedSessionKey = getQueuedAttendanceSessionKey(rawCache.attendanceQueue);
  const fallbackOfflineKey = String(params.offlineAttendanceSessionKey || '').trim() || queuedSessionKey;
  const allowLocalOpenSession = params.preferLocalOpenSession !== false;
  const allowResolvedLocalOpenSession = params.allowLocalOpenSession !== false;

  const isUsableOpenSession = (session: AttendanceWorkspaceSession | null | undefined) => {
    const normalized = normalizeAttendanceWorkspaceSession(session);
    if (!normalized) return null;
    if (String(normalized.status || '').trim() === 'closed') return null;
    if (isSessionSyncConflictBlocked(normalized) && !normalized.serverSessionId) return null;
    if (isSessionLocallyClosed(normalized, currentCache, fallbackOfflineKey)) return null;
    return normalized;
  };

  const openLocalSession = allowLocalOpenSession && allowResolvedLocalOpenSession
    ? isUsableOpenSession(findOpenAttendanceSession(currentCache, fallbackBatch) || findOpenLocalAttendanceSession(currentCache))
    : null;
  if (openLocalSession) {
    const sessionKey = String(openLocalSession.sessionKey || getSessionKeyForIdentity(openLocalSession) || '').trim();
    const display = extractSessionDisplayMetadata(openLocalSession, openLocalSession.batch_id || fallbackBatch);
    return {
      currentSession: openLocalSession,
      attendanceBatch: String(openLocalSession.batch_id || fallbackBatch || '').trim(),
      attendanceSessionName: display.sessionName,
      offlineAttendanceSessionKey: sessionKey || fallbackOfflineKey,
      activeSessionKey: sessionKey,
      activeSource: 'open_local'
    };
  }

  const preferredSession = isUsableOpenSession(params.preferredSession);
  if (preferredSession) {
    const sessionKey = String(preferredSession.sessionKey || getSessionKeyForIdentity(preferredSession) || '').trim();
    const display = extractSessionDisplayMetadata(preferredSession, preferredSession.batch_id || fallbackBatch);
    return {
      currentSession: preferredSession,
      attendanceBatch: String(preferredSession.batch_id || fallbackBatch || '').trim(),
      attendanceSessionName: display.sessionName,
      offlineAttendanceSessionKey: sessionKey || fallbackOfflineKey,
      activeSessionKey: sessionKey,
      activeSource: 'preferred'
    };
  }

  const serverSession = isUsableOpenSession(params.serverSession);
  if (serverSession) {
    const sessionKey = String(serverSession.sessionKey || getSessionKeyForIdentity(serverSession) || '').trim();
    const display = extractSessionDisplayMetadata(serverSession, serverSession.batch_id || fallbackBatch);
    return {
      currentSession: serverSession,
      attendanceBatch: String(serverSession.batch_id || fallbackBatch || '').trim(),
      attendanceSessionName: display.sessionName,
      offlineAttendanceSessionKey: sessionKey || fallbackOfflineKey,
      activeSessionKey: sessionKey,
      activeSource: 'server_current'
    };
  }

  return {
    currentSession: null,
    attendanceBatch: fallbackBatch,
    attendanceSessionName: String(params.attendanceSessionName || '').trim(),
    offlineAttendanceSessionKey: fallbackOfflineKey,
    activeSessionKey: '',
    activeSource: 'none'
  };
}

function isSessionLocallyClosed(
  sessionOrKey: AttendanceWorkspaceSession | CanonicalSession | string | number | null | undefined,
  cache: AppCachePayload | null | undefined,
  queuedSessionKey?: string | null
) {
  const currentCache = normalizeLocalAttendanceCache(cache);
  const aliasMap = currentCache.sessionAliasMap || {};
  const candidateKeys = new Set<string>();
  const addCandidate = (value: unknown) => {
    const key = String(value || '').trim();
    if (!key) return;
    candidateKeys.add(key);
    const resolved = resolveSessionKey(key, aliasMap);
    if (resolved) candidateKeys.add(resolved);
  };

  if (typeof sessionOrKey === 'string' || typeof sessionOrKey === 'number') {
    addCandidate(sessionOrKey);
    const parsed = Number(sessionOrKey);
    if (Number.isFinite(parsed) && parsed > 0) {
      addCandidate(getServerSessionKey(parsed));
    }
  } else if (sessionOrKey && typeof sessionOrKey === 'object') {
    const typed = sessionOrKey as AttendanceWorkspaceSession & Partial<CanonicalSession>;
    addCandidate(getSessionKeyForIdentity(typed));
    addCandidate(typed.sessionKey);
    addCandidate(typed.localSessionId ? getLocalSessionKey(typed.localSessionId) : '');
    const serverSessionId = Number(typed.serverSessionId || typed.session_id || 0);
    if (Number.isFinite(serverSessionId) && serverSessionId > 0) {
      addCandidate(getServerSessionKey(serverSessionId));
    }
  }

  addCandidate(queuedSessionKey || '');

  const sessions = Object.values(currentCache.sessionsByKey || {});
  for (const session of sessions) {
    if (!isCanonicalSessionClosed(session)) continue;
    const sessionKey = String(session.sessionKey || '').trim();
    const resolvedSessionKey = resolveSessionKey(sessionKey, aliasMap);
    const localSessionKey = session.localSessionId ? getLocalSessionKey(session.localSessionId) : '';
    const serverSessionId = Number(session.serverSessionId || session.session_id || 0);
    const serverSessionKey = Number.isFinite(serverSessionId) && serverSessionId > 0 ? getServerSessionKey(serverSessionId) : '';
    const sessionCandidates = [
      sessionKey,
      resolvedSessionKey,
      localSessionKey,
      serverSessionKey,
      String(session.serverSessionId || ''),
      String(session.session_id || '')
    ].map((value) => String(value || '').trim()).filter(Boolean);

    for (const candidate of sessionCandidates) {
      if (candidateKeys.has(candidate)) {
        return true;
      }
    }
  }

  return false;
}

function extractActiveServerSessionIdFromConflict(error: unknown) {
  if (!(error instanceof Error)) return null;
  const message = String(error.message || '').trim();
  if (!message) return null;
  const patterns = [
    /(?:server[_\s-]?session[_\s-]?id|active[_\s-]?session[_\s-]?id|session[_\s-]?id)\D+(\d+)/i,
    /(?:session|server)\s*[:=]\s*(\d{2,})/i
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && Number.isFinite(Number(match[1])) && Number(match[1]) > 0) {
      return Number(match[1]);
    }
  }
  return null;
}

function findClosedLocalSessionForServerSessionId(
  serverSessionId: number,
  cache: AppCachePayload | null | undefined,
  queuedSessionKey?: string | null
) {
  const normalizedServerSessionId = Number(serverSessionId || 0);
  if (!Number.isFinite(normalizedServerSessionId) || normalizedServerSessionId <= 0) return null;
  const currentCache = normalizeLocalAttendanceCache(cache);
  const serverSessionKey = getServerSessionKey(normalizedServerSessionId);
  const aliasMap = currentCache.sessionAliasMap || {};
  const queuedResolved = String(queuedSessionKey || '').trim() ? resolveSessionKey(String(queuedSessionKey || '').trim(), aliasMap) : '';

  for (const session of Object.values(currentCache.sessionsByKey || {})) {
    if (!isCanonicalSessionClosed(session)) continue;
    const sessionKey = String(session.sessionKey || '').trim();
    const resolvedSessionKey = resolveSessionKey(sessionKey, aliasMap);
    const localSessionKey = session.localSessionId ? getLocalSessionKey(session.localSessionId) : '';
    const canonicalServerId = Number(session.serverSessionId || session.session_id || 0);
    const directMatch = canonicalServerId === normalizedServerSessionId;
    const aliasMatch = [sessionKey, resolvedSessionKey, localSessionKey, aliasMap[localSessionKey] || '', queuedResolved]
      .map((value) => String(value || '').trim())
      .some((value) => value === serverSessionKey);
    if (directMatch || aliasMatch) {
      return session;
    }
  }

  return null;
}

function normalizeStudentMap(value: unknown, fallbackStudents: CachedStudentRow[] | undefined): Record<string, CachedStudentRow> {
  const next: Record<string, CachedStudentRow> = {};
  if (value && typeof value === 'object') {
    for (const [key, student] of Object.entries(value as Record<string, unknown>)) {
      if (!student || typeof student !== 'object') continue;
      const typed = student as CachedStudentRow;
      const uid = String(typed.student_uid || key || '').trim();
      if (!uid) continue;
      next[uid] = typed;
    }
  }
  if (!Object.keys(next).length && Array.isArray(fallbackStudents)) {
    for (const student of fallbackStudents) {
      const uid = String(student?.student_uid || '').trim();
      if (!uid) continue;
      next[uid] = student;
    }
  }
  return next;
}

function normalizeRosterByBatch(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string[]>>((acc, [batchName, roster]) => {
    const name = String(batchName || '').trim();
    if (!name) return acc;
    const uids = Array.isArray(roster)
      ? roster.map((studentUid) => String(studentUid || '').trim()).filter(Boolean)
      : [];
    acc[name] = Array.from(new Set(uids));
    return acc;
  }, {});
}

function normalizeAttendanceHistoryRow(row: unknown): AttendanceHistoryRow | null {
  if (!row || typeof row !== 'object') return null;
  const typed = row as Partial<AttendanceHistoryRow>;
  const date = String(typed.date || '').trim();
  const sessionName = String(typed.session_name || '').trim();
  if (!date && !sessionName) return null;
  return {
    session_id: Number.isFinite(Number(typed.session_id)) ? Number(typed.session_id) : undefined,
    batch_id: String(typed.batch_id || '').trim() || undefined,
    date: date || new Date().toISOString(),
    present: Number.isFinite(Number(typed.present)) ? Number(typed.present) : 0,
    late: Number.isFinite(Number(typed.late)) ? Number(typed.late) : 0,
    total: Number.isFinite(Number(typed.total)) ? Number(typed.total) : 0,
    session_name: sessionName || 'Attendance Session'
  };
}

function normalizeSmsBatchHistoryByBatch(value: unknown): Record<string, AttendanceHistoryRow[]> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, AttendanceHistoryRow[]>>((acc, [batchName, history]) => {
    const name = String(batchName || '').trim();
    if (!name) return acc;
    const rows = Array.isArray(history)
      ? history.map((row) => normalizeAttendanceHistoryRow(row)).filter((row): row is AttendanceHistoryRow => Boolean(row))
      : [];
    acc[name] = rows.sort(compareAttendanceHistoryRowsForLatestFirst);
    return acc;
  }, {});
}

function normalizeAttendanceHistoryRows(rows: AttendanceHistoryRow[] | null | undefined) {
  return Array.isArray(rows)
    ? rows.map((row) => normalizeAttendanceHistoryRow(row)).filter((row): row is AttendanceHistoryRow => Boolean(row))
        .sort(compareAttendanceHistoryRowsForLatestFirst)
    : [];
}

function normalizeSessionsByKey(value: unknown, currentSession: AttendanceWorkspaceSession | null | undefined): Record<string, CanonicalSession> {
  const next: Record<string, CanonicalSession> = {};
  if (value && typeof value === 'object') {
    for (const [key, session] of Object.entries(value as Record<string, unknown>)) {
      if (!session || typeof session !== 'object') continue;
      const typed = session as CanonicalSession;
      const sessionKey = String(typed.sessionKey || key || '').trim();
      if (!sessionKey) continue;
      const display = extractSessionDisplayMetadata(typed, typed.batchName || '');
      next[sessionKey] = {
        sessionKey,
        serverSessionId: typed.serverSessionId ?? null,
        localSessionId: typed.localSessionId ?? null,
        batchName: display.batchName,
        session_name: display.sessionName,
        sessionName: display.sessionName,
        column_name: display.columnName,
        columnName: display.columnName,
        title: display.title,
        displayName: display.displayName,
        name: display.name,
        status: typed.status === 'closed' ? 'closed' : 'open',
        createdAt: String(typed.createdAt || new Date().toISOString()),
        closedAt: typed.closedAt ?? null,
        syncStatus: typed.syncStatus || 'pending_sync',
        lastError: typed.lastError ?? null,
        attemptCount: Number.isFinite(Number(typed.attemptCount)) ? Number(typed.attemptCount) : 0,
        nextAttemptAt: typed.nextAttemptAt ?? null,
        lastAttemptAt: typed.lastAttemptAt ?? null,
        lateSyncStatus: typed.lateSyncStatus || 'pending_sync',
        lateAttemptCount: Number.isFinite(Number(typed.lateAttemptCount)) ? Number(typed.lateAttemptCount) : 0,
        lateNextAttemptAt: typed.lateNextAttemptAt ?? null,
        lateLastAttemptAt: typed.lateLastAttemptAt ?? null,
        lateLastError: typed.lateLastError ?? null,
        closeSyncStatus: typed.closeSyncStatus || 'pending_sync',
        closeAttemptCount: Number.isFinite(Number(typed.closeAttemptCount)) ? Number(typed.closeAttemptCount) : 0,
        closeNextAttemptAt: typed.closeNextAttemptAt ?? null,
        closeLastAttemptAt: typed.closeLastAttemptAt ?? null,
        closeLastError: typed.closeLastError ?? null
      };
    }
  }
  const normalizedCurrentSession = normalizeAttendanceWorkspaceSession(currentSession);
  if (normalizedCurrentSession) {
    const sessionKey = getSessionKeyForIdentity(normalizedCurrentSession);
    if (sessionKey) {
      const currentServerSessionId = Number(normalizedCurrentSession.serverSessionId ?? normalizedCurrentSession.session_id ?? 0);
      const display = extractSessionDisplayMetadata(normalizedCurrentSession, normalizedCurrentSession.batch_id || '');
      next[sessionKey] = {
        sessionKey,
        serverSessionId: Number.isFinite(currentServerSessionId) && currentServerSessionId > 0 ? currentServerSessionId : null,
        localSessionId: normalizedCurrentSession.localSessionId ?? null,
        batchName: display.batchName,
        session_name: display.sessionName,
        sessionName: display.sessionName,
        column_name: display.columnName,
        columnName: display.columnName,
        title: display.title,
        displayName: display.displayName,
        name: display.name,
        status: normalizedCurrentSession.status === 'closed' ? 'closed' : 'open',
        createdAt: String(normalizedCurrentSession.created_at || new Date().toISOString()),
        closedAt: normalizedCurrentSession.closed_at ?? null,
        syncStatus: normalizedCurrentSession.syncStatus || (normalizedCurrentSession.serverSessionId ? 'synced' : 'pending_create'),
        lastError: null,
        attemptCount: Number.isFinite(Number(normalizedCurrentSession.attemptCount)) ? Number(normalizedCurrentSession.attemptCount) : 0,
        nextAttemptAt: normalizedCurrentSession.nextAttemptAt ?? null,
        lastAttemptAt: normalizedCurrentSession.lastAttemptAt ?? null,
        lateSyncStatus: normalizedCurrentSession.lateSyncStatus || 'pending_sync',
        lateAttemptCount: Number.isFinite(Number(normalizedCurrentSession.lateAttemptCount)) ? Number(normalizedCurrentSession.lateAttemptCount) : 0,
        lateNextAttemptAt: normalizedCurrentSession.lateNextAttemptAt ?? null,
        lateLastAttemptAt: normalizedCurrentSession.lateLastAttemptAt ?? null,
        lateLastError: normalizedCurrentSession.lateLastError ?? null,
        closeSyncStatus: normalizedCurrentSession.closeSyncStatus || 'pending_sync',
        closeAttemptCount: Number.isFinite(Number(normalizedCurrentSession.closeAttemptCount)) ? Number(normalizedCurrentSession.closeAttemptCount) : 0,
        closeNextAttemptAt: normalizedCurrentSession.closeNextAttemptAt ?? null,
        closeLastAttemptAt: normalizedCurrentSession.closeLastAttemptAt ?? null,
        closeLastError: normalizedCurrentSession.closeLastError ?? null
      };
    }
  }
  return next;
}

function normalizeMarksBySession(value: unknown): Record<string, Record<string, CanonicalAttendanceMark>> {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, Record<string, CanonicalAttendanceMark>> = {};
  for (const [sessionKey, marks] of Object.entries(value as Record<string, unknown>)) {
    const normalizedSessionKey = String(sessionKey || '').trim();
    if (!normalizedSessionKey || !marks || typeof marks !== 'object') continue;
    const sessionMarks: Record<string, CanonicalAttendanceMark> = {};
    for (const [studentUid, mark] of Object.entries(marks as Record<string, unknown>)) {
      if (!mark || typeof mark !== 'object') continue;
      const typed = mark as CanonicalAttendanceMark;
      const uid = String(typed.studentUid || studentUid || '').trim();
      if (!uid) continue;
      const markKey = String(typed.markKey || getMarkKey(normalizedSessionKey, uid)).trim();
      sessionMarks[uid] = {
        markKey,
        sessionKey: String(typed.sessionKey || normalizedSessionKey).trim(),
        studentUid: uid,
        status: normalizeAttendanceStatusLabel(typed.status),
        markedAt: String(typed.markedAt || new Date().toISOString()),
        syncStatus: typed.syncStatus || 'pending_sync',
        lastError: typed.lastError ?? null,
        attemptCount: Number.isFinite(Number(typed.attemptCount)) ? Number(typed.attemptCount) : 0,
        nextAttemptAt: typed.nextAttemptAt ?? null,
        lastAttemptAt: typed.lastAttemptAt ?? null
      };
    }
    if (Object.keys(sessionMarks).length > 0) {
      next[normalizedSessionKey] = sessionMarks;
    }
  }
  return next;
}

function normalizeSyncQueue(value: unknown): SyncQueueItem[] {
  if (!Array.isArray(value)) return [];
  const next: SyncQueueItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as SyncQueueItem;
    const queueKey = String(typed.queueKey || typed.markKey || '').trim();
    const markKey = String(typed.markKey || queueKey || '').trim();
    const sessionKey = String(typed.sessionKey || '').trim();
    const studentUid = String(typed.studentUid || '').trim();
    if (!queueKey || !markKey || !sessionKey || !studentUid) continue;
    if (seen.has(queueKey)) continue;
    seen.add(queueKey);
    next.push({
      queueKey,
      kind: typed.kind === 'session_create' || typed.kind === 'late_mode' || typed.kind === 'close_session' ? typed.kind : 'attendance_mark',
      sessionKey,
      markKey: markKey || undefined,
      studentUid: studentUid || undefined,
      status: typed.status ? normalizeAttendanceStatusLabel(typed.status) : undefined,
      createdAt: String(typed.createdAt || new Date().toISOString()),
      updatedAt: String(typed.updatedAt || typed.createdAt || new Date().toISOString()),
      syncStatus: typed.syncStatus || 'pending_sync',
      attemptCount: Number.isFinite(Number(typed.attemptCount)) ? Number(typed.attemptCount) : 0,
      nextAttemptAt: typed.nextAttemptAt ?? null,
      lastAttemptAt: typed.lastAttemptAt ?? null,
      lastError: typed.lastError ?? null
    });
  }
  return next;
}

function normalizeLocalAttendanceCache(cache: AppCachePayload | null | undefined): AppCachePayload {
  const next: AppCachePayload = {
    ...(cache && typeof cache === 'object' ? cache : {})
  };
  const fallbackStudents = Array.isArray(next.students) ? next.students : [];
  next.cacheVersion = Number.isFinite(Number(next.cacheVersion)) ? Number(next.cacheVersion) : LOCAL_ATTENDANCE_CACHE_VERSION;
  next.updatedAt = String(next.updatedAt || new Date().toISOString());
  next.studentsByUid = normalizeStudentMap(next.studentsByUid, fallbackStudents);
  next.rosterByBatch = normalizeRosterByBatch(next.rosterByBatch);
  next.sessionsByKey = normalizeSessionsByKey(next.sessionsByKey, next.currentSession);
  next.attendanceMarksBySession = normalizeMarksBySession(next.attendanceMarksBySession);
  next.smsBatchHistoryByBatch = normalizeSmsBatchHistoryByBatch(next.smsBatchHistoryByBatch);
  next.syncQueue = normalizeSyncQueue(next.syncQueue);
  next.sessionAliasMap = normalizeSessionAliasMap(next.sessionAliasMap);
  next.staffOtaAppliedConfigVersion = Number.isFinite(Number(next.staffOtaAppliedConfigVersion))
    ? Number(next.staffOtaAppliedConfigVersion)
    : 0;
  if (!Array.isArray(next.attendanceQueue)) {
    next.attendanceQueue = [];
  }
  return next;
}

function mergeStudentRows(existing: CachedStudentRow | undefined, incoming: StudentRow | CachedStudentRow): CachedStudentRow {
  const base = (existing || {}) as Partial<CachedStudentRow>;
  const next = (incoming || {}) as Partial<CachedStudentRow>;
  const pick = (incomingValue: unknown, existingValue: unknown) => {
    if (incomingValue === undefined || incomingValue === null) return existingValue;
    if (typeof incomingValue === 'string') {
      return String(incomingValue || '').trim() ? incomingValue : existingValue;
    }
    return incomingValue;
  };
  return {
    ...base,
    ...next,
    id: Number(pick(next.id, base.id) || 0),
    name: String(pick(next.name, base.name) || ''),
    student_uid: String(pick(next.student_uid, base.student_uid) || ''),
    secure_token: (pick(next.secure_token, base.secure_token) || null) as string | null,
    phone: String(pick(next.phone, base.phone) || ''),
    father_name: String(pick(next.father_name, base.father_name) || ''),
    guardian_phone: String(pick(next.guardian_phone, base.guardian_phone) || ''),
    father_phone: String(pick((next as StudentRow).father_phone, (base as StudentRow).father_phone) || ''),
    parent_phone: String(pick((next as StudentRow).parent_phone, (base as StudentRow).parent_phone) || ''),
    address: String(pick(next.address, base.address) || ''),
    student_class: String(pick(next.student_class, base.student_class) || ''),
    current_batch: String(pick(next.current_batch, base.current_batch) || ''),
    batch_name: String(pick(next.batch_name, base.batch_name) || ''),
    batches: pick(next.batches, base.batches) as string[] | string | undefined,
    system_batches: pick(next.system_batches, base.system_batches) as string[] | string | undefined,
    primary_system_batch: pick(next.primary_system_batch, base.primary_system_batch) as string | undefined,
    aspiration: String(pick(next.aspiration, base.aspiration) || ''),
    attendance_percent: Number(pick(next.attendance_percent, base.attendance_percent) || 0) || 0,
    status: String(pick(next.status, base.status) || 'active'),
    photo: (pick(next.photo, base.photo) || null) as string | null,
    photo_path: pick(next.photo_path, base.photo_path) as string | null | undefined,
    qr_path: pick(next.qr_path, base.qr_path) as string | null | undefined,
    fbc_no: String(pick(next.fbc_no, base.fbc_no) || ''),
    attendance_status: Number(pick((next as StudentRow).attendance_status, (base as StudentRow).attendance_status) || 0) || 0,
    attendance_marked_offline: Boolean((next as StudentRow).attendance_marked_offline ?? (base as StudentRow).attendance_marked_offline),
    attendance_marked_at: pick((next as StudentRow).attendance_marked_at, (base as StudentRow).attendance_marked_at) as string | undefined,
    created_at: pick(next.created_at, base.created_at) as string | undefined
  };
}

function buildStudentsByUid(rows: Array<StudentRow | CachedStudentRow> | null | undefined, existing?: Record<string, CachedStudentRow>): Record<string, CachedStudentRow> {
  if (!Array.isArray(rows) || !rows.length) return {};
  return rows.reduce<Record<string, CachedStudentRow>>((acc, row) => {
    const uid = String(row?.student_uid || '').trim();
    if (!uid) return acc;
    acc[uid] = mergeStudentRows(acc[uid] || existing?.[uid], row);
    return acc;
  }, { ...(existing || {}) });
}

function buildRosterByBatch(rows: Array<StudentRow | CachedStudentRow> | null | undefined): string[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  return Array.from(new Set(rows.map((row) => String(row?.student_uid || '').trim()).filter(Boolean)));
}

function mergeRosterRowsByUid(baseRows: Array<StudentRow | CachedStudentRow> | null | undefined, extraRows: Array<StudentRow | CachedStudentRow> | null | undefined) {
  const normalizedBaseRows = Array.isArray(baseRows) ? baseRows : [];
  const normalizedExtraRows = Array.isArray(extraRows) ? extraRows : [];
  if (!normalizedBaseRows.length) return compactStudentDirectoryRows(normalizedExtraRows);
  if (!normalizedExtraRows.length) return compactStudentDirectoryRows(normalizedBaseRows);

  // Directory rows should enrich missing profile data, but they must never
  // overwrite live attendance state that already came from the server roster.
  const sanitizedExtraRows = normalizedExtraRows.map((row) => stripAttendanceMetadata(row) || row);
  const baseByUid = buildStudentsByUid(normalizedBaseRows);
  const mergedByUid = buildStudentsByUid(sanitizedExtraRows, baseByUid);
  const ordered: Array<StudentRow | CachedStudentRow> = normalizedBaseRows.map((row) => {
    const uid = String(row?.student_uid || '').trim();
    return uid ? (mergedByUid[uid] || row) : row;
  });
  const seen = new Set(normalizedBaseRows.map((row) => String(row?.student_uid || '').trim()).filter(Boolean));
  sanitizedExtraRows.forEach((row) => {
    const uid = String(row?.student_uid || '').trim();
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    ordered.push(mergedByUid[uid] || row);
  });
  return compactStudentDirectoryRows(ordered);
}

function buildDirectoryRosterRowsForBatch(batchName: string, studentsByUid: Record<string, CachedStudentRow> | undefined) {
  const normalizedBatchName = String(batchName || '').trim();
  if (!normalizedBatchName || !studentsByUid) return [];
  return compactStudentDirectoryRows(
    Object.values(studentsByUid).filter((student) => batchMatches(student, normalizedBatchName))
  );
}

function getRosterStudentUidsForBatch(batchName: string, rosterByBatch: Record<string, string[]> | undefined) {
  const normalizedBatchName = String(batchName || '').trim();
  if (!normalizedBatchName || !rosterByBatch) return [];
  return Array.isArray(rosterByBatch[normalizedBatchName]) ? rosterByBatch[normalizedBatchName] : [];
}

function getStudentByUid(studentsByUid: Record<string, CachedStudentRow> | undefined, uid: string) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || !studentsByUid) return null;
  return studentsByUid[normalizedUid] || null;
}

function getSessionMarks(
  attendanceMarksBySession: Record<string, Record<string, CanonicalAttendanceMark>> | undefined,
  sessionKey: string,
  sessionAliasMap?: Record<string, string>
) {
  const normalizedSessionKey = String(sessionKey || '').trim();
  if (!normalizedSessionKey || !attendanceMarksBySession) return {};
  const resolvedSessionKey = resolveSessionKey(normalizedSessionKey, sessionAliasMap);
  return (attendanceMarksBySession[resolvedSessionKey] || attendanceMarksBySession[normalizedSessionKey] || {}) as Record<string, CanonicalAttendanceMark>;
}

function resolveSmsPreviewSessionKey(params: {
  candidate: SmsSessionCandidate;
  sessionsByKey?: Record<string, CanonicalSession>;
  attendanceMarksBySession?: Record<string, Record<string, CanonicalAttendanceMark>>;
  sessionAliasMap?: Record<string, string>;
  currentSessionKey?: string | null;
}) {
  const candidate = params.candidate;
  const sessionsByKey = params.sessionsByKey || {};
  const attendanceMarksBySession = params.attendanceMarksBySession || {};
  const aliasMap = params.sessionAliasMap || {};
  const candidateKeys = new Set<string>();
  const addCandidateKey = (value: unknown) => {
    const key = String(value || '').trim();
    if (!key) return;
    candidateKeys.add(key);
    const resolved = resolveSessionKey(key, aliasMap);
    if (resolved) candidateKeys.add(resolved);
  };

  addCandidateKey(candidate.sessionKey);
  addCandidateKey(candidate.key);
  addCandidateKey(candidate.serverSessionId ? `server:${candidate.serverSessionId}` : '');
  addCandidateKey(candidate.serverSessionId ? String(candidate.serverSessionId) : '');
  addCandidateKey(candidate.localSessionId ? getLocalSessionKey(candidate.localSessionId) : '');
  addCandidateKey(candidate.localSessionId ? `local:${candidate.localSessionId}` : '');
  addCandidateKey(params.currentSessionKey || '');

  for (const key of candidateKeys) {
    if (Object.keys(getSessionMarks(attendanceMarksBySession, key, aliasMap)).length > 0) {
      return key;
    }
  }

  const currentSessionKey = String(params.currentSessionKey || '').trim();
  if (currentSessionKey) {
    const currentMarks = getSessionMarks(attendanceMarksBySession, currentSessionKey, aliasMap);
    if (Object.keys(currentMarks).length > 0) {
      return currentSessionKey;
    }
  }

  const candidateSessionId = Number(candidate.sessionId || candidate.serverSessionId || 0) || null;
  const candidateBatchId = String(candidate.batchId || '').trim();
  const candidateLabel = String(candidate.label || '').trim().toLowerCase();
  const sessionMatches = Object.entries(sessionsByKey)
    .map(([key, session]) => {
      const normalizedSession = normalizeAttendanceWorkspaceSession(session);
      if (!normalizedSession) return null;
      const resolvedKey = resolveSessionKey(String(normalizedSession.sessionKey || key || '').trim(), aliasMap);
      const serverSessionId = Number(normalizedSession.serverSessionId || normalizedSession.session_id || getSessionIdsFromKey(resolvedKey).serverSessionId || 0) || null;
      const localSessionId = String(normalizedSession.localSessionId || getSessionIdsFromKey(resolvedKey).localSessionId || '').trim();
      const sessionBatchId = String(normalizedSession.batch_id || (normalizedSession as any).batchName || '').trim();
      const sessionLabel = String(
        normalizedSession.session_name
        || normalizedSession.sessionName
        || normalizedSession.title
        || normalizedSession.displayName
        || normalizedSession.column_name
        || normalizedSession.columnName
        || ''
      ).trim().toLowerCase();
      const matchesId = Boolean(candidateSessionId)
        && (
          serverSessionId === candidateSessionId
          || Number(normalizedSession.session_id || 0) === candidateSessionId
          || (candidate.localSessionId && localSessionId === candidate.localSessionId)
        );
      const matchesBatch = Boolean(candidateBatchId) && normalizeBatchIdentity(sessionBatchId) === normalizeBatchIdentity(candidateBatchId);
      const matchesLabel = Boolean(candidateLabel) && sessionLabel === candidateLabel;
      if (!matchesId && !matchesBatch && !matchesLabel) return null;
      return resolvedKey || key;
    })
    .filter(Boolean) as string[];

  for (const key of sessionMatches) {
    if (Object.keys(getSessionMarks(attendanceMarksBySession, key, aliasMap)).length > 0) {
      return key;
    }
  }

  return candidate.sessionKey || candidate.key || currentSessionKey || '';
}

function stripAttendanceMetadata<T extends StudentRow | CachedStudentRow | null | undefined>(row: T) {
  if (!row) return null;
  const { attendance_status, attendance_marked_offline, attendance_marked_at, attendance_state, ...rest } = row as StudentRow & { attendance_state?: StudentRow['attendance_state'] };
  return rest as StudentRow;
}

function deriveRosterRow(
  uid: string,
  studentsByUid: Record<string, CachedStudentRow> | undefined,
  sessionMarks: Record<string, CanonicalAttendanceMark> | undefined,
  fallbackRow?: StudentRow | CachedStudentRow | null
) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return null;
  const cachedRow = getStudentByUid(studentsByUid, normalizedUid) || null;
  const baseRow = fallbackRow
    ? mergeStudentRows(cachedRow || undefined, fallbackRow)
    : cachedRow;
  if (!baseRow) return null;
  const mark = sessionMarks?.[normalizedUid] || null;
  if (!mark) {
    const fallbackAttendanceStatus = Number((fallbackRow as StudentRow | null)?.attendance_status || 0) || 0;
    const fallbackAttendanceMarkedAt = (fallbackRow as StudentRow | null)?.attendance_marked_at;
    const fallbackAttendanceOffline = Boolean((fallbackRow as StudentRow | null)?.attendance_marked_offline);
    const fallbackAttendanceState = (fallbackRow as StudentRow | null)?.attendance_state;
    return {
      ...stripAttendanceMetadata(baseRow),
      student_uid: normalizedUid,
      ...(fallbackAttendanceStatus === 1 || fallbackAttendanceStatus === 2
        ? {
          attendance_status: fallbackAttendanceStatus,
          attendance_marked_offline: fallbackAttendanceOffline,
          attendance_marked_at: fallbackAttendanceMarkedAt,
          attendance_state: fallbackAttendanceState || (fallbackAttendanceStatus === 2 ? 'late' : 'present')
        }
        : {})
    } as StudentRow;
  }
  return {
    ...stripAttendanceMetadata(baseRow),
    student_uid: normalizedUid,
    attendance_status: attendanceStatusLabelToCode(mark.status),
    attendance_marked_offline: true,
    attendance_marked_at: mark.markedAt
  } as StudentRow;
}

function deriveAttendanceRosterRows(params: {
  batchName?: string;
  sessionKey?: string;
  studentsByUid?: Record<string, CachedStudentRow>;
  rosterByBatch?: Record<string, string[]>;
  attendanceMarksBySession?: Record<string, Record<string, CanonicalAttendanceMark>>;
  sessionAliasMap?: Record<string, string>;
  legacyRoster?: StudentRow[] | null;
}) {
  const batchName = String(params.batchName || '').trim();
  const rosterUids = batchName ? getRosterStudentUidsForBatch(batchName, params.rosterByBatch) : [];
  const legacyRoster = Array.isArray(params.legacyRoster) ? params.legacyRoster : [];
  const sessionMarks = getSessionMarks(params.attendanceMarksBySession, params.sessionKey || '', params.sessionAliasMap);
  const legacyByUid = new Map<string, StudentRow>();
  legacyRoster.forEach((row) => {
    const uid = String(row?.student_uid || '').trim();
    if (uid && !legacyByUid.has(uid)) legacyByUid.set(uid, row);
  });

  const directoryRosterUids = batchName && params.studentsByUid
    ? Object.values(params.studentsByUid)
      .filter((student) => batchMatches(student, batchName))
      .map((student) => String(student?.student_uid || '').trim())
      .filter(Boolean)
    : [];

  const mergedSourceUids = Array.from(new Set([
    ...rosterUids,
    ...legacyRoster.map((row) => String(row?.student_uid || '').trim()).filter(Boolean),
    ...directoryRosterUids
  ]));
  const resolvedSourceUids = mergedSourceUids.length ? mergedSourceUids : directoryRosterUids;

  return resolvedSourceUids
    .map((uid) => deriveRosterRow(uid, params.studentsByUid, sessionMarks, legacyByUid.get(uid) || null))
    .filter(Boolean) as StudentRow[];
}

function deriveAttendanceConsoleRows(params: {
  batchName?: string;
  sessionKey?: string;
  sessionMode: 'roster' | 'active' | 'closed';
  studentsByUid?: Record<string, CachedStudentRow>;
  rosterByBatch?: Record<string, string[]>;
  attendanceMarksBySession?: Record<string, Record<string, CanonicalAttendanceMark>>;
  sessionAliasMap?: Record<string, string>;
  legacyRoster?: StudentRow[] | null;
}) {
  const baseRows = deriveAttendanceRosterRows({
    batchName: params.batchName,
    sessionKey: params.sessionKey,
    studentsByUid: params.studentsByUid,
    rosterByBatch: params.rosterByBatch,
    attendanceMarksBySession: params.attendanceMarksBySession,
    sessionAliasMap: params.sessionAliasMap,
    legacyRoster: params.legacyRoster
  });
  const nextRows = baseRows.map((row) => {
    const sanitizedRow = stripAttendanceMetadata(row) || row;
    const statusCode = Number(row.attendance_status || 0) || 0;
    if (params.sessionMode === 'roster') {
      return sanitizedRow;
    }
    if (statusCode === 1 || statusCode === 2) {
      return {
        ...sanitizedRow,
        attendance_status: statusCode,
        attendance_marked_offline: row.attendance_marked_offline,
        attendance_marked_at: row.attendance_marked_at,
        attendance_state: statusCode === 2 ? 'late' : 'present'
      } as StudentRow;
    }
    if (params.sessionMode === 'closed') {
      return {
        ...sanitizedRow,
        attendance_status: 0,
        attendance_state: 'absent'
      } as StudentRow;
    }
    return {
      ...sanitizedRow,
      attendance_state: 'not_marked'
    } as StudentRow;
  });
  return sortAttendanceRowsForDisplay(nextRows, params.sessionMode);
}

function sortAttendanceRowsForDisplay(rows: StudentRow[], sessionMode: 'roster' | 'active' | 'closed') {
  if (!Array.isArray(rows) || sessionMode === 'roster') {
    return Array.isArray(rows) ? rows : [];
  }
  const priorityForStatus = (row: StudentRow) => {
    const rawStatus = String(row?.attendance_state || '').trim().toLowerCase();
    const statusCode = Number(row?.attendance_status || 0) || 0;
    if (statusCode === 1 || rawStatus === 'present') return 0;
    if (statusCode === 2 || rawStatus === 'late') return 1;
    if (rawStatus === 'not_marked') return 2;
    if (statusCode === 0 || rawStatus === 'absent') return 3;
    return 4;
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const priorityDiff = priorityForStatus(left.row) - priorityForStatus(right.row);
      if (priorityDiff !== 0) return priorityDiff;
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

function buildSmsSessionCandidates(params: {
  batchName?: string;
  history?: AttendanceHistoryRow[];
  currentSession?: AttendanceWorkspaceSession | null;
  sessionsByKey?: Record<string, CanonicalSession>;
  sessionAliasMap?: Record<string, string>;
}) {
  const normalizedBatchName = String(params.batchName || '').trim();
  const historyRows = Array.isArray(params.history) ? params.history : [];
  const liveSession = normalizeAttendanceWorkspaceSession(params.currentSession);
  const sessionsByKey = params.sessionsByKey || {};
  const aliasMap = params.sessionAliasMap || {};
  const candidates = new Map<string, SmsSessionCandidate>();
  const aliasToPrimary = new Map<string, string>();
  const normalizeIdentityPart = (value: unknown) => String(value || '').trim().toLowerCase();
  const buildDisplayIdentity = (batchId: string, label: string, date: string) => {
    const normalizedDate = String(date || '').trim().slice(0, 10);
    return [normalizeIdentityPart(batchId), normalizeIdentityPart(label), normalizedDate].filter(Boolean).join('|');
  };
  const buildCandidateIdentity = (session: Record<string, unknown>, labelFallback: string, source: 'history' | 'local') => {
    const sessionKey = String((session as { sessionKey?: unknown }).sessionKey || getSessionKeyForIdentity(session as any) || '').trim();
    const resolvedSessionKey = resolveSessionKey(sessionKey, aliasMap);
    const serverSessionId = Number((session as { serverSessionId?: unknown }).serverSessionId || getSessionIdsFromKey(resolvedSessionKey).serverSessionId || (session as { session_id?: unknown }).session_id || 0) || null;
    const localSessionId = String((session as { localSessionId?: unknown }).localSessionId || getSessionIdsFromKey(resolvedSessionKey).localSessionId || '').trim();
    const batchId = String((session as { batch_id?: unknown }).batch_id || (session as { batchName?: unknown }).batchName || normalizedBatchName || '').trim();
    const label = getSessionLabel({
      ...(session || {}),
      batch_id: batchId,
      session_name: (session as { session_name?: unknown }).session_name
        || (session as { sessionName?: unknown }).sessionName
        || (session as { name?: unknown }).name
        || (session as { title?: unknown }).title
        || (session as { displayName?: unknown }).displayName
        || (session as { column_name?: unknown }).column_name
        || (session as { columnName?: unknown }).columnName
        || labelFallback,
      column_name: (session as { column_name?: unknown }).column_name
        || (session as { columnName?: unknown }).columnName,
      date: (session as { date?: unknown }).date || (session as { createdAt?: unknown }).createdAt || (session as { created_at?: unknown }).created_at || (session as { closedAt?: unknown }).closedAt || (session as { closed_at?: unknown }).closed_at || ''
    }, batchId);
    const date = String(
      (session as { date?: unknown }).date
      || (session as { createdAt?: unknown }).createdAt
      || (session as { created_at?: unknown }).created_at
      || (session as { closedAt?: unknown }).closedAt
      || (session as { closed_at?: unknown }).closed_at
      || ''
    ).trim();
    const displayIdentity = buildDisplayIdentity(batchId, label, date);
    const keys = Array.from(new Set([
      resolvedSessionKey,
      sessionKey,
      serverSessionId ? `server:${serverSessionId}` : '',
      serverSessionId ? String(serverSessionId) : '',
      localSessionId ? getLocalSessionKey(localSessionId) : '',
      localSessionId ? `local:${localSessionId}` : '',
      displayIdentity ? `display:${displayIdentity}` : ''
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    const primaryKey = serverSessionId
      ? `server:${serverSessionId}`
      : (resolvedSessionKey || sessionKey || (localSessionId ? getLocalSessionKey(localSessionId) : '') || (displayIdentity ? `display:${displayIdentity}` : ''));
    return {
      keys,
      primaryKey,
      sessionKey: resolvedSessionKey || sessionKey,
      serverSessionId,
      localSessionId,
      batchId,
      label,
      date,
      source
    };
  };
  const findExisting = (keys: string[]) => {
    for (const key of keys) {
      const primary = aliasToPrimary.get(key) || key;
      const existing = candidates.get(primary);
      if (existing) {
        return { primary, existing };
      }
    }
    return null;
  };
  const storeCandidate = (candidate: SmsSessionCandidate, keys: string[], primaryKey = candidate.key) => {
    candidates.set(primaryKey, candidate);
    aliasToPrimary.set(primaryKey, primaryKey);
    keys.forEach((key) => aliasToPrimary.set(key, primaryKey));
  };
  const mergeCandidates = (existing: SmsSessionCandidate, next: SmsSessionCandidate): SmsSessionCandidate => {
    const mergedServerSessionId = next.serverSessionId || existing.serverSessionId || null;
    const mergedLocalSessionId = next.localSessionId || existing.localSessionId || null;
    const mergedSessionId = Number(next.sessionId || 0) > 0
      ? Number(next.sessionId || 0)
      : (Number(existing.sessionId || 0) > 0 ? Number(existing.sessionId || 0) : Number(next.sessionId || existing.sessionId || 0) || 0);
    const mergedStatus = existing.status === 'closed' || next.status === 'closed'
      ? 'closed'
      : (next.status || existing.status);
    return {
      ...existing,
      ...next,
      key: existing.key,
      sessionKey: existing.sessionKey || next.sessionKey,
      sessionId: mergedSessionId,
      batchId: next.batchId || existing.batchId,
      date: next.date || existing.date,
      present: next.present || existing.present || 0,
      late: next.late || existing.late || 0,
      total: next.total || existing.total || 0,
      source: existing.source === 'history' || next.source === 'history' ? 'history' : 'local',
      localSessionId: mergedLocalSessionId,
      serverSessionId: mergedServerSessionId,
      status: mergedStatus
    };
  };

  historyRows.forEach((row) => {
    const sessionId = Number(row?.session_id || 0);
    if (!sessionId) return;
    const batchId = String(row?.batch_id || normalizedBatchName || '').trim();
    if (normalizedBatchName && batchId && batchId !== normalizedBatchName) return;
    const identity = buildCandidateIdentity({
      sessionKey: `server:${sessionId}`,
      session_id: sessionId,
      batch_id: batchId,
      session_name: row?.session_name || 'Attendance Session',
      date: row?.date || ''
    }, String(row?.session_name || 'Attendance Session').trim() || 'Attendance Session', 'history');
    const nextCandidate: SmsSessionCandidate = {
      key: identity.primaryKey,
      label: identity.label,
      sessionKey: identity.sessionKey || `server:${sessionId}`,
      sessionId,
      batchId,
      date: identity.date,
      present: Number(row?.present || 0) || 0,
      late: Number(row?.late || 0) || 0,
      total: Number(row?.total || 0) || 0,
      source: 'history',
      serverSessionId: sessionId,
      status: 'closed'
    };
    const existing = findExisting(identity.keys);
    if (!existing) {
      storeCandidate(nextCandidate, identity.keys, identity.primaryKey);
      return;
    }
    const merged = mergeCandidates(existing.existing, nextCandidate);
    storeCandidate(merged, identity.keys, existing.primary);
  });

  if (liveSession && liveSession.status !== 'closed') {
    const liveBatch = String(liveSession.batch_id || '').trim() || String((liveSession as any).batchName || '').trim();
    if (!normalizedBatchName || !liveBatch || liveBatch === normalizedBatchName) {
      const liveSessionKey = String(liveSession.sessionKey || getSessionKeyForIdentity(liveSession) || '').trim();
      const liveServerSessionId = Number(liveSession.serverSessionId || liveSession.session_id || getSessionIdsFromKey(liveSessionKey).serverSessionId || 0) || null;
      const liveIdentity = buildCandidateIdentity({
        ...liveSession,
        sessionKey: liveSessionKey,
        batch_id: liveBatch
      }, String(
        liveSession.session_name
        || liveSession.sessionName
        || liveSession.title
        || liveSession.displayName
        || liveSession.column_name
        || liveSession.columnName
        || 'Attendance Session'
      ).trim() || 'Attendance Session', 'history');
      const liveCandidate: SmsSessionCandidate = {
        key: liveIdentity.primaryKey,
        label: liveIdentity.label,
        sessionKey: liveIdentity.sessionKey || liveSessionKey,
        sessionId: liveServerSessionId || Number(liveSession.session_id || 0) || 0,
        batchId: liveBatch,
        date: String(liveSession.created_at || new Date().toISOString()).trim(),
        present: 0,
        late: 0,
        total: 0,
        source: 'history',
        localSessionId: liveIdentity.localSessionId || liveSession.localSessionId || getSessionIdsFromKey(liveSessionKey).localSessionId || null,
        serverSessionId: liveServerSessionId,
        status: 'open'
      };
      const existing = findExisting(liveIdentity.keys);
      if (!existing) {
        storeCandidate(liveCandidate, liveIdentity.keys, liveIdentity.primaryKey);
      } else {
        storeCandidate(mergeCandidates(existing.existing, liveCandidate), liveIdentity.keys, existing.primary);
      }
    }
  }

  if (historyRows.length === 0) {
    Object.values(sessionsByKey).forEach((session) => {
      const normalizedSession = normalizeAttendanceWorkspaceSession(session);
      if (!normalizedSession) return;
      const sessionBatch = String(normalizedSession.batch_id || '').trim() || String((normalizedSession as any).batchName || '').trim();
      if (normalizedBatchName && sessionBatch && sessionBatch !== normalizedBatchName) return;

      const sessionKey = String(normalizedSession.sessionKey || getSessionKeyForIdentity(normalizedSession) || '').trim();
      if (!sessionKey) return;
      const resolvedSessionKey = resolveSessionKey(sessionKey, aliasMap);
      const serverSessionId = Number(normalizedSession.serverSessionId || getSessionIdsFromKey(resolvedSessionKey).serverSessionId || 0) || null;
      if (normalizedSession.status !== 'closed' && !serverSessionId) return;
      const identity = buildCandidateIdentity({
        ...normalizedSession,
        sessionKey: resolvedSessionKey || sessionKey,
        batch_id: sessionBatch
      }, String(
        normalizedSession.session_name
        || normalizedSession.sessionName
        || normalizedSession.title
        || normalizedSession.displayName
        || normalizedSession.column_name
        || normalizedSession.columnName
        || 'Attendance Session'
      ).trim() || 'Attendance Session', 'local');
      const nextCandidate: SmsSessionCandidate = {
        key: identity.primaryKey,
        label: identity.label,
        sessionKey: identity.sessionKey || resolvedSessionKey || sessionKey,
        sessionId: serverSessionId || Number(normalizedSession.session_id || 0) || 0,
        batchId: sessionBatch,
        date: identity.date,
        present: 0,
        late: 0,
        total: 0,
        source: 'local',
        localSessionId: identity.localSessionId || normalizedSession.localSessionId || getSessionIdsFromKey(sessionKey).localSessionId || null,
        serverSessionId,
        status: normalizedSession.status === 'closed' ? 'closed' : 'open'
      };
      const existing = findExisting(identity.keys);
      if (!existing) {
        storeCandidate(nextCandidate, identity.keys, identity.primaryKey);
        return;
      }
      const merged = mergeCandidates(existing.existing, nextCandidate);
      storeCandidate(merged, identity.keys, existing.primary);
    });
  }

  const orderedCandidates = Array.from(candidates.values()).sort((a, b) => {
    const leftSessionId = Number(a.sessionId || 0);
    const rightSessionId = Number(b.sessionId || 0);
    if (leftSessionId !== rightSessionId) {
      return rightSessionId - leftSessionId;
    }
    const leftDate = String(a.date || '').trim();
    const rightDate = String(b.date || '').trim();
    if (leftDate !== rightDate) {
      return rightDate.localeCompare(leftDate);
    }
    const leftLabel = String(a.label || '').trim();
    const rightLabel = String(b.label || '').trim();
    return rightLabel.localeCompare(leftLabel);
  });
  return orderedCandidates.slice(0, 5);
}

function resolveSmsSessionCandidate(params: {
  requestedKey?: string;
  candidates: SmsSessionCandidate[];
  sessionsByKey?: Record<string, CanonicalSession>;
  sessionAliasMap?: Record<string, string>;
  allowSessionCacheFallback?: boolean;
}) {
  const requestedKey = String(params.requestedKey || '').trim();
  const candidates = Array.isArray(params.candidates) ? params.candidates : [];
  const sessionsByKey = params.sessionsByKey || {};
  const aliasMap = params.sessionAliasMap || {};
  const allowSessionCacheFallback = params.allowSessionCacheFallback !== false;
  if (!requestedKey) {
    return candidates[0] || null;
  }

  const exact = candidates.find((candidate) => candidate.key === requestedKey || candidate.sessionKey === requestedKey);
  if (exact) return exact;

  const resolvedRequestedKey = resolveSessionKey(requestedKey, aliasMap);
  const resolvedExact = candidates.find((candidate) => candidate.key === resolvedRequestedKey || candidate.sessionKey === resolvedRequestedKey);
  if (resolvedExact) return resolvedExact;

  const ids = getSessionIdsFromKey(requestedKey);
  const resolvedIds = getSessionIdsFromKey(resolvedRequestedKey);
  if (!allowSessionCacheFallback) {
    return candidates[0] || null;
  }
  const session = Object.values(sessionsByKey).find((entry) => {
    const normalized = normalizeAttendanceWorkspaceSession(entry);
    if (!normalized) return false;
    const sessionKey = String(normalized.sessionKey || getSessionKeyForIdentity(normalized) || '').trim();
    const normalizedResolvedKey = resolveSessionKey(sessionKey, aliasMap);
    const serverSessionId = Number(normalized.serverSessionId || getSessionIdsFromKey(normalizedResolvedKey).serverSessionId || 0) || 0;
    const localSessionId = String(normalized.localSessionId || getSessionIdsFromKey(normalizedResolvedKey).localSessionId || '').trim();
    return sessionKey === requestedKey
      || normalizedResolvedKey === resolvedRequestedKey
      || (ids.serverSessionId && serverSessionId === ids.serverSessionId)
      || (resolvedIds.serverSessionId && serverSessionId === resolvedIds.serverSessionId)
      || (ids.localSessionId && localSessionId === ids.localSessionId)
      || (resolvedIds.localSessionId && localSessionId === resolvedIds.localSessionId);
  });
  if (!session) return null;

  const normalizedSession = normalizeAttendanceWorkspaceSession(session);
  if (!normalizedSession) return null;
  const sessionKey = String(normalizedSession.sessionKey || getSessionKeyForIdentity(normalizedSession) || '').trim();
  const resolvedSessionKey = resolveSessionKey(sessionKey, aliasMap);
    const serverSessionId = Number(normalizedSession.serverSessionId || getSessionIdsFromKey(resolvedSessionKey).serverSessionId || 0) || null;
    const candidateKey = serverSessionId ? `server:${serverSessionId}` : resolvedSessionKey;
    return {
      key: candidateKey,
      label: getSessionLabel(normalizedSession, String(normalizedSession.batch_id || '').trim() || String((normalizedSession as any).batchName || '').trim()),
      sessionKey: resolvedSessionKey,
      sessionId: serverSessionId || Number(normalizedSession.session_id || 0) || 0,
      batchId: String(normalizedSession.batch_id || '').trim() || String((normalizedSession as any).batchName || '').trim(),
    date: String((normalizedSession as any).createdAt || normalizedSession.created_at || (normalizedSession as any).closedAt || normalizedSession.closed_at || '').trim(),
    present: 0,
    late: 0,
    total: 0,
    source: 'local' as const,
    localSessionId: normalizedSession.localSessionId || getSessionIdsFromKey(sessionKey).localSessionId || null,
    serverSessionId,
    status: normalizedSession.status === 'closed' ? 'closed' : 'open'
  } as SmsSessionCandidate;
}

function formatSmsTemplate(template: string, data: {
  name: string;
  uid: string;
  batch: string;
  status: string;
  date: string;
  arrival_time: string;
  session_name: string;
}) {
  const raw = String(template || '');
  return raw
    .replace(/\{\{name\}\}/g, data.name)
    .replace(/\{\{uid\}\}/g, data.uid)
    .replace(/\{\{batch\}\}/g, data.batch)
    .replace(/\{\{status\}\}/g, data.status)
    .replace(/\{\{date\}\}/g, data.date)
    .replace(/\{\{arrival_time\}\}/g, data.arrival_time)
    .replace(/\{\{session_name\}\}/g, data.session_name);
}

function normalizeSmsRecipientMode(value: unknown): 'student' | 'guardian' {
  return String(value || '').trim().toLowerCase() === 'student' ? 'student' : 'guardian';
}

function resolveSmsRecipientPhone(row: Pick<StudentRow, 'phone' | 'guardian_phone'>, recipientMode: unknown) {
  const mode = normalizeSmsRecipientMode(recipientMode);
  if (mode === 'student') {
    return String(row.phone || '').trim();
  }
  return String(
    row.guardian_phone
    || (row as any).father_phone
    || (row as any).parent_phone
    || row.phone
    || ''
  ).trim();
}

function normalizeSmsPreviewRecipient(row: Partial<SmsPreviewRecipient> & { phone?: string; selected_phone?: string; recipient_phone?: string; can_send?: boolean }) {
  const recipientPhone = String(row.recipient_phone || row.selected_phone || row.phone || '').trim();
  const phone = String(row.phone || recipientPhone || '').trim();
  const selectedPhone = String(row.selected_phone || recipientPhone || phone || '').trim();
  const studentPhone = String(row.student_phone || '').trim();
  const guardianPhone = String(row.guardian_phone || '').trim();
  const fatherPhone = String(row.father_phone || '').trim();
  const parentPhone = String(row.parent_phone || '').trim();
  const selectedAudience = row.selected_audience
    || (selectedPhone && selectedPhone === studentPhone ? 'student' : selectedPhone && selectedPhone === guardianPhone ? 'guardian' : 'guardian');
  return {
    student_uid: String(row.student_uid || '').trim(),
    name: String(row.name || '').trim(),
    phone,
    selected_phone: selectedPhone,
    recipient_phone: recipientPhone,
    can_send: row.can_send ?? Boolean(selectedPhone),
    sent: Boolean(row.sent),
    sentAt: row.sentAt ?? null,
    selected_audience: selectedAudience === 'student' ? 'student' : 'guardian',
    student_phone: studentPhone,
    guardian_phone: guardianPhone,
    father_phone: fatherPhone || undefined,
    parent_phone: parentPhone || undefined,
    status: String(row.status || '').trim(),
    batch_name: String(row.batch_name || '').trim(),
    session_name: String(row.session_name || '').trim(),
    date: String(row.date || '').trim(),
    message: String(row.message || '').trim(),
    attendance_status: Number.isFinite(Number(row.attendance_status)) ? Number(row.attendance_status) : row.attendance_status,
    attendance_marked_at: row.attendance_marked_at || undefined,
    arrival_time: row.arrival_time || undefined
  } as SmsPreviewRecipient;
}

function buildLocalSmsPreview(params: {
  candidate: SmsSessionCandidate;
  batchName: string;
  roster: StudentRow[];
  studentsByUid: Record<string, CachedStudentRow>;
  rosterByBatch: Record<string, string[]>;
  attendanceMarksBySession: Record<string, Record<string, CanonicalAttendanceMark>>;
  sessionAliasMap: Record<string, string>;
  sessionsByKey?: Record<string, CanonicalSession>;
  currentSessionKey?: string | null;
  template: string;
  recipientMode: 'guardian' | 'student';
  statuses: string[];
}): SmsPreviewState {
  const candidate = params.candidate;
  const normalizedRecipientMode = normalizeSmsRecipientMode(params.recipientMode);
  const closedSession = candidate.status === 'closed' || candidate.source === 'history';
  const resolvedSessionKey = resolveSmsPreviewSessionKey({
    candidate,
    sessionsByKey: params.sessionsByKey,
    attendanceMarksBySession: params.attendanceMarksBySession,
    sessionAliasMap: params.sessionAliasMap,
    currentSessionKey: params.currentSessionKey
  });
  const resolvedRows = deriveAttendanceRosterRows({
    batchName: params.batchName || candidate.batchId,
    sessionKey: resolvedSessionKey || candidate.sessionKey,
    studentsByUid: params.studentsByUid,
    rosterByBatch: params.rosterByBatch,
    attendanceMarksBySession: params.attendanceMarksBySession,
    sessionAliasMap: params.sessionAliasMap,
    legacyRoster: params.roster
  });
  const activeStatuses = new Set(params.statuses.map((status) => String(status || '').trim().toLowerCase()).filter(Boolean));
  const includeAllStatuses = !activeStatuses.size || ['present', 'late', 'absent'].every((status) => activeStatuses.has(status));
  const recipients: SmsPreviewRecipient[] = [];
  let skipped = 0;

  resolvedRows.forEach((row) => {
    const markExists = Boolean(row.attendance_status !== undefined && row.attendance_status !== null);
    const code = markExists ? Number(row.attendance_status || 0) || 0 : null;
    const derivedStatus = markExists
      ? (code === 2 ? 'late' : code === 0 ? 'absent' : 'present')
      : (closedSession ? 'absent' : 'not_updated');
    if (!includeAllStatuses && activeStatuses.size && !activeStatuses.has(derivedStatus)) return;
    const selectedPhone = resolveSmsRecipientPhone(row, normalizedRecipientMode);
    const phone = selectedPhone;
    const canSend = Boolean(phone);
    if (!canSend) {
      skipped += 1;
    }
    recipients.push(normalizeSmsPreviewRecipient({
      student_uid: String(row.student_uid || '').trim(),
      name: String(row.name || '').trim() || row.student_uid,
      phone,
      selected_phone: selectedPhone,
      recipient_phone: selectedPhone,
      can_send: canSend,
      sent: false,
      sentAt: null,
      selected_audience: normalizedRecipientMode,
      student_phone: String(row.phone || '').trim(),
      guardian_phone: String(
        row.guardian_phone
        || (row as any).father_phone
        || (row as any).parent_phone
        || ''
      ).trim(),
      father_phone: String((row as any).father_phone || '').trim() || undefined,
      parent_phone: String((row as any).parent_phone || '').trim() || undefined,
      status: derivedStatus,
      batch_name: String(row.batch_name || row.current_batch || candidate.batchId || params.batchName || '').trim(),
      session_name: candidate.label,
      date: candidate.date || new Date().toISOString().slice(0, 10),
      message: formatSmsTemplate(params.template, {
        name: String(row.name || '').trim() || row.student_uid,
        uid: String(row.student_uid || '').trim(),
        batch: String(row.batch_name || row.current_batch || candidate.batchId || params.batchName || '').trim(),
        status: derivedStatus,
        date: candidate.date || new Date().toISOString().slice(0, 10),
        arrival_time: row.attendance_marked_at ? String(row.attendance_marked_at) : '',
        session_name: candidate.label
      }),
      attendance_status: code === null ? undefined : code,
      attendance_marked_at: row.attendance_marked_at ? String(row.attendance_marked_at) : undefined,
      arrival_time: row.attendance_marked_at ? String(row.attendance_marked_at) : undefined
    }));
  });

  return {
    recipients,
    count: recipients.length,
    skipped,
    source: 'local_session',
    emptyReason: recipients.length
      ? undefined
      : (resolvedRows.length
        ? 'No students match the selected filters.'
        : (String(candidate.batchId || params.batchName || '').trim()
          ? `No roster found for ${String(candidate.batchId || params.batchName || '').trim()}.`
          : 'Select an attendance session.'))
  };
}

function normalizeSmsPreviewStatusToken(status: unknown) {
  const token = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  return token === 'notupdated' ? 'not_updated' : token;
}

function buildSmsHistoryFallbackRows(
  batchName: string,
  historyRows: AttendanceHistoryRow[],
  cache: AppCachePayload | null | undefined
) {
  const normalizedBatchName = String(batchName || '').trim();
  const normalizedHistoryRows = Array.isArray(historyRows) ? historyRows : [];
  if (normalizedHistoryRows.length > 0) {
    return normalizedHistoryRows.slice().sort(compareAttendanceHistoryRowsForLatestFirst);
  }
  const currentCache = normalizeLocalAttendanceCache(cache);
  const existingSessionIds = new Set(
    normalizedHistoryRows
      .map((row) => Number(row?.session_id || 0))
      .filter((sessionId) => Number.isFinite(sessionId) && sessionId > 0)
  );
  const fallbackRows: AttendanceHistoryRow[] = Object.values(currentCache.sessionsByKey || {})
    .map((session) => normalizeAttendanceWorkspaceSession(session))
    .filter((session): session is AttendanceWorkspaceSession => Boolean(session))
    .filter((session) => session.status === 'closed')
    .filter((session) => {
      const sessionBatch = String(session.batch_id || '').trim();
      return !normalizedBatchName || !sessionBatch || sessionBatch === normalizedBatchName;
    })
    .map<AttendanceHistoryRow | null>((session) => {
      const sessionId = Number(session.serverSessionId || session.session_id || 0);
      if (!sessionId || existingSessionIds.has(sessionId)) {
        return null;
      }
      const display = extractSessionDisplayMetadata(session, session.batch_id || normalizedBatchName || '');
      const sessionKey = String(session.sessionKey || getServerSessionKey(sessionId) || '').trim();
      const marks = getSessionMarks(currentCache.attendanceMarksBySession, String(sessionKey || getServerSessionKey(sessionId) || '').trim(), currentCache.sessionAliasMap);
      const presentCount = Object.values(marks).filter((mark) => Number(attendanceStatusLabelToCode(mark.status)) === 1).length;
      const lateCount = Object.values(marks).filter((mark) => Number(attendanceStatusLabelToCode(mark.status)) === 2).length;
      const rosterCount = normalizedBatchName
        ? getRosterStudentUidsForBatch(normalizedBatchName, currentCache.rosterByBatch).length
          || Object.values(currentCache.studentsByUid || {}).filter((student) => batchMatches(student, normalizedBatchName)).length
        : 0;
      const totalStudents = rosterCount || (presentCount + lateCount) || 0;
      return {
        session_id: sessionId,
        batch_id: String(session.batch_id || normalizedBatchName || '').trim() || normalizedBatchName,
        date: String(session.closed_at || session.created_at || new Date().toISOString()).trim(),
        present: presentCount,
        late: lateCount,
        total: totalStudents,
        session_name: display.sessionName
      };
    })
    .filter((row): row is AttendanceHistoryRow => Boolean(row));

  return [...historyRows, ...fallbackRows].sort(compareAttendanceHistoryRowsForLatestFirst);
}

function filterSmsPreviewRecipientsByStatusSelection(
  recipients: SmsPreviewRecipient[],
  statuses: string[],
  audience: 'session' | 'batch' | 'all' | 'custom'
) {
  const normalizedRecipients = Array.isArray(recipients) ? recipients : [];
  const sortSentToBottom = (rows: SmsPreviewRecipient[]) => rows.slice().sort((left, right) => {
    const leftSent = Boolean(left.sent);
    const rightSent = Boolean(right.sent);
    if (leftSent !== rightSent) return leftSent ? 1 : -1;
    return 0;
  });
  if (audience !== 'session') {
    return sortSentToBottom(normalizedRecipients);
  }

  const activeStatuses = new Set(
    statuses
      .map((status) => normalizeSmsPreviewStatusToken(status))
      .filter(Boolean)
  );

  if (
    !activeStatuses.size
    || ['present', 'late', 'absent', 'not_updated'].every((status) => activeStatuses.has(status))
  ) {
    return sortSentToBottom(normalizedRecipients);
  }

  return sortSentToBottom(normalizedRecipients.filter((recipient) => activeStatuses.has(normalizeSmsPreviewStatusToken(recipient.status))));
}

function buildCanonicalSession(sessionKey: string, batchName: string, sessionId?: number | null, patch?: Partial<CanonicalSession>): CanonicalSession {
  const resolvedSessionKey = String(sessionKey || '').trim();
  const parsed = getSessionIdsFromKey(resolvedSessionKey);
  const resolvedBatchName = String(batchName || '').trim();
  const rawServerSessionId = Number(patch?.serverSessionId ?? sessionId ?? parsed.serverSessionId);
  const resolvedServerSessionId = Number.isFinite(rawServerSessionId) && rawServerSessionId > 0
    ? rawServerSessionId
    : null;
  const resolvedLocalSessionId = String(patch?.localSessionId || parsed.localSessionId || '').trim() || null;
  const display = extractSessionDisplayMetadata(patch || {}, resolvedBatchName);
  return {
    sessionKey: resolvedSessionKey || getLocalSessionKey(resolvedLocalSessionId) || getServerSessionKey(resolvedServerSessionId),
    serverSessionId: resolvedServerSessionId,
    localSessionId: resolvedLocalSessionId,
    batchName: display.batchName || resolvedBatchName,
    session_name: display.sessionName,
    sessionName: display.sessionName,
    column_name: display.columnName,
    columnName: display.columnName,
    title: display.title,
    displayName: display.displayName,
    name: display.name,
    status: patch?.status === 'closed' ? 'closed' : 'open',
    createdAt: String(patch?.createdAt || new Date().toISOString()),
    closedAt: patch?.closedAt ?? null,
    syncStatus: patch?.syncStatus || (resolvedServerSessionId ? 'synced' : 'pending_create'),
    lastError: patch?.lastError ?? null,
    attemptCount: Number.isFinite(Number(patch?.attemptCount)) ? Number(patch?.attemptCount) : 0,
    nextAttemptAt: patch?.nextAttemptAt ?? null,
    lastAttemptAt: patch?.lastAttemptAt ?? null,
    lateSyncStatus: patch?.lateSyncStatus || 'pending_sync',
    lateAttemptCount: Number.isFinite(Number(patch?.lateAttemptCount)) ? Number(patch?.lateAttemptCount) : 0,
    lateNextAttemptAt: patch?.lateNextAttemptAt ?? null,
    lateLastAttemptAt: patch?.lateLastAttemptAt ?? null,
    lateLastError: patch?.lateLastError ?? null,
    closeSyncStatus: patch?.closeSyncStatus || 'pending_sync',
    closeAttemptCount: Number.isFinite(Number(patch?.closeAttemptCount)) ? Number(patch?.closeAttemptCount) : 0,
    closeNextAttemptAt: patch?.closeNextAttemptAt ?? null,
    closeLastAttemptAt: patch?.closeLastAttemptAt ?? null,
    closeLastError: patch?.closeLastError ?? null
  };
}

function buildAttendanceQueueItem(mark: CanonicalAttendanceMark): SyncQueueItem {
  return {
    queueKey: mark.markKey,
    kind: 'attendance_mark',
    sessionKey: mark.sessionKey,
    markKey: mark.markKey,
    studentUid: mark.studentUid,
    status: mark.status,
    createdAt: mark.markedAt,
    updatedAt: mark.markedAt,
    syncStatus: mark.syncStatus,
    attemptCount: Number.isFinite(Number(mark.attemptCount)) ? Number(mark.attemptCount) : 0,
    nextAttemptAt: mark.nextAttemptAt ?? null,
    lastAttemptAt: mark.lastAttemptAt ?? null,
    lastError: mark.lastError ?? null
  };
}

function buildSessionQueueItem(sessionKey: string, createdAt: string, kind: SyncQueueItem['kind'] = 'session_create'): SyncQueueItem {
  return {
    queueKey: `${kind}:${sessionKey}`,
    kind,
    sessionKey,
    createdAt,
    updatedAt: createdAt,
    syncStatus: 'pending_sync',
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastError: null
  };
}

function getReplayBackoffDelayMs(attemptCount: number) {
  if (!Number.isFinite(Number(attemptCount)) || attemptCount <= 0) return 0;
  if (attemptCount === 1) return 5000;
  if (attemptCount === 2) return 15000;
  if (attemptCount === 3) return 30000;
  return 60000;
}

function getReplayBackoffDeadline(attemptCount: number, fromTime = Date.now()) {
  const delay = getReplayBackoffDelayMs(attemptCount);
  return delay > 0 ? new Date(fromTime + delay).toISOString() : null;
}

function isReplayDue(nextAttemptAt?: string | null) {
  if (!nextAttemptAt) return true;
  const parsed = Date.parse(nextAttemptAt);
  return !Number.isFinite(parsed) || parsed <= Date.now();
}

function isRetryableReplayError(error: unknown) {
  const status = extractApiStatus(error);
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (status === 0) return true;
  if (error instanceof Error) {
    return /network request failed|failed to fetch|fetch failed|networkerror|econnrefused|etimedout|timed out|timeout|enotfound|socket hang up/i.test(error.message);
  }
  return false;
}

function getReplayErrorMessage(error: unknown, fallback = 'Could not save attendance.') {
  if (error instanceof Error && String(error.message || '').trim()) return error.message;
  return fallback;
}

function createLocalSessionId() {
  return `ls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function filterResourceCacheForRole(
  resourceCache: Record<string, CachedResourceEntry<unknown>> | undefined,
  role: WorkspaceRole | null
) {
  if (!resourceCache) return resourceCache;
  const next: Record<string, CachedResourceEntry<unknown>> = {};
  const allowed = (key: string) => {
    if (key === 'staff_students') return false;
    if (key === 'public_batches') return true;
    if (!role) return true;
    if (role === 'student') {
      return key.startsWith('student_');
    }
    return (
      key.startsWith('staff_') ||
      key.startsWith('batch_') ||
      key.startsWith('roster:') ||
      key.startsWith('sms_') ||
      key.startsWith('test_') ||
      key.startsWith('lead_') ||
      key.startsWith('doubt_') ||
      key.startsWith('attendance_alerts') ||
      key.startsWith('batch_report:') ||
      key.startsWith('admin_')
    );
  };
  Object.entries(resourceCache).forEach(([key, value]) => {
    if (allowed(key)) next[key] = value;
  });
  return next;
}

function sanitizeAppCacheForRole(cache: AppCachePayload, role: WorkspaceRole | null): AppCachePayload {
  const next: AppCachePayload = {
    ...cache,
    workspaceRole: role
  };
  delete next.students;
  if (role === 'student') {
    delete next.batches;
    delete next.materials;
    delete next.notices;
    delete next.leads;
    delete next.systemStats;
    delete next.testPapers;
    delete next.testLaunches;
    delete next.testSubmissions;
    delete next.currentSession;
    delete next.attendanceQueue;
    delete next.studentsByUid;
    delete next.rosterByBatch;
    delete next.sessionsByKey;
    delete next.attendanceMarksBySession;
    delete next.smsBatchHistoryByBatch;
    delete next.syncQueue;
    delete next.sessionAliasMap;
    next.resourceCache = filterResourceCacheForRole(next.resourceCache, role);
  } else if (role === 'staff') {
    delete next.studentMaterials;
    delete next.studentNotices;
    delete next.studentNotifications;
    delete next.downloadedMaterials;
  }
  next.resourceCache = filterResourceCacheForRole(next.resourceCache, role);
  return next;
}

function inferWorkspaceRoleFromCache(cache: AppCachePayload): WorkspaceRole | null {
  if (cache.workspaceRole) return cache.workspaceRole;
  if (cache.session) return cache.session.type;
  if (cache.currentSession) return 'staff';
  if (
    Array.isArray(cache.studentMaterials) ||
    Array.isArray(cache.studentNotices) ||
    Array.isArray(cache.studentNotifications)
  ) {
    return 'student';
  }
  return null;
}

function getQueuedAttendanceSessionKey(queue: OfflineAttendanceAction[] | undefined) {
  if (!Array.isArray(queue) || !queue.length) return '';
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const item = queue[i];
    if (item.type === 'start_session') return item.session_key;
    if (item.session_key) return item.session_key;
  }
  return '';
}

function getQueuedSyncSessionKey(queue: SyncQueueItem[] | undefined) {
  if (!Array.isArray(queue) || !queue.length) return '';
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const item = queue[i];
    const sessionKey = String(item?.sessionKey || '').trim();
    if (sessionKey) return sessionKey;
  }
  return '';
}

async function readAppCache(): Promise<AppCachePayload> {
  const local = await readLocalJson<AppCachePayload>(APP_CACHE_KEY);
  if (local && typeof local === 'object') return normalizeLocalAttendanceCache(local);
  try {
    const info = await FileSystem.getInfoAsync(APP_CACHE_FILE);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(APP_CACHE_FILE);
    const parsed = JSON.parse(raw) as AppCachePayload;
    void writeLocalJson(APP_CACHE_KEY, parsed).catch(() => null);
    return normalizeLocalAttendanceCache(parsed);
  } catch {
    return {};
  }
}

function getSmsSessionRosterCacheKey(batchName: string, sessionId: number | string | null | undefined) {
  const normalizedBatchName = String(batchName || '').trim();
  const normalizedSessionId = Number(sessionId || 0);
  if (!normalizedBatchName || !normalizedSessionId) {
    return '';
  }
  return `session_roster_summary:${normalizedBatchName}:${normalizedSessionId}`;
}

function compareAttendanceHistoryRowsForLatestFirst(left: AttendanceHistoryRow, right: AttendanceHistoryRow) {
  const leftSessionId = Number(left?.session_id || 0);
  const rightSessionId = Number(right?.session_id || 0);
  if (leftSessionId !== rightSessionId) {
    return rightSessionId - leftSessionId;
  }
  const leftDate = String(left?.date || '').trim();
  const rightDate = String(right?.date || '').trim();
  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }
  return String(right?.session_name || '').localeCompare(String(left?.session_name || ''));
}

async function writeAppCache(payload: AppCachePayload) {
  const normalized = normalizeLocalAttendanceCache(payload);
  await ensureDirectoryExists(MATERIAL_CACHE_ROOT);
  await FileSystem.writeAsStringAsync(APP_CACHE_FILE, JSON.stringify(normalized, null, 2));
  await writeLocalJson(APP_CACHE_KEY, normalized).catch(() => null);
}

function clearAttendanceSessionCacheFields(cache: AppCachePayload | null | undefined): AppCachePayload {
  const current = normalizeLocalAttendanceCache(cache);
  return normalizeLocalAttendanceCache({
    ...current,
    currentSession: null,
    attendanceQueue: [],
    attendanceMarksBySession: {},
    sessionsByKey: {},
    syncQueue: [],
    sessionAliasMap: {},
    ui: {
      attendanceBatch: '',
      studentBatchFilter: String(current.ui?.studentBatchFilter || ''),
      reportBatch: String(current.ui?.reportBatch || 'ALL'),
      doubtBatchFilter: String(current.ui?.doubtBatchFilter || ''),
      testBatch: String(current.ui?.testBatch || ''),
      smsBatch: String(current.ui?.smsBatch || ''),
      selectedLaunchId: String(current.ui?.selectedLaunchId || ''),
      selectedPaperId: String(current.ui?.selectedPaperId || ''),
      selectedAbsenteeSessionId: String(current.ui?.selectedAbsenteeSessionId || ''),
      selectedScoreboardLaunchId: String(current.ui?.selectedScoreboardLaunchId || ''),
      studentTab: current.ui?.studentTab || 'overview',
      staffTab: current.ui?.staffTab || 'home',
      staffNotificationSection: current.ui?.staffNotificationSection || 'notices'
    },
    updatedAt: new Date().toISOString()
  });
}

type StudentDirectoryCache = {
  savedAt: number;
  students: CachedStudentRow[];
};

type StaffCoreCache = {
  savedAt: number;
  batches: Batch[];
  currentSession: AttendanceWorkspaceSession | null;
};

type StaffCoreSnapshotOptions = {
  preferOpenSession?: boolean;
};

type AttendanceSessionResolution = {
  currentSession: AttendanceWorkspaceSession | null;
  attendanceBatch: string;
  attendanceSessionName: string;
  offlineAttendanceSessionKey: string;
  activeSessionKey: string;
  activeSource: 'open_local' | 'preferred' | 'server_current' | 'none';
};

async function readStudentDirectoryCache(): Promise<StudentDirectoryCache | null> {
  const local = await readLocalJson<StudentDirectoryCache>(STUDENT_DIRECTORY_CACHE_KEY);
  if (local && Array.isArray(local.students)) {
    return {
      savedAt: Number(local.savedAt || 0),
      students: local.students
    };
  }
  try {
    const info = await FileSystem.getInfoAsync(STUDENT_DIRECTORY_CACHE_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(STUDENT_DIRECTORY_CACHE_FILE);
    const parsed = JSON.parse(raw) as StudentDirectoryCache;
    if (!parsed || !Array.isArray(parsed.students)) return null;
    void writeLocalJson(STUDENT_DIRECTORY_CACHE_KEY, parsed).catch(() => null);
    return {
      savedAt: Number(parsed.savedAt || 0),
      students: parsed.students
    };
  } catch {
    return null;
  }
}

async function writeStudentDirectoryCache(payload: StudentDirectoryCache) {
  await ensureDirectoryExists(MATERIAL_CACHE_ROOT);
  await FileSystem.writeAsStringAsync(STUDENT_DIRECTORY_CACHE_FILE, JSON.stringify(payload, null, 2));
  await writeLocalJson(STUDENT_DIRECTORY_CACHE_KEY, payload).catch(() => null);
}

const STAFF_CORE_CACHE_FILE = `${MATERIAL_CACHE_ROOT}/staff_core.json`;

async function readStaffCoreCache(): Promise<StaffCoreCache | null> {
  const local = await readLocalJson<StaffCoreCache>(STAFF_CORE_CACHE_KEY);
  if (local && Array.isArray(local.batches)) {
    return {
      savedAt: Number(local.savedAt || 0),
      batches: local.batches,
      currentSession: local.currentSession && typeof local.currentSession === 'object' ? local.currentSession : null
    };
  }
  try {
    const info = await FileSystem.getInfoAsync(STAFF_CORE_CACHE_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(STAFF_CORE_CACHE_FILE);
    const parsed = JSON.parse(raw) as StaffCoreCache;
    if (!parsed || !Array.isArray(parsed.batches)) return null;
    void writeLocalJson(STAFF_CORE_CACHE_KEY, parsed).catch(() => null);
    return {
      savedAt: Number(parsed.savedAt || 0),
      batches: parsed.batches,
      currentSession: parsed.currentSession && typeof parsed.currentSession === 'object' ? parsed.currentSession : null
    };
  } catch {
    return null;
  }
}

async function writeStaffCoreCache(payload: StaffCoreCache) {
  await ensureDirectoryExists(MATERIAL_CACHE_ROOT);
  await FileSystem.writeAsStringAsync(STAFF_CORE_CACHE_FILE, JSON.stringify(payload, null, 2));
  await writeLocalJson(STAFF_CORE_CACHE_KEY, payload).catch(() => null);
}

async function ensureFreshAttendanceSessionCache(
  cache: AppCachePayload | null | undefined,
  staffCore: StaffCoreCache | null | undefined
) {
  const currentMarker = String(await SecureStore.getItemAsync(ATTENDANCE_SESSION_RESET_MARKER_KEY).catch(() => '') || '').trim();
  if (currentMarker === ATTENDANCE_SESSION_RESET_BUILD_ID) {
    return {
      cache: normalizeLocalAttendanceCache(cache),
      staffCore: staffCore && typeof staffCore === 'object' ? staffCore : null,
      didReset: false
    };
  }

  const nextCache = clearAttendanceSessionCacheFields(cache);
  const nextStaffCore: StaffCoreCache | null = staffCore && typeof staffCore === 'object'
    ? {
      ...staffCore,
      currentSession: null
    }
    : null;

  await Promise.all([
    writeAppCache(nextCache),
    nextStaffCore ? writeStaffCoreCache(nextStaffCore) : Promise.resolve(),
    SecureStore.setItemAsync(ATTENDANCE_SESSION_RESET_MARKER_KEY, ATTENDANCE_SESSION_RESET_BUILD_ID)
  ]);

  return {
    cache: nextCache,
    staffCore: nextStaffCore,
    didReset: true
  };
}

function extractArrayPayload<T>(payload: any, keys: string[] = []) {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate as T[];
  }
  return [];
}

function snapshotStudent(student: StudentRow): CachedStudentRow {
  return {
    id: student.id,
    name: student.name,
    student_uid: student.student_uid,
    secure_token: student.secure_token || null,
    phone: student.phone || '',
    father_name: student.father_name || '',
    guardian_phone: student.guardian_phone || '',
    father_phone: student.father_phone || '',
    parent_phone: student.parent_phone || '',
    address: student.address || '',
    student_class: student.student_class,
    current_batch: student.current_batch,
    batch_name: student.batch_name,
    batches: student.batches,
    system_batches: student.system_batches,
    primary_system_batch: student.primary_system_batch,
    aspiration: student.aspiration || '',
    photo: student.photo || student.photo_path || null,
    photo_path: student.photo_path || null,
    qr_path: student.qr_path || null,
    fbc_no: student.fbc_no || '',
    attendance_percent: student.attendance_percent,
    status: student.status,
    created_at: student.created_at
  };
}

function restoreStudent(student: CachedStudentRow): StudentRow {
  return {
    id: student.id,
    name: student.name,
    student_uid: student.student_uid,
    secure_token: student.secure_token || null,
    phone: student.phone || '',
    father_name: student.father_name || '',
    guardian_phone: student.guardian_phone || '',
    father_phone: student.father_phone || '',
    parent_phone: student.parent_phone || '',
    address: student.address || '',
    student_class: student.student_class || '',
    current_batch: student.current_batch || '',
    batch_name: student.batch_name,
    batches: student.batches,
    system_batches: student.system_batches,
    primary_system_batch: student.primary_system_batch,
    aspiration: student.aspiration || '',
    photo: student.photo || student.photo_path || null,
    photo_path: student.photo_path || null,
    qr_path: student.qr_path || null,
    fbc_no: student.fbc_no || '',
    attendance_percent: student.attendance_percent,
    status: student.status,
    created_at: student.created_at
  };
}

function studentRowToProfile(student: Partial<StudentProfile> & { id: number; name?: string; student_uid?: string }): StudentProfile {
  return {
    id: student.id,
    name: student.name || '',
    student_uid: student.student_uid || '',
    secure_token: student.secure_token || null,
    phone: student.phone || '',
    father_name: student.father_name || '',
    guardian_phone: student.guardian_phone || '',
    father_phone: student.father_phone || '',
    parent_phone: student.parent_phone || '',
    address: student.address || '',
    student_class: student.student_class || '',
    current_batch: student.current_batch || '',
    batch_name: student.batch_name || '',
    batches: student.batches,
    system_batches: student.system_batches,
    primary_system_batch: student.primary_system_batch,
    aspiration: student.aspiration || '',
    photo: student.photo || student.photo_path || null,
    photo_path: student.photo_path || student.photo || null,
    qr_path: student.qr_path || null,
    fbc_no: student.fbc_no || '',
    attendance_percent: student.attendance_percent,
    status: student.status || 'active'
  };
}

function compactStudentDirectoryRows(rows: Array<CachedStudentRow | StudentRow> | null | undefined): CachedStudentRow[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((student) => ({
    id: Number(student.id || 0),
    name: String(student.name || ''),
    student_uid: String(student.student_uid || ''),
    secure_token: student.secure_token || null,
    phone: String(student.phone || ''),
    father_name: String(student.father_name || ''),
    guardian_phone: String(student.guardian_phone || ''),
    father_phone: String((student as StudentRow).father_phone || ''),
    parent_phone: String((student as StudentRow).parent_phone || ''),
    address: String(student.address || ''),
    student_class: String(student.student_class || ''),
    current_batch: String(student.current_batch || ''),
    batch_name: student.batch_name || '',
    batches: student.batches,
    system_batches: student.system_batches,
    primary_system_batch: student.primary_system_batch,
    aspiration: String(student.aspiration || ''),
    attendance_percent: Number(student.attendance_percent || 0) || 0,
    status: String(student.status || 'active'),
    photo: student.photo || student.photo_path || null,
    photo_path: student.photo_path || student.photo || null,
    qr_path: student.qr_path || null,
    fbc_no: student.fbc_no || '',
    attendance_status: Number(student.attendance_status || 0) || 0,
    attendance_marked_offline: Boolean((student as StudentRow).attendance_marked_offline),
    attendance_marked_at: (student as StudentRow).attendance_marked_at,
    created_at: student.created_at
  }));
}

function mergeStudentDirectoryRows(baseRows: CachedStudentRow[], extraRows: CachedStudentRow[]) {
  const baseByUid = buildStudentsByUid(baseRows);
  const mergedByUid = buildStudentsByUid(extraRows, baseByUid);
  const ordered: CachedStudentRow[] = baseRows.map((student) => mergedByUid[student.student_uid] || student);
  const seen = new Set(baseRows.map((student) => String(student.student_uid || '').trim()).filter(Boolean));
  extraRows.forEach((student) => {
    const uid = String(student.student_uid || '').trim();
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    ordered.push(mergedByUid[uid] || student);
  });
  return compactStudentDirectoryRows(ordered);
}

function hasMissingGuardianPhones(rows: Array<CachedStudentRow | StudentRow> | null | undefined) {
  return Array.isArray(rows) && rows.some((student) => !String(student?.guardian_phone || '').trim());
}

function getStaffLoginSecretKey(deviceId: string, username: string) {
  const safeDeviceId = sanitizeSecureStoreKeyPart(deviceId, 'device');
  const safeUsername = sanitizeSecureStoreKeyPart(String(username || '').trim().toLowerCase(), 'user');
  return `${STAFF_LOGIN_SECRET_PREFIX}${safeDeviceId}0${safeUsername}`;
}

async function persistStaffLoginSecret(deviceId: string, username: string, password: string) {
  const key = getStaffLoginSecretKey(deviceId, username);
  await SecureStore.setItemAsync(key, password);
}

async function readStaffLoginSecret(deviceId: string, username: string) {
  const key = getStaffLoginSecretKey(deviceId, username);
  return SecureStore.getItemAsync(key);
}

/**
 * Examination backend URL override.
 *
 * Set this to point the exam tab at a specific exam backend, INDEPENDENT of the
 * RMC server URL. Use this when RMC is served from the VPS/domain but the exam
 * backend runs on your local PC for testing.
 *
 *   Local exam server (this PC on the LAN):  'http://192.168.1.2:4200'
 *   Production (Cloudflare subdomain → VPS):  'https://exam.riteshmathematics.in'
 *
 * Production uses a dedicated subdomain routed through the Cloudflare tunnel to the
 * exam backend (localhost:4200 on the VPS). HTTPS/WSS are served on 443 — no :4200
 * in the public URL. Set to 'http://<lan-ip>:4200' for local LAN testing.
 * Leave empty ('') to derive <rmc-host>:4200 (LAN-style only — won't work via the tunnel).
 */
const EXAM_SERVER_URL_OVERRIDE: string = 'https://exam.riteshmathematics.in';

/**
 * Derive the examination backend root URL from the RMC server URL.
 * The exam backend runs as a separate service on port 4200 on the same host.
 */
function deriveExamServerUrl(rmcBaseUrl: string): string {
  if (EXAM_SERVER_URL_OVERRIDE) return EXAM_SERVER_URL_OVERRIDE.replace(/\/+$/, '');
  try {
    const clean = String(rmcBaseUrl || '').replace(/\/+$/, '');
    const m = clean.match(/^(https?:\/\/)([^/:]+)(?::\d+)?/i);
    if (!m) return clean || LOCALHOST_SERVER_URL;
    return `${m[1]}${m[2]}:4200`;
  } catch {
    return LOCALHOST_SERVER_URL;
  }
}

/**
 * Full-screen host for the embedded examination module. Resolves exam-backend
 * credentials for the active RMC user (staff password / student uid) and hands
 * them to ExamEntry, which performs the bridge login and renders the exam UI.
 */
function ExamSectionHost({
  role,
  baseUrl,
  session,
  onExit,
}: {
  role: 'student' | 'teacher';
  baseUrl: string;
  session: SessionInfo;
  onExit: () => void;
}) {
  const [creds, setCreds] = useState<ExamCredentials | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const deviceId = await getOrCreateDeviceId();
        if (session?.type === 'staff') {
          const username = session.user.username;
          const password = await readStaffLoginSecret(deviceId, username).catch(() => null);
          if (!cancelled) {
            // Dev-login fallback creds are stripped from production builds (__DEV__ is
            // false in release). Never ship hardcoded credentials in the APK/AAB.
            setCreds({
              kind: 'staff', username, password,
              ...(__DEV__ ? { devUsername: 'teacher1', devPassword: 'password123' } : {}),
            });
          }
        } else if (session?.type === 'student') {
          const uid = String(session.student.student_uid || '').trim();
          if (!cancelled) {
            setCreds({
              kind: 'student', uid,
              ...(__DEV__ ? { devUsername: 'student1', devPassword: 'password123' } : {}),
            });
          }
        } else if (!cancelled) {
          setInitError('No active session. Please log in again.');
        }
      } catch (e: any) {
        if (!cancelled) setInitError(e?.message || 'Unable to prepare examination access.');
      }
    })();
    return () => { cancelled = true; };
  }, [session, role]);

  const examServerUrl = useMemo(() => deriveExamServerUrl(baseUrl), [baseUrl]);

  if (initError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7F5', padding: 28 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#10221A', marginBottom: 8 }}>Examination Unavailable</Text>
        <Text style={{ fontSize: 14, color: '#5C6B61', textAlign: 'center', lineHeight: 21, marginBottom: 22 }}>{initError}</Text>
        <Pressable onPress={onExit} style={{ backgroundColor: '#0D4E35', paddingHorizontal: 28, paddingVertical: 13, borderRadius: 100 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!creds) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7F5' }}>
        <ActivityIndicator size="large" color="#0D4E35" />
      </View>
    );
  }

  return <ExamEntry role={role} examServerUrl={examServerUrl} credentials={creds} onExit={onExit} />;
}

function snapshotSession(sessionValue: SessionInfo): StoredSessionSnapshot | null {
  if (!sessionValue) return null;
  if (sessionValue.type === 'student') {
    const student = sessionValue.student;
    return {
      type: 'student',
      student: {
        id: student.id,
        name: student.name,
        student_uid: student.student_uid,
        secure_token: student.secure_token || null,
        phone: student.phone || '',
        father_name: student.father_name || '',
        guardian_phone: student.guardian_phone || '',
        address: student.address || '',
        student_class: student.student_class,
        current_batch: student.current_batch,
        batch_name: student.batch_name,
        batches: student.batches,
        system_batches: student.system_batches,
        primary_system_batch: student.primary_system_batch,
        aspiration: student.aspiration || '',
        photo: student.photo || student.photo_path || null,
        photo_path: student.photo_path || null,
        qr_path: student.qr_path || null,
        fbc_no: student.fbc_no || '',
        attendance_percent: student.attendance_percent,
        status: student.status
      }
    };
  }
  return {
    type: 'staff',
    user: {
      id: sessionValue.user.id,
      username: sessionValue.user.username,
      full_name: sessionValue.user.full_name,
      role: sessionValue.user.role
    }
  };
}

function restoreSession(snapshot: StoredSessionSnapshot | null | undefined): SessionInfo {
  if (!snapshot) return null;
  if (snapshot.type === 'student') {
    return {
      type: 'student',
      student: {
        id: snapshot.student.id,
        name: snapshot.student.name,
        student_uid: snapshot.student.student_uid,
        secure_token: snapshot.student.secure_token || null,
        phone: snapshot.student.phone || '',
        father_name: snapshot.student.father_name || '',
        guardian_phone: snapshot.student.guardian_phone || '',
        address: snapshot.student.address || '',
        student_class: snapshot.student.student_class,
        current_batch: snapshot.student.current_batch,
        batch_name: snapshot.student.batch_name,
        batches: snapshot.student.batches,
        system_batches: snapshot.student.system_batches,
        primary_system_batch: snapshot.student.primary_system_batch,
        aspiration: snapshot.student.aspiration || '',
        photo: snapshot.student.photo || snapshot.student.photo_path || null,
        photo_path: snapshot.student.photo_path || null,
        qr_path: snapshot.student.qr_path || null,
        fbc_no: snapshot.student.fbc_no || '',
        attendance_percent: snapshot.student.attendance_percent,
        status: snapshot.student.status
      }
    };
  }
  return {
    type: 'staff',
    user: snapshot.user
  };
}

function getStudentBatchList(student: Pick<StudentProfile, 'system_batches' | 'batches' | 'batch_name' | 'current_batch' | 'primary_system_batch'>) {
  const systemBatches = splitBatchNames(student.system_batches);
  if (systemBatches.length) return systemBatches;
  const legacyBatches = splitBatchNames(student.batches);
  if (legacyBatches.length) return legacyBatches;
  const primaryBatch = splitBatchNames(student.primary_system_batch);
  if (primaryBatch.length) return primaryBatch;
  return splitBatchNames(student.batch_name || student.current_batch);
}

function batchMatches(student: StudentRow, batchName: string) {
  const target = normalizeBatchIdentity(batchName);
  if (!target) return false;
  return getStudentBatchList(student).some((entry) => normalizeBatchIdentity(entry) === target);
}

function SectionCard(props: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{props.title}</Text>
          {props.subtitle ? <Text style={styles.sectionSubtitle}>{props.subtitle}</Text> : null}
        </View>
        {props.right}
      </View>
      {props.children}
    </View>
  );
}

type StudentCompactRowProps = {
  student: StudentRow;
  onPress: (student: StudentRow) => void;
};

const StudentCompactRow = React.memo(function StudentCompactRow({ student, onPress }: StudentCompactRowProps) {
  const batchLabel = getStudentBatchList(student).join(', ') || student.current_batch || student.batch_name || '-';
  const initials = (student.name || 'S')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'S';
  const attendanceState = student.attendance_state
    || (student.attendance_status === 2 ? 'late' : student.attendance_status === 1 ? 'present' : student.attendance_status === 0 ? 'absent' : '');
  const attendanceStateLabel = attendanceState === 'late'
    ? 'Late'
    : attendanceState === 'present'
      ? 'Present'
      : attendanceState === 'absent'
        ? 'Absent'
        : attendanceState === 'not_marked'
          ? 'Not Marked'
          : '';
  const attendanceStateStyle = attendanceState === 'late'
    ? styles.attendanceStateLate
    : attendanceState === 'present'
      ? styles.attendanceStatePresent
      : attendanceState === 'absent'
        ? styles.attendanceStateAbsent
        : styles.attendanceStatePending;

  return (
    <Pressable style={styles.studentListRow} onPress={() => onPress(student)}>
      <View style={styles.studentListAvatar}>
        <Text style={styles.studentListAvatarText}>{initials}</Text>
      </View>
      <View style={styles.studentListBody}>
        <Text style={styles.studentListName} numberOfLines={1}>{student.name}</Text>
        <Text style={styles.studentListUid} numberOfLines={1}>{student.student_uid}</Text>
      </View>
      <View style={styles.studentListRight}>
        <View style={styles.studentListBatchPill}>
          <Text style={styles.studentListBatchText} numberOfLines={1}>{batchLabel}</Text>
        </View>
        <Text style={styles.studentListPhone} numberOfLines={1}>{student.phone || 'No phone'}</Text>
        {attendanceStateLabel ? (
          <View style={[styles.attendanceStatePill, attendanceStateStyle]}>
            <Text style={styles.attendanceStateText}>{attendanceStateLabel}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

function PrimaryButton(props: { title: string; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'secondary' | 'danger' | 'success' }) {
  const isSecondary = props.tone === 'secondary';
  const toneStyle = isSecondary ? styles.buttonSecondary : props.tone === 'danger' ? styles.buttonDanger : props.tone === 'success' ? styles.buttonSuccess : styles.buttonPrimary;
  return (
    <Pressable disabled={props.disabled} onPress={props.onPress} style={[styles.button, toneStyle, props.disabled && styles.buttonDisabled]}>
      <Text style={[styles.buttonText, isSecondary && styles.buttonTextSecondary]}>{props.title}</Text>
    </Pressable>
  );
}

function LabeledInput(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'words' | 'characters' | 'sentences'; keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'url'; maxLength?: number; editable?: boolean; }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#60738c"
        secureTextEntry={props.secureTextEntry}
        autoCapitalize={props.autoCapitalize}
        keyboardType={props.keyboardType}
        multiline={props.multiline}
        maxLength={props.maxLength}
        editable={props.editable}
        style={[styles.input, props.multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function PillTabs(props: { items: Array<{ key: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, paddingHorizontal: 20 }} contentContainerStyle={{ gap: 8, paddingRight: 40, paddingVertical: 10 }}>
      {props.items.map((item) => (
        <Pressable 
          key={item.key} 
          onPress={() => props.onChange(item.key)} 
          style={{ 
            paddingHorizontal: 16, 
            paddingVertical: 10, 
            borderRadius: 12, 
            backgroundColor: props.value === item.key ? '#0D4E35' : '#FFFFFF',
            shadowColor: '#0c4e36',
            shadowOpacity: props.value === item.key ? 0.2 : 0.05,
            shadowOffset: { width: 0, height: 2 },
            shadowRadius: 4,
            elevation: 2,
            borderWidth: props.value === item.key ? 0 : 1,
            borderColor: '#E4EBE5'
          }}
        >
          <Text numberOfLines={1} style={{ 
            color: props.value === item.key ? '#FFFFFF' : '#6B7280', 
            fontSize: 13, 
            fontWeight: '900',
            letterSpacing: 0.5
          }}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function DropdownSelect(props: {
  label: string;
  placeholder: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>{props.label}</Text>
      <Pressable style={styles.dropdownTrigger} onPress={() => setOpen(true)}>
        <Text style={[styles.dropdownTriggerText, !props.value && styles.dropdownTriggerPlaceholder]} numberOfLines={1}>
          {props.value || props.placeholder}
        </Text>
        <Text style={styles.dropdownChevron}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownSheet} onPress={() => null}>
            <Text style={styles.dropdownSheetTitle}>{props.label}</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.dropdownOptions}>
              {props.options.map((option) => {
                const selected = props.value === option;
                return (
                  <Pressable
                    key={option}
                    style={[styles.dropdownOption, selected && styles.dropdownOptionSelected]}
                    onPress={() => {
                      props.onChange(option);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownOptionText, selected && styles.dropdownOptionTextSelected]}>{option}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function MultiSelectDropdown(props: {
  label: string;
  placeholder: string;
  value: string[];
  options: Array<{ key: string; label: string }>;
  helperText?: string;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedCount = props.value.length;
  const selectedLabels = props.options
    .filter((option) => props.value.includes(option.key))
    .map((option) => option.label);
  const summaryText = selectedLabels.length
    ? (selectedLabels.length <= 2 ? selectedLabels.join(', ') : `${selectedLabels.length} batches selected`)
    : props.placeholder;

  const toggleOption = useCallback((optionKey: string) => {
    const next = new Set(props.value);
    if (next.has(optionKey)) {
      next.delete(optionKey);
    } else {
      next.add(optionKey);
    }
    const ordered = props.options.map((option) => option.key).filter((key) => next.has(key));
    const remainder = Array.from(next).filter((key) => !ordered.includes(key));
    props.onChange([...ordered, ...remainder]);
  }, [props.onChange, props.options, props.value]);

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>{props.label}</Text>
      <Pressable style={styles.dropdownTrigger} onPress={() => setOpen(true)}>
        <Text style={[styles.dropdownTriggerText, !selectedCount && styles.dropdownTriggerPlaceholder]} numberOfLines={1}>
          {summaryText}
        </Text>
        <Text style={styles.dropdownChevron}>{selectedCount ? String(selectedCount) : '▾'}</Text>
      </Pressable>
      {props.helperText ? <Text style={styles.helperText}>{props.helperText}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownSheet} onPress={() => null}>
            <Text style={styles.dropdownSheetTitle}>{props.label}</Text>
            <Text style={styles.helperText}>{props.placeholder}</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.dropdownOptions}>
              {props.options.length ? props.options.map((option) => {
                const selected = props.value.includes(option.key);
                return (
                  <Pressable
                    key={option.key}
                    style={[styles.dropdownOption, styles.dropdownMultiOption, selected && styles.dropdownOptionSelected]}
                    onPress={() => toggleOption(option.key)}
                  >
                    <Text style={[styles.dropdownCheckbox, selected && styles.dropdownCheckboxSelected]}>
                      {selected ? '☑' : '☐'}
                    </Text>
                    <Text numberOfLines={1} style={[styles.dropdownOptionText, selected && styles.dropdownOptionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              }) : <Text style={styles.emptyBody}>No active batches are available yet.</Text>}
            </ScrollView>
            <View style={styles.dropdownFooter}>
              <PrimaryButton title="Done" onPress={() => setOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ScannerModal(props: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  onScan: (value: string) => Promise<void> | void;
  preview?: React.ReactNode;
  previewActionLabel?: string;
  onPreviewAction?: () => void;
  scanMode?: 'continuous' | 'manual-window';
  scanWindowMs?: number;
  scanThrottleMs?: number;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [scanActive, setScanActive] = useState(false);
  const scanWindowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanActiveRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const manualWindowMs = Number(props.scanWindowMs || 2000) > 0 ? Number(props.scanWindowMs || 2000) : 2000;
  const scanThrottleMs = Number(props.scanThrottleMs || 2000) > 0 ? Number(props.scanThrottleMs || 2000) : 2000;
  const manualWindowMode = props.scanMode === 'manual-window';

  const clearScanWindow = useCallback(() => {
    if (scanWindowTimeoutRef.current) {
      clearTimeout(scanWindowTimeoutRef.current);
      scanWindowTimeoutRef.current = null;
    }
    scanActiveRef.current = false;
    setScanActive(false);
  }, []);

  const startScanWindow = useCallback(() => {
    if (!manualWindowMode || scanActiveRef.current) return;
    if (scanWindowTimeoutRef.current) {
      clearTimeout(scanWindowTimeoutRef.current);
      scanWindowTimeoutRef.current = null;
    }
    scanActiveRef.current = true;
    setScanActive(true);
    scanWindowTimeoutRef.current = setTimeout(() => {
      scanWindowTimeoutRef.current = null;
      scanActiveRef.current = false;
      setScanActive(false);
    }, manualWindowMs);
  }, [manualWindowMode, manualWindowMs]);

  useEffect(() => {
    if (props.visible && !permission?.granted) {
      requestPermission().catch(() => null);
    }
  }, [permission?.granted, props.visible, requestPermission]);

  useEffect(() => {
    if (!props.visible) {
      clearScanWindow();
      setLocked(false);
      lastScannedRef.current = { value: '', at: 0 };
      return;
    }
    if (manualWindowMode) {
      clearScanWindow();
      lastScannedRef.current = { value: '', at: 0 };
    }
  }, [clearScanWindow, manualWindowMode, props.visible]);

  const handleScan = useCallback(async (result: BarcodeScanningResult) => {
    const value = String(result?.data || '').trim();
    if (!value) return;
    if (manualWindowMode) {
      if (!scanActiveRef.current) return;
      const now = Date.now();
      const previous = lastScannedRef.current;
      if (previous.value === value && now - previous.at < scanThrottleMs) {
        return;
      }
      lastScannedRef.current = { value, at: now };
      clearScanWindow();
      await props.onScan(value);
      return;
    }
    if (locked) return;
    setLocked(true);
    try {
      await props.onScan(value);
    } finally {
      setTimeout(() => setLocked(false), 1200);
    }
  }, [clearScanWindow, locked, manualWindowMode, props, scanThrottleMs]);

  if (!props.visible) return null;

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={styles.modalRoot}>
        <View style={styles.modalTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>{props.title}</Text>
            <Text style={styles.modalSubtitle}>{props.subtitle}</Text>
          </View>
          <PrimaryButton title="Close" onPress={props.onClose} tone="secondary" />
        </View>
        {props.preview ? (
          <View style={styles.scannerPreviewLayout}>
            {permission?.granted ? (
              <View style={[styles.cameraShell, styles.scannerPreviewCameraShell]}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={undefined}
                />
                <View style={styles.cameraOverlay}>
                  <View style={styles.cameraFrame} />
                  <Text style={styles.cameraText}>Hold the QR inside the square</Text>
                </View>
              </View>
            ) : (
              <View style={styles.emptyPanel}>
                <Text style={styles.emptyTitle}>Camera permission needed</Text>
                <Text style={styles.emptyBody}>Allow access so the app can scan student and staff QR cards.</Text>
                <PrimaryButton title="Allow Camera" onPress={() => requestPermission()} />
              </View>
            )}
            <ScrollView style={styles.scannerPreviewSheet} contentContainerStyle={styles.scannerPreviewSheetContent}>
              {props.preview}
              <View style={styles.buttonRow}>
                <PrimaryButton title={props.previewActionLabel || 'Scan Next'} onPress={props.onPreviewAction || props.onClose} />
              </View>
            </ScrollView>
          </View>
        ) : !permission?.granted ? (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Camera permission needed</Text>
            <Text style={styles.emptyBody}>Allow access so the app can scan student and staff QR cards.</Text>
            <PrimaryButton title="Allow Camera" onPress={() => requestPermission()} />
          </View>
        ) : (
          <View style={styles.cameraShell}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={manualWindowMode ? (scanActive ? handleScan : undefined) : (locked ? undefined : handleScan)}
            />
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraFrame} />
              <Text style={styles.cameraText}>Hold the QR inside the square</Text>
            </View>
            {manualWindowMode ? (
              <View style={styles.scannerManualActionWrap}>
                <PrimaryButton
                  title={scanActive ? 'Scanning...' : 'Scan Now'}
                  onPress={startScanWindow}
                  disabled={scanActive}
                />
              </View>
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function DetailModal(props: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={styles.modalRoot}>
        <View style={styles.modalTop}>
          <Text style={styles.modalTitle}>{props.title}</Text>
          <PrimaryButton title="Close" onPress={props.onClose} tone="secondary" />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.modalContent}>{props.children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

type AppErrorBoundaryState = {
  errorMessage: string | null;
};

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    errorMessage: null
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      errorMessage: error?.message || 'Unknown render error'
    };
  }

  componentDidCatch(error: Error) {
    console.error('RMC Mobile render error:', error);
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <SafeAreaView style={styles.root}>
          <View style={styles.bootShell}>
            <Text style={styles.modalTitle}>App crashed while rendering</Text>
            <Text style={styles.emptyBody}>{this.state.errorMessage}</Text>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}


const IdCardFront = ({ student, baseUrl }: { student: StudentProfile, baseUrl: string }) => {
  const photoSource = student.photo_path || student.photo || '';
  const photoUri = /^file:\/\//i.test(photoSource)
    ? photoSource
    : photoSource
      ? makeAbsoluteUrl(baseUrl, photoSource)
      : '';
  const qrSource = student.qr_path || (student.student_uid ? `/qrcodes/qr_${encodeURIComponent(student.student_uid)}.png` : '');
  const qrUri = /^file:\/\//i.test(qrSource)
    ? qrSource
    : qrSource
      ? makeAbsoluteUrl(baseUrl, qrSource)
      : '';

  return (
    <View style={styles.idCardPro}>
      <Image source={RMC_LOGO} style={styles.idCardWatermark} resizeMode="contain" />
      <View style={styles.idTopBar}>
        <View style={styles.idLogoArea}>
          <Image source={RMC_LOGO} style={styles.idBrandLogo} resizeMode="contain" />
          <View style={styles.idLogomarkWrapper}>
            <Text style={styles.idLogomarkBig}>RMC</Text>
            <Text style={styles.idLogomarkSmall}>RITESH MATHEMATICS CLASSES</Text>
          </View>
        </View>
        <View style={styles.idType}>
          <Text style={styles.idTypeMain}>IDENTITY CARD</Text>
          <Text style={styles.idTypeYear}>2025-26</Text>
        </View>
      </View>

      <View style={styles.idConcept}>
        <Text style={styles.conceptMainText}>RMC</Text>
        <Text style={styles.conceptSubText}>Concept Se Selection tak</Text>
      </View>

      <View style={styles.idBatchBox}>
        <Text style={styles.idBatchText}>{student.primary_system_batch || student.current_batch || student.batch_name || 'GENERAL BATCH'}</Text>
      </View>

      <View style={styles.idMiddleGrid}>
        <View style={styles.middleItem}>
          {qrUri ? <Image source={{ uri: qrUri }} style={styles.idQrImage} resizeMode="contain" /> : <View style={styles.idQrImage} />}
        </View>
        <View style={styles.middleItem}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.idPhoto} />
          ) : (
            <View style={[styles.idPhoto, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F2EA' }]}>
              <Text style={{ fontSize: 28, fontWeight: '900', color: '#0F172A' }}>
                {(student.name || 'S').trim().slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.idDetails}>
        <Text style={styles.idName}>{(student.name || 'Student').toUpperCase()}</Text>
        <Text style={styles.idUid}>{student.student_uid || 'UID-N/A'}</Text>
        <View style={styles.idSecondaryRow}>
          <Text style={styles.idSecondaryText}>FNO: {student.phone || 'N/A'}</Text>
          <Text style={styles.idSecondaryText}>FBC: {student.fbc_no || 'N/A'}</Text>
        </View>
        <Text style={styles.idParent}>Father's Name: {student.father_name || 'N/A'}</Text>
        <Text style={styles.idAddress}>Guardian: {student.guardian_phone || 'N/A'} | Class: {student.student_class || 'N/A'}</Text>
      </View>
      <Text style={styles.idFooterLink}>Show Details -&gt;</Text>
    </View>
  );
};

function MainApp() {
  const [baseUrl, setBaseUrl] = useState(getDefaultServerUrl());
  const [baseUrlDraft, setBaseUrlDraft] = useState(getDefaultServerUrl());
  const isTestCloneServer = baseUrl !== LOCKED_SERVER_URL;
  const [cookieHeader, setCookieHeader] = useState('');
  const [session, setSession] = useState<SessionInfo>(null);
  const [booting, setBooting] = useState(true);
  const [busyMessage, setBusyMessage] = useState('');
  const [busyProgress, setBusyProgress] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [guestTab, setGuestTab] = useState<GuestTab>('welcome');
  const [studentTab, setStudentTab] = useState<StudentTab>('overview');
  const [staffTab, setStaffTabState] = useState<StaffTab>('home');
  const [staffDrawerOpen, setStaffDrawerOpen] = useState(false);
  const [studentQrExpanded, setStudentQrExpanded] = useState(false);
  const [leadRequestName, setLeadRequestName] = useState('');
  const [leadRequestPhone, setLeadRequestPhone] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffScannerVisible, setStaffScannerVisible] = useState(false);
  const [studentUid, setStudentUid] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [studentFather, setStudentFather] = useState('');
  const [studentScannerVisible, setStudentScannerVisible] = useState(false);
  const [serverOverrideVisible, setServerOverrideVisible] = useState(false);
  const [registrationForm, setRegistrationForm] = useState<RegistrationForm>({ name: '', phone: '', father_name: '', guardian_phone: '', address: '', student_class: '', current_batches: [], aspiration: '', photo: '' });
  const [publicBatches, setPublicBatches] = useState<Batch[]>([]);
  const [studentMaterials, setStudentMaterials] = useState<MaterialItem[]>([]);
  const [studentNotices, setStudentNotices] = useState<NoticeItem[]>([]);
  const [studentDoubts, setStudentDoubts] = useState<DoubtItem[]>([]);
  const [staffDoubts, setStaffDoubts] = useState<DoubtItem[]>([]);
  const [newDoubtText, setNewDoubtText] = useState('');
  const [newDoubtPhoto, setNewDoubtPhoto] = useState('');
  const [doubtReplyPhoto, setDoubtReplyPhoto] = useState('');
  const [studentNotifications, setStudentNotifications] = useState<PersonalNotification[]>([]);
  const mobilePushRegistrationRef = useRef('');
  const mobilePushChannelReadyRef = useRef(false);
  const staffTabResetReasonRef = useRef<'manual' | 'login' | 'logout' | 'role_change' | 'invalid' | null>(null);
  const lastNonHomeStaffTabRef = useRef<StaffTab>('home');

  const DigitalIdCard = ({ student }: { student: StudentProfile }) => (
    <View style={styles.idCardContainer}>
      <IdCardFront student={student} baseUrl={baseUrl} />
    </View>
  );
  const [studentTests, setStudentTests] = useState<StudentDashboardTests>({ upcoming: [], history: [], scoreboard_tests: [] });
  const [selectedScoreboardLaunchId, setSelectedScoreboardLaunchId] = useState('');
  const [scoreboardPayload, setScoreboardPayload] = useState<ScoreboardPayload | null>(null);
  const [testAttemptVisible, setTestAttemptVisible] = useState(false);
  const [activeTestAttempt, setActiveTestAttempt] = useState<TestAttemptPayload | null>(null);
  const [testAnswers, setTestAnswers] = useState<Record<number, 'A' | 'B' | 'C' | 'D'>>({});
  const [pastPaperVisible, setPastPaperVisible] = useState(false);
  const [pastPaperPayload, setPastPaperPayload] = useState<TestAttemptPayload | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [studentDirectoryCount, setStudentDirectoryCount] = useState(0);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [weeklyAlerts, setWeeklyAlerts] = useState<WeeklyAlert[]>([]);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [feeDashboard, setFeeDashboard] = useState<FeeDashboardPayload | null>(null);
  const [feePriorityRows, setFeePriorityRows] = useState<FeePriorityRow[]>([]);
  const [feeStudentUid, setFeeStudentUid] = useState('');
  const [feeStudentSummary, setFeeStudentSummary] = useState<FeeStudentSummaryPayload | null>(null);
  const [feeCreateStudentUid, setFeeCreateStudentUid] = useState('');
  const [feeCreateBatchName, setFeeCreateBatchName] = useState('');
  const [feeCreateMode, setFeeCreateMode] = useState<FeeCreatePlanMode>('installment');
  const [feeCreateTotalAmount, setFeeCreateTotalAmount] = useState('30000');
  const [feeCreateDiscountAmount, setFeeCreateDiscountAmount] = useState('0');
  const [feeCreateStartDate, setFeeCreateStartDate] = useState(todayDateInput());
  const [feeCreateInstallmentCount, setFeeCreateInstallmentCount] = useState('3');
  const [feeCreateSubmitting, setFeeCreateSubmitting] = useState(false);
  const [feeLoading, setFeeLoading] = useState(false);
  const [testPapers, setTestPapers] = useState<TestPaperSummary[]>([]);
  const [testLaunches, setTestLaunches] = useState<TestLaunchSummary[]>([]);
  const [testSubmissions, setTestSubmissions] = useState<StaffSubmissionRow[]>([]);
  const [selectedLaunchId, setSelectedLaunchId] = useState('');
  const [selectedPaperId, setSelectedPaperId] = useState('');
  const [testDraftTitle, setTestDraftTitle] = useState('');
  const [testDraftSubject, setTestDraftSubject] = useState('');
  const [testDraftDuration, setTestDraftDuration] = useState('30');
  const [draftQuestions, setDraftQuestions] = useState<DraftTestQuestion[]>([
    { question_text: '', options: { A: '', B: '', C: '', D: '' }, correct_option: 'A' }
  ]);
  const [attendanceBatch, setAttendanceBatch] = useState('');
  const [studentBatchFilter, setStudentBatchFilter] = useState('');
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [batchHistory, setBatchHistory] = useState<AttendanceHistoryRow[]>([]);
  const [currentSession, setCurrentSession] = useState<AttendanceWorkspaceSession | null>(null);
  const [attendanceSessionActionInFlight, setAttendanceSessionActionInFlight] = useState(false);
  const [roster, setRoster] = useState<StudentRow[]>([]);
  const [attendanceDisplayRows, setAttendanceDisplayRows] = useState<StudentRow[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
    const [attendanceScannerVisible, setAttendanceScannerVisible] = useState(false);
    const [lastScannedStudent, setLastScannedStudent] = useState<StudentRow | null>(null);
    const [attendancePreviewStudent, setAttendancePreviewStudent] = useState<StudentProfile | null>(null);
    const [attendanceScanResult, setAttendanceScanResult] = useState<{
      alreadyMarked: boolean;
      statusLabel: string;
      detail: string;
    } | null>(null);
  const [studentModalVisible, setStudentModalVisible] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);
  const [selectedStudentBatches, setSelectedStudentBatches] = useState<string[]>([]);
  const [newBatchName, setNewBatchName] = useState('');
  const [newBatchDescription, setNewBatchDescription] = useState('');
  const [editingBatchId, setEditingBatchId] = useState<number | null>(null);
  const [editingBatchName, setEditingBatchName] = useState('');
  const [editingBatchDescription, setEditingBatchDescription] = useState('');
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialDescription, setMaterialDescription] = useState('');
  const [materialBatchId, setMaterialBatchId] = useState('');
  const [materialLink, setMaterialLink] = useState('');
  const [materialUpload, setMaterialUpload] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeContent, setNoticeContent] = useState('');
  const [noticeTarget, setNoticeTarget] = useState('ALL');
  const [reportBatch, setReportBatch] = useState('ALL');
  const [doubtBatchFilter, setDoubtBatchFilter] = useState('');
  const [testBatch, setTestBatch] = useState('');
  const [selectedAbsenteeSessionId, setSelectedAbsenteeSessionId] = useState('');
  const [staffNotificationSection, setStaffNotificationSection] = useState<StaffNotificationSection>('notices');
  const [createdStaffCard, setCreatedStaffCard] = useState<CreatedStaffCard | null>(null);
  const [staffCardForm, setStaffCardForm] = useState<StaffCardPayload>({ full_name: '', username: '', password: '', phone: '', role: 'teacher' });
  const [renameTableTarget, setRenameTableTarget] = useState('');
  const [renameTableValue, setRenameTableValue] = useState('');
  const [attendanceSessionName, setAttendanceSessionName] = useState('');

  // SMS States
  const [smsAudience, setSmsAudience] = useState<'session' | 'batch' | 'all' | 'custom'>('session');
  const [smsRecipientMode, setSmsRecipientMode] = useState<'guardian' | 'student'>('guardian');
  const [smsMessage, setSmsMessage] = useState('');
  const [smsCustomNumbers, setSmsCustomNumbers] = useState('');
  const [smsStatuses, setSmsStatuses] = useState<string[]>(['present', 'late', 'absent']);
  const [smsBatch, setSmsBatch] = useState('');
  const [smsSessionId, setSmsSessionId] = useState('');
  const [smsBatchHistory, setSmsBatchHistory] = useState<AttendanceHistoryRow[]>([]);
  const [smsPreview, setSmsPreview] = useState<SmsPreviewState | null>(null);
  const [smsSending, setSmsSending] = useState(false);
  const [studentDownloadedMaterials, setStudentDownloadedMaterials] = useState<CachedMaterial[]>([]);
  const [documentViewer, setDocumentViewer] = useState<DocumentPreviewState | null>(null);
  const [pdfReadingPositions, setPdfReadingPositions] = useState<Record<string, number>>({});
  const [offlineMode, setOfflineMode] = useState(false);
  const [mobileManifest, setMobileManifest] = useState<MobileManifestPayload | null>(null);
  const [mobileFeed, setMobileFeed] = useState<MobileFeedItem[]>([]);
  const [mobileConfig, setMobileConfig] = useState<MobileAppConfig>(DEFAULT_MOBILE_CONFIG);
  const [mobileUpdatePrompt, setMobileUpdatePrompt] = useState<MobileManifestPayload['app'] | null>(null);
  const [staffOtaAppliedConfigVersion, setStaffOtaAppliedConfigVersion] = useState(0);
  const [, setPendingMobileManifest] = useState<MobileManifestPayload | null>(null);
  const [mobileManifestCheckedAt, setMobileManifestCheckedAt] = useState('');
  const [attendanceQueueRevision, setAttendanceQueueRevision] = useState(0);
  const [attendanceSessionCacheRevision, setAttendanceSessionCacheRevision] = useState(0);

  const appCacheRef = useRef<AppCachePayload>({});
  const resourceCacheRef = useRef<Record<string, CachedResourceEntry<unknown>>>({});
  const resourceFetchInFlightRef = useRef<Record<string, Promise<unknown> | undefined>>({});
  const trustedSessionsRef = useRef<TrustedSessionRecord[]>([]);
  const deviceIdRef = useRef('');
  const studentDirectorySnapshotRef = useRef<CachedStudentRow[]>([]);
  const rosterSnapshotRef = useRef<StudentRow[]>([]);
  const staffBatchesRef = useRef<Batch[]>([]);
  const persistWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const uiPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKnownAttendanceBatchRef = useRef('');
  const offlineAttendanceSessionKeyRef = useRef('');
  const attendanceSessionPendingRef = useRef<AttendanceWorkspaceSession | null>(null);
  const staffCoreRequestRef = useRef(0);
  const batchInsightsRequestRef = useRef(0);
  const smsBatchInsightsRequestRef = useRef(0);
  const reportRequestRef = useRef(0);
  const mobileManifestRequestRef = useRef(0);
  const attendanceQueueSyncInFlightRef = useRef(false);
  const localAttendanceReplayInFlightRef = useRef(false);
  const localAttendanceReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teacherOfflinePrimeInFlightRef = useRef(false);
  const mobilePushRegistrationInFlightRef = useRef('');
  const studentDirectoryRequestInFlightRef = useRef<Promise<CachedStudentRow[]> | null>(null);
  const rosterRequestInFlightRef = useRef<Record<string, Promise<StudentRow[]> | undefined>>({});
  const batchInsightsRequestInFlightRef = useRef<Record<string, Promise<void> | undefined>>({});
  const smsBatchInsightsRequestInFlightRef = useRef<Record<string, Promise<void> | undefined>>({});
  const startupBootInFlightRef = useRef(false);
  const startupBootDoneRef = useRef(false);
  const bootManifestPrimedRef = useRef(false);
  const smsTemplateRef = useRef('');
  const uiSnapshotRef = useRef<AppUiSnapshot>({
    attendanceBatch: '',
    studentBatchFilter: '',
    reportBatch: 'ALL',
    doubtBatchFilter: '',
    testBatch: '',
    smsBatch: '',
    selectedLaunchId: '',
    selectedPaperId: '',
    selectedAbsenteeSessionId: '',
    selectedScoreboardLaunchId: '',
    studentTab: 'overview',
    staffTab: 'home',
    staffNotificationSection: 'notices'
  });
  const cookieRef = useRef('');
  let apiJson: <T,>(path: string, options?: RequestInit) => Promise<T> = (async () => {
    throw new Error('API helper not initialized');
  }) as unknown as <T,>(path: string, options?: RequestInit) => Promise<T>;
  const scheduleLocalAttendanceReplayRef = useRef<(reason: string, options?: { immediate?: boolean }) => boolean>(() => false);
  const scheduleLocalAttendanceReplay = useCallback((reason: string, options?: { immediate?: boolean }) => {
    return scheduleLocalAttendanceReplayRef.current(reason, options);
  }, []);
  const isHost = session?.type === 'staff' && session.user.role === 'teacher';

  const applyCachedWorkspace = useCallback((cache: AppCachePayload) => {
    const role = inferWorkspaceRoleFromCache(cache);
    if (cache.session) {
      const restored = restoreSession(cache.session);
      if (restored) {
        setSession(restored);
      }
    }
    if (Array.isArray(cache.publicBatches)) setPublicBatches(cache.publicBatches);
    if (cache.pdfReadingPositions && typeof cache.pdfReadingPositions === 'object') setPdfReadingPositions(cache.pdfReadingPositions);
    if (cache.resourceCache && typeof cache.resourceCache === 'object') {
      resourceCacheRef.current = filterResourceCacheForRole(cache.resourceCache, role) || {};
    }
    if (cache.mobileManifest) setMobileManifest(cache.mobileManifest);
    if (Array.isArray(cache.mobileFeed)) setMobileFeed(cache.mobileFeed);
    if (cache.mobileConfig) setMobileConfig({ ...DEFAULT_MOBILE_CONFIG, ...cache.mobileConfig });
    if (cache.ui) {
      setReportBatch(cache.ui.reportBatch || 'ALL');
      setDoubtBatchFilter(cache.ui.doubtBatchFilter || '');
      setTestBatch(cache.ui.testBatch || '');
      setSmsBatch(cache.ui.smsBatch || '');
      setSelectedLaunchId(cache.ui.selectedLaunchId || '');
      setSelectedPaperId(cache.ui.selectedPaperId || '');
      setSelectedAbsenteeSessionId(cache.ui.selectedAbsenteeSessionId || '');
      setSelectedScoreboardLaunchId(cache.ui.selectedScoreboardLaunchId || '');
      setStudentTab(cache.ui.studentTab || 'overview');
      setStaffTab(getSafeStaffTab(isTestCloneServer || cache.ui.staffTab !== 'fees' ? (cache.ui.staffTab || 'home') : 'home'), { resetReason: 'role_change' });
      setStaffNotificationSection(cache.ui.staffNotificationSection || 'notices');
    }
    if (role === 'staff') {
      if (Array.isArray(cache.materials)) setMaterials(cache.materials);
      if (Array.isArray(cache.notices)) setNotices(cache.notices);
      if (Array.isArray(cache.leads)) setLeads(cache.leads);
      if (cache.systemStats) setSystemStats(cache.systemStats);
      if (Array.isArray(cache.testPapers)) setTestPapers(cache.testPapers);
      if (Array.isArray(cache.testLaunches)) setTestLaunches(cache.testLaunches);
    if (Array.isArray(cache.testSubmissions)) setTestSubmissions(cache.testSubmissions);
    if (Array.isArray(cache.downloadedMaterials)) setStudentDownloadedMaterials(cache.downloadedMaterials);
  } else if (role === 'student') {
      if (Array.isArray(cache.studentMaterials)) setStudentMaterials(cache.studentMaterials);
      if (Array.isArray(cache.studentNotices)) setStudentNotices(cache.studentNotices);
      if (Array.isArray(cache.studentNotifications)) setStudentNotifications(cache.studentNotifications);
      if (Array.isArray(cache.downloadedMaterials)) setStudentDownloadedMaterials(cache.downloadedMaterials);
    }
    const cachedActiveSession = cache.currentSession && cache.currentSession.status !== 'closed' ? cache.currentSession : null;
    const resolvedSession = resolveActiveAttendanceSessionFromLedger({
      cache,
      preferredSession: cachedActiveSession,
      serverSession: cachedActiveSession,
      attendanceBatch: cache.ui?.attendanceBatch || lastKnownAttendanceBatchRef.current || attendanceBatch,
      attendanceSessionName: attendanceSessionNameRef.current,
      offlineAttendanceSessionKey: offlineAttendanceSessionKeyRef.current,
      allowLocalOpenSession: false
    });
    setCurrentSession(resolvedSession.currentSession || cachedActiveSession);
    setAttendanceBatch(resolvedSession.attendanceBatch);
    if (resolvedSession.attendanceSessionName && !String(attendanceSessionNameRef.current || '').trim()) {
      setAttendanceSessionName(resolvedSession.attendanceSessionName);
    }
    offlineAttendanceSessionKeyRef.current = resolvedSession.offlineAttendanceSessionKey;
    setAttendanceSessionCacheRevision((value) => value + 1);
  }, []);

  const applyStudentDirectorySnapshot = useCallback((cache: StudentDirectoryCache | null) => {
    if (!cache || !Array.isArray(cache.students) || !cache.students.length) return [];
    const nextStudents = compactStudentDirectoryRows(cache.students);
    studentDirectorySnapshotRef.current = nextStudents;
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const nextStudentsByUid = buildStudentsByUid(nextStudents, currentCache.studentsByUid);
    const nextUpdatedAt = new Date().toISOString();
    appCacheRef.current = normalizeLocalAttendanceCache({
      ...appCacheRef.current,
      studentsByUid: nextStudentsByUid,
      updatedAt: nextUpdatedAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    void writeAppCache(appCacheRef.current).catch(() => null);
    startTransition(() => {
      setStudentDirectoryCount(nextStudents.length);
      setStudents(nextStudents as unknown as StudentRow[]);
    });
    return nextStudents;
  }, []);

  const applyStaffCoreSnapshot = useCallback((cache: StaffCoreCache | null, options: StaffCoreSnapshotOptions = {}) => {
    if (!cache) return null;
    const shouldPreferOpenSession = options.preferOpenSession !== false;
    if (Array.isArray(cache.batches)) {
      staffBatchesRef.current = cache.batches;
      startTransition(() => setBatches(cache.batches));
    }
    const existingOpenSession = shouldPreferOpenSession && currentSessionRef.current && currentSessionRef.current.status !== 'closed' ? currentSessionRef.current : null;
    const cachedActiveSession = cache.currentSession && cache.currentSession.status !== 'closed' ? cache.currentSession : null;
    const resolvedSession = resolveActiveAttendanceSessionFromLedger({
      cache: appCacheRef.current,
      preferredSession: shouldPreferOpenSession ? (cachedActiveSession || existingOpenSession || currentSessionRef.current) : cachedActiveSession,
      serverSession: shouldPreferOpenSession ? (cachedActiveSession || existingOpenSession) : cachedActiveSession,
      attendanceBatch: currentSessionRef.current?.batch_id || lastKnownAttendanceBatchRef.current || attendanceBatch,
      attendanceSessionName: attendanceSessionNameRef.current,
      offlineAttendanceSessionKey: offlineAttendanceSessionKeyRef.current,
      preferLocalOpenSession: shouldPreferOpenSession
    });
    const nextSession = resolvedSession.currentSession || cachedActiveSession || existingOpenSession || null;
    appCacheRef.current = normalizeLocalAttendanceCache({
      ...appCacheRef.current,
      batches: Array.isArray(cache.batches) ? cache.batches : appCacheRef.current.batches,
      currentSession: nextSession,
      updatedAt: new Date().toISOString(),
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    setCurrentSession(nextSession);
    setAttendanceBatch(resolvedSession.attendanceBatch);
    if (resolvedSession.attendanceSessionName && !String(attendanceSessionNameRef.current || '').trim()) {
      setAttendanceSessionName(resolvedSession.attendanceSessionName);
    }
    offlineAttendanceSessionKeyRef.current = resolvedSession.offlineAttendanceSessionKey;
    if (resolvedSession.currentSession?.batch_id) {
      lastKnownAttendanceBatchRef.current = resolvedSession.currentSession.batch_id;
    }
    return nextSession;
  }, []);

  const applyStaffBootstrap = useCallback(async (bootstrap?: StaffBootstrapPayload | null) => {
    if (!bootstrap) return;
    const nextStudents = compactStudentDirectoryRows(bootstrap.students);
    const nextCore: StaffCoreCache = {
      savedAt: Date.now(),
      batches: Array.isArray(bootstrap.batches) ? bootstrap.batches : [],
      currentSession: bootstrap.currentSession || null
    };
    const nextDirectory: StudentDirectoryCache = {
      savedAt: Date.now(),
      students: nextStudents
    };
    await Promise.all([
      writeStaffCoreCache(nextCore),
      writeStudentDirectoryCache(nextDirectory)
    ]);
    applyStaffCoreSnapshot(nextCore);
    applyStudentDirectorySnapshot(nextDirectory);
    void primeTeacherOfflinePack({
      batches: nextCore.batches
    }).catch(() => null);
  }, [applyStaffCoreSnapshot, applyStudentDirectorySnapshot]);

  const persistTrustedSession = useCallback(async (sessionValue: SessionInfo | null) => {
    if (!sessionValue) return;
    const deviceId = deviceIdRef.current || await getOrCreateDeviceId();
    deviceIdRef.current = deviceId;
    const snapshot = snapshotSession(sessionValue);
    if (!snapshot) return;
    const nextRecord: TrustedSessionRecord = sessionValue.type === 'student'
      ? {
        device_id: deviceId,
        kind: 'student',
        identifier: String(sessionValue.student.student_uid || '').trim().toLowerCase(),
        savedAt: Date.now(),
        session: snapshot,
        hints: {
          name: String(sessionValue.student.name || '').trim(),
          phone: String(sessionValue.student.phone || '').trim(),
          father: String(sessionValue.student.father_name || '').trim()
        }
      }
      : {
        device_id: deviceId,
        kind: 'staff',
        identifier: String(sessionValue.user.username || '').trim().toLowerCase(),
        savedAt: Date.now(),
        session: snapshot,
        hints: {
          full_name: String(sessionValue.user.full_name || '').trim()
        }
      };
    const nextRecords = [
      nextRecord,
      ...(trustedSessionsRef.current || []).filter((record) => {
        if (record.kind !== nextRecord.kind) return true;
        if (record.identifier !== nextRecord.identifier) return true;
        return record.device_id !== nextRecord.device_id;
      })
    ].slice(0, 24);
    trustedSessionsRef.current = nextRecords;
    await writeLocalJson(TRUSTED_SESSION_CACHE_KEY, nextRecords).catch(() => null);
  }, []);

  const findTrustedSession = useCallback((kind: 'student' | 'staff', identifier: string, meta?: { name?: string; phone?: string; father?: string }) => {
    const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
    const normalizedName = String(meta?.name || '').trim().toLowerCase();
    const normalizedPhone = String(meta?.phone || '').trim().toLowerCase();
    const normalizedFather = String(meta?.father || '').trim().toLowerCase();
    const candidates = [...(trustedSessionsRef.current || [])]
      .filter((record) => record.device_id === deviceIdRef.current && record.kind === kind)
      .sort((a, b) => b.savedAt - a.savedAt);

    for (const record of candidates) {
      if (kind === 'staff') {
        const username = String(record.identifier || '').trim().toLowerCase();
        const fullName = String(record.hints?.full_name || '').trim().toLowerCase();
        if (normalizedIdentifier && username === normalizedIdentifier) return restoreSession(record.session);
        if (normalizedIdentifier && fullName && fullName === normalizedIdentifier) return restoreSession(record.session);
        if (normalizedName && (username === normalizedName || fullName === normalizedName)) return restoreSession(record.session);
        continue;
      }

      const studentUid = String(record.identifier || '').trim().toLowerCase();
      const hintName = String(record.hints?.name || '').trim().toLowerCase();
      const hintPhone = String(record.hints?.phone || '').trim().toLowerCase();
      const hintFather = String(record.hints?.father || '').trim().toLowerCase();
      const uidMatches = !normalizedIdentifier || studentUid === normalizedIdentifier;
      const nameMatches = !normalizedName || hintName === normalizedName;
      const phoneMatches = !normalizedPhone || hintPhone === normalizedPhone;
      const fatherMatches = !normalizedFather || hintFather === normalizedFather;
      if (uidMatches && nameMatches && phoneMatches && fatherMatches) {
        return restoreSession(record.session);
      }
    }

    return null;
  }, []);

  const persistAppCache = useCallback((patch: Partial<AppCachePayload>) => {
    const task = persistWriteQueueRef.current.then(async () => {
      const nextRaw = { ...appCacheRef.current, ...patch };
      const role = patch.workspaceRole ?? inferWorkspaceRoleFromCache(nextRaw);
      const next = sanitizeAppCacheForRole(nextRaw, role);
      appCacheRef.current = next;
      await writeAppCache(next);
    }).catch((error) => {
      console.error('[AppCache] Failed to persist cache:', error);
    });
    persistWriteQueueRef.current = task.then(() => undefined, () => undefined);
    return task;
  }, []);

  const persistLocalAttendanceCache = useCallback(async (patch: Partial<AppCachePayload>) => {
    return persistAppCache({
      ...patch,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION,
      updatedAt: new Date().toISOString()
    });
  }, [persistAppCache]);

  useEffect(() => {
    if (!mobileUpdatePrompt || sessionRef.current?.type !== 'staff') return;
    if (!isStaffOtaUpdateMode(mobileUpdatePrompt.update_mode)) return;
    const promptVersion = Number(mobileUpdatePrompt.config_version || 0) || 0;
    if (!promptVersion) return;
    const appliedVersion = Math.max(
      Number(staffOtaAppliedConfigVersion || 0) || 0,
      Number(appCacheRef.current.staffOtaAppliedConfigVersion || 0) || 0,
      Number(staffOtaAppliedConfigVersionRef.current || 0) || 0
    );
    if (promptVersion <= appliedVersion) {
      console.log('[MobileManifest] suppressing staff OTA prompt ' + JSON.stringify({
        promptVersion,
        appliedVersion
      }));
      setMobileUpdatePrompt(null);
      setPendingMobileManifest(null);
      mobileManifestBlockedRef.current = false;
    }
  }, [mobileUpdatePrompt, staffOtaAppliedConfigVersion]);

  const upsertLocalAttendanceMark = useCallback(async (payload: {
    student: StudentRow;
    sessionId?: number | null;
    sessionKey?: string;
    batchName?: string;
    status: 'present' | 'late' | 'absent';
    markedAt?: string;
  }) => {
    const studentUid = String(payload.student?.student_uid || '').trim();
    if (!studentUid) {
      return { mark: null as CanonicalAttendanceMark | null, didInsert: false, sessionKey: '' };
    }

    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const baseSessionKey = String(
      payload.sessionKey ||
      (payload.sessionId && payload.sessionId > 0
        ? getServerSessionKey(payload.sessionId)
        : offlineAttendanceSessionKeyRef.current || getLocalSessionKey(currentSessionRef.current?.localSessionId || '') || '')
    ).trim();
    const resolvedSessionKey = resolveSessionKey(baseSessionKey, currentCache.sessionAliasMap);
    if (!baseSessionKey || !resolvedSessionKey) {
      return { mark: null as CanonicalAttendanceMark | null, didInsert: false, sessionKey: '' };
    }

    const currentMarksBySession = currentCache.attendanceMarksBySession || {};
    const existing = currentMarksBySession[resolvedSessionKey]?.[studentUid] || currentMarksBySession[baseSessionKey]?.[studentUid] || null;
    if (existing) {
      offlineAttendanceSessionKeyRef.current = baseSessionKey;
      return { mark: existing, didInsert: false, sessionKey: resolvedSessionKey };
    }

    const markedAt = String(payload.markedAt || new Date().toISOString());
    const markKey = getMarkKey(baseSessionKey, studentUid);
    const baseMark: CanonicalAttendanceMark = {
      markKey,
      sessionKey: baseSessionKey,
      studentUid,
      status: payload.status,
      markedAt,
      syncStatus: 'pending_sync',
      lastError: null
    };
    const nextMarksBySession = {
      ...currentMarksBySession,
      [baseSessionKey]: {
        ...(currentMarksBySession[baseSessionKey] || {}),
        [studentUid]: baseMark
      }
    };
    const nextMark = resolvedSessionKey === baseSessionKey
      ? baseMark
      : {
        ...baseMark,
        sessionKey: resolvedSessionKey
      };
    if (resolvedSessionKey !== baseSessionKey) {
      nextMarksBySession[resolvedSessionKey] = {
        ...(currentMarksBySession[resolvedSessionKey] || {}),
        [studentUid]: nextMark
      };
    }
    const sessionDisplay = extractSessionDisplayMetadata(currentSessionRef.current || {}, payload.batchName || currentSessionRef.current?.batch_id || '');
    const nextSessionsByKey = {
      ...currentCache.sessionsByKey
    };
    if (!nextSessionsByKey[baseSessionKey]) {
      const baseIds = getSessionIdsFromKey(baseSessionKey);
      nextSessionsByKey[baseSessionKey] = buildCanonicalSession(
        baseSessionKey,
        payload.batchName || currentSessionRef.current?.batch_id || '',
        payload.sessionId ?? currentSessionRef.current?.session_id ?? null,
        {
          localSessionId: baseIds.localSessionId,
          serverSessionId: baseIds.serverSessionId,
          status: 'open',
          createdAt: markedAt,
          syncStatus: baseIds.localSessionId ? 'pending_create' : 'synced',
          session_name: sessionDisplay.sessionName,
          sessionName: sessionDisplay.sessionName,
          column_name: sessionDisplay.columnName,
          columnName: sessionDisplay.columnName,
          title: sessionDisplay.title,
          displayName: sessionDisplay.displayName,
          name: sessionDisplay.name
        }
      );
    }
    if (resolvedSessionKey !== baseSessionKey && !nextSessionsByKey[resolvedSessionKey]) {
      const resolvedIds = getSessionIdsFromKey(resolvedSessionKey);
      nextSessionsByKey[resolvedSessionKey] = buildCanonicalSession(
        resolvedSessionKey,
        payload.batchName || currentSessionRef.current?.batch_id || '',
        payload.sessionId ?? currentSessionRef.current?.session_id ?? null,
        {
          localSessionId: resolvedIds.localSessionId,
          serverSessionId: resolvedIds.serverSessionId,
          status: 'open',
          createdAt: markedAt,
          syncStatus: resolvedIds.serverSessionId ? 'synced' : 'pending_create',
          session_name: sessionDisplay.sessionName,
          sessionName: sessionDisplay.sessionName,
          column_name: sessionDisplay.columnName,
          columnName: sessionDisplay.columnName,
          title: sessionDisplay.title,
          displayName: sessionDisplay.displayName,
          name: sessionDisplay.name
        }
      );
    }
    const nextSyncQueue = [
      ...(currentCache.syncQueue || []).filter((item) => item.queueKey !== markKey),
      buildAttendanceQueueItem(nextMark)
    ];
    const nextCache = normalizeLocalAttendanceCache({
      ...currentCache,
      attendanceMarksBySession: nextMarksBySession,
      sessionsByKey: nextSessionsByKey,
      syncQueue: nextSyncQueue,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION,
      updatedAt: markedAt
    });
    appCacheRef.current = nextCache;
    offlineAttendanceSessionKeyRef.current = baseSessionKey;
    void persistLocalAttendanceCache({
      attendanceMarksBySession: nextMarksBySession,
      sessionsByKey: nextSessionsByKey,
      syncQueue: nextSyncQueue,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION,
      updatedAt: markedAt
    });
    return { mark: nextMark, didInsert: true, sessionKey: resolvedSessionKey };
  }, [persistLocalAttendanceCache]);

  const patchLocalAttendanceMark = useCallback(async (
    sessionKey: string,
    studentUid: string,
    patch: Partial<Pick<CanonicalAttendanceMark, 'status' | 'syncStatus' | 'lastError' | 'attemptCount' | 'nextAttemptAt' | 'lastAttemptAt'>>
  ) => {
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const resolvedSessionKey = resolveSessionKey(sessionKey, currentCache.sessionAliasMap);
    const normalizedStudentUid = String(studentUid || '').trim();
    if (!resolvedSessionKey || !normalizedStudentUid) return null;

    const currentMarksBySession = currentCache.attendanceMarksBySession || {};
    const existing = currentMarksBySession[resolvedSessionKey]?.[normalizedStudentUid] || currentMarksBySession[sessionKey]?.[normalizedStudentUid];
    if (!existing) return null;

    const nextMark: CanonicalAttendanceMark = {
      ...existing,
      ...patch,
      sessionKey: resolvedSessionKey,
      studentUid: normalizedStudentUid,
      markKey: existing.markKey || getMarkKey(sessionKey, normalizedStudentUid),
      markedAt: existing.markedAt,
      attemptCount: Number.isFinite(Number(patch.attemptCount)) ? Number(patch.attemptCount) : Number(existing.attemptCount || 0),
      nextAttemptAt: patch.nextAttemptAt !== undefined ? patch.nextAttemptAt : (existing.nextAttemptAt ?? null),
      lastAttemptAt: patch.lastAttemptAt !== undefined ? patch.lastAttemptAt : (existing.lastAttemptAt ?? null)
    };
    const nextMarksBySession = {
      ...currentMarksBySession,
      [sessionKey]: {
        ...(currentMarksBySession[sessionKey] || {}),
        [normalizedStudentUid]: {
          ...nextMark,
          sessionKey
        }
      }
    };
    if (resolvedSessionKey !== sessionKey) {
      nextMarksBySession[resolvedSessionKey] = {
        ...(currentMarksBySession[resolvedSessionKey] || {}),
        [normalizedStudentUid]: nextMark
      };
    }
    const nextSyncQueue = [
      ...(currentCache.syncQueue || []).filter((item) => item.queueKey !== nextMark.markKey),
      buildAttendanceQueueItem(nextMark)
    ];
    const nextCache = normalizeLocalAttendanceCache({
      ...currentCache,
      attendanceMarksBySession: nextMarksBySession,
      syncQueue: nextSyncQueue,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION,
      updatedAt: existing.markedAt
    });
    appCacheRef.current = nextCache;
    void persistLocalAttendanceCache({
      attendanceMarksBySession: nextMarksBySession,
      syncQueue: nextSyncQueue,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION,
      updatedAt: existing.markedAt
    });
    setAttendanceSessionCacheRevision((value) => value + 1);
    void scheduleLocalAttendanceReplay('local_mark_created', { immediate: true });
    return nextMark;
  }, [persistLocalAttendanceCache, scheduleLocalAttendanceReplay]);

  const patchLocalSessionRecord = useCallback(async (
    sessionKey: string,
    patch: Partial<Pick<
      CanonicalSession,
      | 'status'
      | 'syncStatus'
      | 'lastError'
      | 'attemptCount'
      | 'nextAttemptAt'
      | 'lastAttemptAt'
      | 'lateSyncStatus'
      | 'lateAttemptCount'
      | 'lateNextAttemptAt'
      | 'lateLastAttemptAt'
      | 'lateLastError'
      | 'closeSyncStatus'
      | 'closeAttemptCount'
      | 'closeNextAttemptAt'
      | 'closeLastAttemptAt'
      | 'closeLastError'
    >> & Partial<Pick<AttendanceWorkspaceSession, 'session_id' | 'serverSessionId' | 'localSessionId' | 'batch_id' | 'session_name' | 'column_name' | 'is_late' | 'created_at' | 'closed_at' | 'sessionKey'>>
  ) => {
    const normalizedSessionKey = String(sessionKey || '').trim();
    if (!normalizedSessionKey) return null;
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const resolvedSessionKey = resolveSessionKey(normalizedSessionKey, currentCache.sessionAliasMap);
    const existing = currentCache.sessionsByKey?.[normalizedSessionKey] || currentCache.sessionsByKey?.[resolvedSessionKey] || null;
    if (!existing) return null;

    const nextSession: CanonicalSession = {
      ...existing,
      ...patch,
      sessionKey: resolvedSessionKey || normalizedSessionKey,
      status: patch.status ? (patch.status === 'closed' ? 'closed' : 'open') : existing.status,
      syncStatus: patch.syncStatus || existing.syncStatus,
      lastError: patch.lastError ?? existing.lastError ?? null,
      attemptCount: Number.isFinite(Number(patch.attemptCount)) ? Number(patch.attemptCount) : Number(existing.attemptCount || 0),
      nextAttemptAt: patch.nextAttemptAt !== undefined ? patch.nextAttemptAt : (existing.nextAttemptAt ?? null),
      lastAttemptAt: patch.lastAttemptAt !== undefined ? patch.lastAttemptAt : (existing.lastAttemptAt ?? null),
      lateSyncStatus: patch.lateSyncStatus || existing.lateSyncStatus || 'pending_sync',
      lateAttemptCount: Number.isFinite(Number(patch.lateAttemptCount)) ? Number(patch.lateAttemptCount) : Number(existing.lateAttemptCount || 0),
      lateNextAttemptAt: patch.lateNextAttemptAt !== undefined ? patch.lateNextAttemptAt : (existing.lateNextAttemptAt ?? null),
      lateLastAttemptAt: patch.lateLastAttemptAt !== undefined ? patch.lateLastAttemptAt : (existing.lateLastAttemptAt ?? null),
      lateLastError: patch.lateLastError ?? existing.lateLastError ?? null,
      closeSyncStatus: patch.closeSyncStatus || existing.closeSyncStatus || 'pending_sync',
      closeAttemptCount: Number.isFinite(Number(patch.closeAttemptCount)) ? Number(patch.closeAttemptCount) : Number(existing.closeAttemptCount || 0),
      closeNextAttemptAt: patch.closeNextAttemptAt !== undefined ? patch.closeNextAttemptAt : (existing.closeNextAttemptAt ?? null),
      closeLastAttemptAt: patch.closeLastAttemptAt !== undefined ? patch.closeLastAttemptAt : (existing.closeLastAttemptAt ?? null),
      closeLastError: patch.closeLastError ?? existing.closeLastError ?? null
    };

    const nextSessionsByKey = {
      ...currentCache.sessionsByKey,
      [normalizedSessionKey]: nextSession,
      ...(resolvedSessionKey && resolvedSessionKey !== normalizedSessionKey ? { [resolvedSessionKey]: { ...nextSession, sessionKey: resolvedSessionKey } } : {})
    };

    const currentSessionKey = getSessionKeyForIdentity(currentSessionRef.current);
    const nextCurrentSession = currentSessionKey && (currentSessionKey === normalizedSessionKey || currentSessionKey === resolvedSessionKey)
      ? normalizeAttendanceWorkspaceSession({
        ...(currentSessionRef.current || {}),
        ...patch,
        sessionKey: resolvedSessionKey || normalizedSessionKey,
        localSessionId: patch.localSessionId ?? currentSessionRef.current?.localSessionId ?? existing.localSessionId ?? null,
        serverSessionId: patch.serverSessionId ?? currentSessionRef.current?.serverSessionId ?? existing.serverSessionId ?? null
      })
      : currentSessionRef.current;

    const nextCache = normalizeLocalAttendanceCache({
      ...currentCache,
      sessionsByKey: nextSessionsByKey,
      currentSession: nextCurrentSession,
      updatedAt: new Date().toISOString(),
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });

    appCacheRef.current = nextCache;
    if (nextCurrentSession) {
      setCurrentSession(nextCurrentSession);
    }
    void persistLocalAttendanceCache({
      sessionsByKey: nextSessionsByKey,
      currentSession: nextCurrentSession,
      updatedAt: nextCache.updatedAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    void scheduleLocalAttendanceReplay('session_state_updated', { immediate: true });
    return nextSession;
  }, [persistLocalAttendanceCache, scheduleLocalAttendanceReplay]);

  const recordSessionAlias = useCallback(async (localSessionKey: string, serverSessionKey: string, serverSessionId?: number | null) => {
    const normalizedLocalSessionKey = String(localSessionKey || '').trim();
    const normalizedServerSessionKey = String(serverSessionKey || '').trim();
    if (!normalizedLocalSessionKey || !normalizedServerSessionKey) {
      return null;
    }

    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const nextAliasMap = {
      ...(currentCache.sessionAliasMap || {}),
      [normalizedLocalSessionKey]: normalizedServerSessionKey
    };

    const localSession = currentCache.sessionsByKey?.[normalizedLocalSessionKey] || null;
    const nextSessionsByKey = {
      ...currentCache.sessionsByKey
    };
    const baseSession = localSession || currentSessionRef.current || null;
    const baseSessionData = (baseSession || {}) as Record<string, unknown>;
    const baseBatchName = String(baseSessionData.batch_id || baseSessionData.batchName || currentSessionRef.current?.batch_id || '').trim();
    const baseCreatedAt = String(baseSessionData.createdAt || baseSessionData.created_at || new Date().toISOString());
    const baseClosedAt = baseSessionData.closedAt ?? baseSessionData.closed_at ?? null;
    const baseStatus = String(baseSessionData.status || currentSessionRef.current?.status || localSession?.status || '').trim() === 'closed' ? 'closed' : 'open';
    const display = extractSessionDisplayMetadata(baseSessionData, baseBatchName);
    const nextLocalSession = buildCanonicalSession(
      normalizedLocalSessionKey,
      baseBatchName,
      Number(baseSessionData.session_id || 0) > 0 ? Number(baseSessionData.session_id) : null,
      {
        localSessionId: getSessionIdsFromKey(normalizedLocalSessionKey).localSessionId,
        serverSessionId: Number.isFinite(Number(serverSessionId)) ? Number(serverSessionId) : null,
        status: baseStatus,
        createdAt: baseCreatedAt,
        closedAt: baseClosedAt as string | null,
        syncStatus: 'synced',
        lastError: null,
        session_name: display.sessionName,
        sessionName: display.sessionName,
        column_name: display.columnName,
        columnName: display.columnName,
        title: display.title,
        displayName: display.displayName,
        name: display.name
      }
    );
    const nextServerSession = buildCanonicalSession(
      normalizedServerSessionKey,
      baseBatchName,
      Number.isFinite(Number(serverSessionId)) ? Number(serverSessionId) : null,
      {
        localSessionId: getSessionIdsFromKey(normalizedLocalSessionKey).localSessionId,
        serverSessionId: Number.isFinite(Number(serverSessionId)) ? Number(serverSessionId) : null,
        status: baseStatus,
        createdAt: baseCreatedAt,
        closedAt: baseClosedAt as string | null,
        syncStatus: 'synced',
        lastError: null,
        session_name: display.sessionName,
        sessionName: display.sessionName,
        column_name: display.columnName,
        columnName: display.columnName,
        title: display.title,
        displayName: display.displayName,
        name: display.name
      }
    );
    nextSessionsByKey[normalizedLocalSessionKey] = nextLocalSession;
    nextSessionsByKey[normalizedServerSessionKey] = nextServerSession;

    const currentMarksBySession = currentCache.attendanceMarksBySession || {};
    const localMarks = currentMarksBySession[normalizedLocalSessionKey] || {};
    const serverMarks = currentMarksBySession[normalizedServerSessionKey] || {};
    const nextServerMarks = {
      ...serverMarks
    };
    Object.values(localMarks).forEach((mark) => {
      if (!mark?.studentUid) return;
      nextServerMarks[mark.studentUid] = {
        ...mark,
        sessionKey: normalizedServerSessionKey
      };
    });
    const nextMarksBySession = {
      ...currentMarksBySession,
      [normalizedLocalSessionKey]: {
        ...localMarks
      },
      [normalizedServerSessionKey]: nextServerMarks
    };

    const nextQueue = (currentCache.syncQueue || []).map((item) => {
      if (item.sessionKey !== normalizedLocalSessionKey) return item;
      return {
        ...item,
        sessionKey: normalizedServerSessionKey
      };
    });

    const nextCurrentSession = normalizeAttendanceWorkspaceSession({
      ...(currentSessionRef.current || {}),
      session_id: Number.isFinite(Number(serverSessionId)) ? Number(serverSessionId) : (currentSessionRef.current?.session_id || 0),
      serverSessionId: Number.isFinite(Number(serverSessionId)) ? Number(serverSessionId) : currentSessionRef.current?.serverSessionId ?? null,
      localSessionId: getSessionIdsFromKey(normalizedLocalSessionKey).localSessionId,
      sessionKey: normalizedServerSessionKey,
      status: baseStatus,
      closed_at: baseStatus === 'closed' ? (baseClosedAt as string | null) || new Date().toISOString() : null,
      syncStatus: 'synced'
    });

    const nextCache = normalizeLocalAttendanceCache({
      ...currentCache,
      sessionAliasMap: nextAliasMap,
      sessionsByKey: nextSessionsByKey,
      attendanceMarksBySession: nextMarksBySession,
      syncQueue: nextQueue,
      currentSession: nextCurrentSession,
      updatedAt: new Date().toISOString(),
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });

    appCacheRef.current = nextCache;
    offlineAttendanceSessionKeyRef.current = normalizedLocalSessionKey;
    if (nextCurrentSession && nextCurrentSession.status !== 'closed') {
      setCurrentSession(nextCurrentSession);
      if (nextCurrentSession.batch_id && !attendanceBatch) {
        setAttendanceBatch(nextCurrentSession.batch_id);
      }
    }
    void persistLocalAttendanceCache({
      sessionAliasMap: nextAliasMap,
      sessionsByKey: nextSessionsByKey,
      attendanceMarksBySession: nextMarksBySession,
      syncQueue: nextQueue,
      currentSession: nextCurrentSession,
      updatedAt: nextCache.updatedAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    setAttendanceSessionCacheRevision((value) => value + 1);
    void scheduleLocalAttendanceReplay('session_alias_recorded', { immediate: true });
    return nextCurrentSession?.status === 'closed' ? null : nextCurrentSession;
  }, [attendanceBatch, persistLocalAttendanceCache, scheduleLocalAttendanceReplay]);

  const createLocalAttendanceSession = useCallback(async (batchName: string, sessionName: string) => {
    const normalizedBatchName = String(batchName || '').trim();
    const normalizedSessionName = String(sessionName || '').trim();
    if (!normalizedBatchName || !normalizedSessionName) return null;

    const localSessionId = createLocalSessionId();
    const localSessionKey = getLocalSessionKey(localSessionId);
    const createdAt = new Date().toISOString();
    const localSession = normalizeAttendanceWorkspaceSession({
      session_id: getLocalSessionNumericId(localSessionId),
      session_name: normalizedSessionName,
      batch_id: normalizedBatchName,
      column_name: normalizedSessionName,
      is_late: 0,
      sessionKey: localSessionKey,
      localSessionId,
      serverSessionId: null,
      syncStatus: 'pending_create',
      status: 'open',
      created_at: createdAt,
      closed_at: null
    });
    if (!localSession) return null;

    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const display = extractSessionDisplayMetadata({
      session_name: normalizedSessionName,
      sessionName: normalizedSessionName,
      column_name: normalizedSessionName,
      columnName: normalizedSessionName,
      title: normalizedSessionName,
      displayName: normalizedSessionName,
      name: normalizedSessionName,
      batch_id: normalizedBatchName,
      batchName: normalizedBatchName
    }, normalizedBatchName);
    const nextSessionsByKey = {
      ...currentCache.sessionsByKey,
      [localSessionKey]: buildCanonicalSession(localSessionKey, normalizedBatchName, null, {
        localSessionId,
        serverSessionId: null,
        status: 'open',
        createdAt,
        closedAt: null,
        syncStatus: 'pending_create',
        lastError: null,
        session_name: display.sessionName,
        sessionName: display.sessionName,
        column_name: display.columnName,
        columnName: display.columnName,
        title: display.title,
        displayName: display.displayName,
        name: display.name
      })
    };
    const nextCurrentSession = normalizeAttendanceWorkspaceSession({
      ...(currentSessionRef.current || {}),
      ...localSession,
      sessionKey: localSessionKey,
      localSessionId,
      serverSessionId: null,
      syncStatus: 'pending_create',
      status: 'open',
      created_at: createdAt,
      closed_at: null
    });
    const nextCache = normalizeLocalAttendanceCache({
      ...currentCache,
      currentSession: nextCurrentSession,
      sessionsByKey: nextSessionsByKey,
      syncQueue: [
        ...(currentCache.syncQueue || []).filter((item) =>
          item.queueKey !== `session_create:${localSessionKey}`
          && item.queueKey !== `late_mode:${localSessionKey}`
          && item.queueKey !== `close_session:${localSessionKey}`
        ),
        buildSessionQueueItem(localSessionKey, createdAt, 'session_create')
      ],
      updatedAt: createdAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });

    appCacheRef.current = nextCache;
    offlineAttendanceSessionKeyRef.current = localSessionKey;
    setCurrentSession(nextCurrentSession);
    setAttendanceBatch(normalizedBatchName);
    if (normalizedBatchName && !attendanceSessionName.trim()) {
      setAttendanceSessionName(normalizedSessionName);
    }
    void persistLocalAttendanceCache({
      currentSession: nextCurrentSession,
      sessionsByKey: nextSessionsByKey,
      syncQueue: [
        ...(currentCache.syncQueue || []).filter((item) =>
          item.queueKey !== `session_create:${localSessionKey}`
          && item.queueKey !== `late_mode:${localSessionKey}`
          && item.queueKey !== `close_session:${localSessionKey}`
        ),
        buildSessionQueueItem(localSessionKey, createdAt, 'session_create')
      ],
      updatedAt: createdAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    setAttendanceSessionCacheRevision((value) => value + 1);
    void scheduleLocalAttendanceReplay('local_session_created', { immediate: true });
    return nextCurrentSession;
  }, [attendanceSessionName, persistLocalAttendanceCache, scheduleLocalAttendanceReplay]);

  const updateCurrentAttendanceSession = useCallback(async (patch: Partial<AttendanceWorkspaceSession>) => {
    const current = normalizeAttendanceWorkspaceSession(currentSessionRef.current);
    if (!current) return null;
    const updated = normalizeAttendanceWorkspaceSession({
      ...current,
      ...patch,
      sessionKey: patch.sessionKey || current.sessionKey,
      localSessionId: patch.localSessionId ?? current.localSessionId ?? null,
      serverSessionId: patch.serverSessionId ?? current.serverSessionId ?? null
    });
    if (!updated) return null;

    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const sessionKey = getSessionKeyForIdentity(updated);
    const display = extractSessionDisplayMetadata(updated, updated.batch_id || current.batch_id || '');
    const nextSessionsByKey = {
      ...currentCache.sessionsByKey,
      ...(sessionKey ? {
        [sessionKey]: buildCanonicalSession(sessionKey, updated.batch_id || current.batch_id || '', updated.serverSessionId ?? updated.session_id, {
          localSessionId: updated.localSessionId ?? current.localSessionId ?? null,
          serverSessionId: updated.serverSessionId ?? current.serverSessionId ?? null,
          status: updated.status === 'closed' ? 'closed' : 'open',
          createdAt: updated.created_at || current.created_at || new Date().toISOString(),
          closedAt: updated.closed_at ?? current.closed_at ?? null,
          syncStatus: updated.syncStatus || (updated.serverSessionId ? 'synced' : 'pending_create'),
          lastError: null,
          session_name: display.sessionName,
          sessionName: display.sessionName,
          column_name: display.columnName,
          columnName: display.columnName,
          title: display.title,
          displayName: display.displayName,
          name: display.name
        })
      } : {})
    };
    const nextCache = normalizeLocalAttendanceCache({
      ...currentCache,
      currentSession: updated,
      sessionsByKey: nextSessionsByKey,
      syncQueue: [
        ...(currentCache.syncQueue || []).filter((item) => item.queueKey !== `late_mode:${sessionKey}` && item.queueKey !== `close_session:${sessionKey}`),
        ...(patch.is_late === 1 ? [buildSessionQueueItem(sessionKey, new Date().toISOString(), 'late_mode')] : []),
        ...(patch.status === 'closed' ? [buildSessionQueueItem(sessionKey, new Date().toISOString(), 'close_session')] : [])
      ],
      updatedAt: new Date().toISOString(),
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });

    appCacheRef.current = nextCache;
    if (sessionKey) {
      offlineAttendanceSessionKeyRef.current = sessionKey;
    }
    setCurrentSession(updated);
    void persistLocalAttendanceCache({
      currentSession: updated,
      sessionsByKey: nextSessionsByKey,
      syncQueue: [
        ...(currentCache.syncQueue || []).filter((item) => item.queueKey !== `late_mode:${sessionKey}` && item.queueKey !== `close_session:${sessionKey}`),
        ...(patch.is_late === 1 ? [buildSessionQueueItem(sessionKey, new Date().toISOString(), 'late_mode')] : []),
        ...(patch.status === 'closed' ? [buildSessionQueueItem(sessionKey, new Date().toISOString(), 'close_session')] : [])
      ],
      updatedAt: nextCache.updatedAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    setAttendanceSessionCacheRevision((value) => value + 1);
    return updated;
  }, [persistLocalAttendanceCache]);

  const syncLocalSessionToServer = useCallback(async (localSession: any) => {
    const normalizedSession = normalizeAttendanceWorkspaceSession(localSession);
    if (!normalizedSession) return null;
    const localSessionKey = getLocalSessionKey(normalizedSession.localSessionId) || getSessionKeyForIdentity(normalizedSession);
    if (!localSessionKey) return null;

    const resolvedSessionKey = resolveSessionKey(localSessionKey, appCacheRef.current.sessionAliasMap);
    if (resolvedSessionKey.startsWith('server:')) {
      const parsedServer = getSessionIdsFromKey(resolvedSessionKey);
      if (parsedServer.serverSessionId) {
        await recordSessionAlias(localSessionKey, resolvedSessionKey, parsedServer.serverSessionId);
      }
      return normalizeAttendanceWorkspaceSession({
        ...normalizedSession,
        sessionKey: resolvedSessionKey,
        session_id: parsedServer.serverSessionId || normalizedSession.session_id,
        serverSessionId: parsedServer.serverSessionId || normalizedSession.serverSessionId,
        status: normalizedSession.status === 'closed' ? 'closed' : 'open',
        closed_at: normalizedSession.status === 'closed' ? normalizedSession.closed_at || new Date().toISOString() : null,
        syncStatus: 'synced'
      });
    }

    const localSessionId = normalizedSession.localSessionId || getSessionIdsFromKey(localSessionKey).localSessionId;
    if (!localSessionId) return null;

    const requestBody = {
      local_session_id: localSessionId,
      batch_id: normalizedSession.batch_id,
      batch_name: normalizedSession.batch_id,
      session_name: normalizedSession.session_name,
      created_at: normalizedSession.created_at || new Date().toISOString(),
      client_device_id: deviceIdRef.current || await getOrCreateDeviceId()
    };
    const performRequest = async () => {
      let response: Response;
      try {
        response = await fetch(makeAbsoluteUrl(baseUrl, '/api/sync/sessions'), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
            ...(cookieRef.current ? { Cookie: cookieRef.current } : {})
          },
          body: JSON.stringify(requestBody)
        });
      } catch (error) {
        setOfflineMode(true);
        throw error;
      }

      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        cookieRef.current = mergeCookieHeaders(cookieRef.current, setCookie);
        setCookieHeader(cookieRef.current);
        await SecureStore.setItemAsync(STORAGE_COOKIE, cookieRef.current);
      }
      setOfflineMode(false);

      const { rawText, json } = await readResponseBodyText(response);
      const serverSessionId = extractSessionSyncServerSessionId(json);
      if (response.ok) {
        if (!serverSessionId) {
          throw new Error('Server session was not returned.');
        }
        const nextSession = await recordSessionAlias(localSessionKey, getServerSessionKey(serverSessionId), serverSessionId);
        void scheduleLocalAttendanceReplay('session_synced', { immediate: true });
        return nextSession || normalizeAttendanceWorkspaceSession({
          ...normalizedSession,
          sessionKey: getServerSessionKey(serverSessionId),
          session_id: serverSessionId,
          serverSessionId,
          status: normalizedSession.status === 'closed' ? 'closed' : 'open',
          closed_at: normalizedSession.status === 'closed' ? normalizedSession.closed_at || new Date().toISOString() : null,
          syncStatus: 'synced'
        });
      }

      if (response.status === 409) {
        if (serverSessionId) {
          const nextSession = await recordSessionAlias(localSessionKey, getServerSessionKey(serverSessionId), serverSessionId);
          void scheduleLocalAttendanceReplay('session_synced', { immediate: true });
          console.log('[AttendanceReplay] session 409 resolved with server id', {
            localSessionKey,
            serverSessionId,
            blocked: false
          });
          return nextSession || normalizeAttendanceWorkspaceSession({
            ...normalizedSession,
            sessionKey: getServerSessionKey(serverSessionId),
            session_id: serverSessionId,
            serverSessionId,
            status: normalizedSession.status === 'closed' ? 'closed' : 'open',
            closed_at: normalizedSession.status === 'closed' ? normalizedSession.closed_at || new Date().toISOString() : null,
            syncStatus: 'synced'
          });
        }

        const attemptCount = Number(normalizedSession.attemptCount || 0) + 1;
        await patchLocalSessionRecord(localSessionKey, {
          syncStatus: 'failed',
          lastError: SESSION_SYNC_CONFLICT_BLOCKED_ERROR,
          attemptCount,
          nextAttemptAt: null,
          lastAttemptAt: new Date().toISOString()
        }).catch(() => null);
        console.log('[AttendanceReplay] session 409 blocked', {
          localSessionKey,
          serverSessionId: null,
          blocked: true,
          attemptCount
        });
        return null;
      }

      if (!response.ok) {
        let detail = rawText.trim();
        if (detail) {
          try {
            const parsed = JSON.parse(detail);
            detail = String(parsed?.error || parsed?.message || detail || '').trim() || detail;
          } catch {
            detail = detail.replace(/\s+/g, ' ').trim();
          }
        }
        throw new Error(detail ? `API Error: ${response.status} - ${detail}` : `API Error: ${response.status}`);
      }

      return null;
    };

    return performRequest();
  }, [baseUrl, cookieRef, patchLocalSessionRecord, recordSessionAlias, scheduleLocalAttendanceReplay]);

  const syncAttendanceMarksForSession = useCallback(async (sessionKey: string) => {
    const normalizedBaseKey = String(sessionKey || '').trim();
    if (!normalizedBaseKey) return { accepted: [] as any[], duplicates: [] as any[], rejected: [] as any[] };

    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const resolvedSessionKey = resolveSessionKey(normalizedBaseKey, currentCache.sessionAliasMap);
    const sessionRecord = currentCache.sessionsByKey?.[normalizedBaseKey]
      || currentCache.sessionsByKey?.[resolvedSessionKey]
      || null;
    if (!sessionRecord) {
      return { accepted: [], duplicates: [], rejected: [] };
    }
    if (isSessionSyncConflictBlocked(sessionRecord) && !sessionRecord.serverSessionId) {
      console.log('[AttendanceReplay] mark sync skipped for blocked session', {
        sessionKey: normalizedBaseKey,
        resolvedSessionKey
      });
      return { accepted: [], duplicates: [], rejected: [] };
    }

    const currentSessionRecord = normalizeAttendanceWorkspaceSession({
      ...(currentSessionRef.current || {}),
      sessionKey: sessionRecord.sessionKey || resolvedSessionKey,
      session_id: Number(sessionRecord.serverSessionId || currentSessionRef.current?.session_id || 0),
      serverSessionId: Number.isFinite(Number(sessionRecord.serverSessionId || currentSessionRef.current?.serverSessionId || 0))
        && Number(sessionRecord.serverSessionId || currentSessionRef.current?.serverSessionId || 0) > 0
        ? Number(sessionRecord.serverSessionId || currentSessionRef.current?.serverSessionId || 0)
        : null,
      localSessionId: sessionRecord.localSessionId || currentSessionRef.current?.localSessionId || null,
      batch_id: sessionRecord.batchName || currentSessionRef.current?.batch_id || '',
      ...extractSessionDisplayMetadata(currentSessionRef.current || sessionRecord || {}, sessionRecord.batchName || currentSessionRef.current?.batch_id || ''),
      created_at: sessionRecord.createdAt || currentSessionRef.current?.created_at || new Date().toISOString(),
      syncStatus: currentSessionRef.current?.syncStatus || sessionRecord.syncStatus || 'pending_sync'
    });
    if (!currentSessionRecord) return { accepted: [], duplicates: [], rejected: [] };
    if (currentSessionRecord.status === 'closed' && !currentSessionRecord.serverSessionId) {
      return { accepted: [], duplicates: [], rejected: [] };
    }

    const syncedSession = currentSessionRecord.serverSessionId
      ? currentSessionRecord
      : await syncLocalSessionToServer(currentSessionRecord);
    if (!syncedSession?.serverSessionId) {
      return { accepted: [], duplicates: [], rejected: [] };
    }

    const localSessionKey = getLocalSessionKey(syncedSession.localSessionId) || normalizedBaseKey;
    const sessionMarks = currentCache.attendanceMarksBySession?.[localSessionKey] || {};
    const marks = Object.values(sessionMarks)
      .filter((mark) => (mark?.status === 'present' || mark?.status === 'late') && mark.syncStatus !== 'synced' && isReplayDue(mark.nextAttemptAt))
      .map((mark) => ({
        mark_key: mark.markKey,
        student_uid: mark.studentUid,
        status: mark.status,
        marked_at: mark.markedAt
      }));

    if (!marks.length) {
      return { accepted: [], duplicates: [], rejected: [] };
    }

    const response = await apiJson<{ status: string; accepted: Array<{ mark_key: string; student_uid: string; server_status: 'present' | 'late' }>; duplicates: Array<{ mark_key: string; student_uid: string; server_status: 'present' | 'late' }>; rejected: Array<{ mark_key: string; student_uid: string; reason: string }> }>(
      '/api/sync/attendance-marks',
      {
        method: 'POST',
        body: JSON.stringify({
          local_session_id: syncedSession.localSessionId || localSessionKey.replace(/^local:/, ''),
          server_session_id: syncedSession.serverSessionId || syncedSession.session_id,
          client_device_id: deviceIdRef.current || await getOrCreateDeviceId(),
          marks
        })
      }
    );

    const acceptedKeys = new Set((response.accepted || []).map((item) => String(item.mark_key || '').trim()).filter(Boolean));
    const duplicateKeys = new Set((response.duplicates || []).map((item) => String(item.mark_key || '').trim()).filter(Boolean));
    const rejectedMap = new Map((response.rejected || []).map((item) => [String(item.mark_key || '').trim(), String(item.reason || 'Could not save attendance mark.')] as const));

    for (const mark of Object.values(sessionMarks)) {
      if (!mark?.markKey) continue;
      if (acceptedKeys.has(mark.markKey) || duplicateKeys.has(mark.markKey)) {
        await patchLocalAttendanceMark(localSessionKey, mark.studentUid, {
          syncStatus: 'synced',
          lastError: null,
          attemptCount: 0,
          nextAttemptAt: null,
          lastAttemptAt: new Date().toISOString()
        }).catch(() => null);
      } else if (rejectedMap.has(mark.markKey)) {
        await patchLocalAttendanceMark(localSessionKey, mark.studentUid, {
          syncStatus: 'failed',
          lastError: rejectedMap.get(mark.markKey) || 'Could not save attendance mark.',
          lastAttemptAt: new Date().toISOString()
        }).catch(() => null);
      }
    }

    void scheduleLocalAttendanceReplay('marks_synced', { immediate: true });
    return response;
  }, [patchLocalAttendanceMark, scheduleLocalAttendanceReplay, syncLocalSessionToServer]);

  const getLocalAttendanceReplayPlan = useCallback(() => {
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    let nextAttemptAt: number | null = null;
    let hasPending = false;
    const blockedSessionKeys = new Set<string>();

    const considerAttempt = (attemptStatus: string | undefined, attemptCount?: number, dueAt?: string | null) => {
      if (attemptStatus === 'synced' || attemptStatus === 'failed' && !dueAt) return;
      if (attemptStatus !== 'pending_create' && attemptStatus !== 'pending_sync' && attemptStatus !== 'failed') return;
      hasPending = true;
      const parsed = dueAt ? Date.parse(dueAt) : Date.now();
      if (!Number.isFinite(parsed)) return;
      nextAttemptAt = nextAttemptAt === null ? parsed : Math.min(nextAttemptAt, parsed);
      void attemptCount;
    };

    Object.values(currentCache.sessionsByKey || {})
      .filter((session) => Boolean(session?.localSessionId || session?.serverSessionId))
      .forEach((session) => {
        if (isSessionSyncConflictBlocked(session) && !session.serverSessionId) {
          const sessionKey = String(session.sessionKey || '').trim();
          const localSessionKey = session.localSessionId ? getLocalSessionKey(session.localSessionId) : '';
          if (sessionKey) blockedSessionKeys.add(sessionKey);
          if (localSessionKey) blockedSessionKeys.add(localSessionKey);
          return;
        }
        considerAttempt(session.syncStatus, session.attemptCount, session.nextAttemptAt);
        if (session.is_late === 1) {
          considerAttempt(session.lateSyncStatus, session.lateAttemptCount, session.lateNextAttemptAt);
        }
        if (session.status === 'closed') {
          considerAttempt(session.closeSyncStatus, session.closeAttemptCount, session.closeNextAttemptAt);
        }
      });

    Object.values(currentCache.attendanceMarksBySession || {})
      .forEach((sessionMarks) => {
        Object.values(sessionMarks || {}).forEach((mark) => {
          if (!mark || (mark.status !== 'present' && mark.status !== 'late')) return;
          const resolvedMarkSessionKey = resolveSessionKey(String(mark.sessionKey || '').trim(), currentCache.sessionAliasMap);
          if (blockedSessionKeys.has(String(mark.sessionKey || '').trim()) || blockedSessionKeys.has(resolvedMarkSessionKey)) {
            return;
          }
          considerAttempt(mark.syncStatus, mark.attemptCount, mark.nextAttemptAt);
        });
      });

    return { hasPending, nextAttemptAt };
  }, []);

  const processLocalAttendanceReplayQueue = useCallback(async (reason: string) => {
    if (localAttendanceReplayInFlightRef.current) return;
    localAttendanceReplayInFlightRef.current = true;
    try {
      let currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
      const sessions = Object.values(currentCache.sessionsByKey || {})
        .filter((session) => Boolean(session?.localSessionId || session?.serverSessionId))
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

      for (const session of sessions) {
        if (!session?.localSessionId && !session?.serverSessionId) continue;
        const localSessionKey = getLocalSessionKey(session.localSessionId) || session.sessionKey;
        if (!localSessionKey) continue;

        currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
        const resolvedSessionKey = resolveSessionKey(localSessionKey, currentCache.sessionAliasMap);
        if (isSessionSyncConflictBlocked(session) && !session.serverSessionId) {
          console.log('[AttendanceReplay] replay skipped blocked session', {
            reason,
            localSessionKey,
            resolvedSessionKey
          });
          continue;
        }
        const serverSessionId = Number(session.serverSessionId || 0);
        const sessionNeedsSync = !resolvedSessionKey.startsWith('server:') && session.syncStatus !== 'synced';
        const sessionDue = sessionNeedsSync && isReplayDue(session.nextAttemptAt);

        if (sessionNeedsSync && sessionDue) {
          try {
            const syncedSession = await syncLocalSessionToServer({
              ...session,
              sessionKey: localSessionKey,
              localSessionId: session.localSessionId,
              serverSessionId: Number.isFinite(serverSessionId) && serverSessionId > 0 ? serverSessionId : null
            });
            if (syncedSession?.serverSessionId) {
              await patchLocalSessionRecord(localSessionKey, {
                syncStatus: 'synced',
                lastError: null,
                attemptCount: 0,
                nextAttemptAt: null,
                lastAttemptAt: new Date().toISOString()
              }).catch(() => null);
            }
          } catch (error) {
            const retryable = isRetryableReplayError(error);
            const attemptCount = Number(session.attemptCount || 0) + 1;
            await patchLocalSessionRecord(localSessionKey, {
              syncStatus: retryable ? 'pending_create' : 'failed',
              lastError: getReplayErrorMessage(error, 'Could not save attendance.'),
              attemptCount,
              nextAttemptAt: retryable ? getReplayBackoffDeadline(attemptCount) : null,
              lastAttemptAt: new Date().toISOString()
            }).catch(() => null);
            if (retryable) break;
            continue;
          }
        } else if (resolvedSessionKey.startsWith('server:') && session.syncStatus !== 'synced') {
          await recordSessionAlias(localSessionKey, resolvedSessionKey, Number(getSessionIdsFromKey(resolvedSessionKey).serverSessionId || session.serverSessionId || 0)).catch(() => null);
          await patchLocalSessionRecord(localSessionKey, {
            syncStatus: 'synced',
            lastError: null,
            attemptCount: 0,
            nextAttemptAt: null,
            lastAttemptAt: new Date().toISOString()
          }).catch(() => null);
        }

        currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
        const resolvedAfterAlias = resolveSessionKey(localSessionKey, currentCache.sessionAliasMap);
        const syncedSessionRecord = currentCache.sessionsByKey?.[resolvedAfterAlias] || currentCache.sessionsByKey?.[localSessionKey] || session;
        const syncedSession = normalizeAttendanceWorkspaceSession({
          ...(currentSessionRef.current || {}),
          ...(syncedSessionRecord || {}),
          sessionKey: resolvedAfterAlias,
          localSessionId: syncedSessionRecord.localSessionId || session.localSessionId,
          serverSessionId: syncedSessionRecord.serverSessionId ?? session.serverSessionId ?? null,
          session_id: Number(syncedSessionRecord.serverSessionId || session.serverSessionId || currentSessionRef.current?.session_id || 0),
          syncStatus: syncedSessionRecord.syncStatus || session.syncStatus
        });

        if (!syncedSession?.serverSessionId && !resolvedAfterAlias.startsWith('server:')) {
          continue;
        }

        const markBucket = (currentCache.attendanceMarksBySession || {})[localSessionKey] || {};
        const pendingMarks = Object.values(markBucket).filter((mark) => (
          (mark.status === 'present' || mark.status === 'late')
          && mark.syncStatus !== 'synced'
          && isReplayDue(mark.nextAttemptAt)
        ));
        if (pendingMarks.length) {
          try {
            await syncAttendanceMarksForSession(localSessionKey);
          } catch (error) {
            const retryable = isRetryableReplayError(error);
            const attemptCount = Number(pendingMarks[0]?.attemptCount || 0) + 1;
            const nextAttemptAt = retryable ? getReplayBackoffDeadline(attemptCount) : null;
            for (const mark of pendingMarks) {
              await patchLocalAttendanceMark(localSessionKey, mark.studentUid, {
                syncStatus: retryable ? 'pending_sync' : 'failed',
                lastError: getReplayErrorMessage(error, 'Could not save attendance.'),
                attemptCount,
                nextAttemptAt,
                lastAttemptAt: new Date().toISOString()
              }).catch(() => null);
            }
            if (retryable) break;
          }
        }

        currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
        const latestSession = currentCache.sessionsByKey?.[resolvedAfterAlias] || currentCache.sessionsByKey?.[localSessionKey] || syncedSessionRecord;

        if (latestSession?.is_late === 1 && latestSession.lateSyncStatus !== 'synced' && isReplayDue(latestSession.lateNextAttemptAt)) {
          try {
            const serverId = Number(latestSession.serverSessionId || latestSession.session_id || 0);
            if (serverId > 0) {
              await apiJson(`/api/sessions/${serverId}/late`, { method: 'POST' });
              await patchLocalSessionRecord(localSessionKey, {
                lateSyncStatus: 'synced',
                lateLastError: null,
                lateAttemptCount: 0,
                lateNextAttemptAt: null,
                lateLastAttemptAt: new Date().toISOString()
              }).catch(() => null);
            }
          } catch (error) {
            const retryable = isRetryableReplayError(error);
            const attemptCount = Number(latestSession.lateAttemptCount || 0) + 1;
            await patchLocalSessionRecord(localSessionKey, {
              lateSyncStatus: retryable ? 'pending_sync' : 'failed',
              lateLastError: getReplayErrorMessage(error, 'Could not save attendance.'),
              lateAttemptCount: attemptCount,
              lateNextAttemptAt: retryable ? getReplayBackoffDeadline(attemptCount) : null,
              lateLastAttemptAt: new Date().toISOString()
            }).catch(() => null);
            if (retryable) break;
          }
        }

        currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
        const closedSession = currentCache.sessionsByKey?.[resolvedAfterAlias] || currentCache.sessionsByKey?.[localSessionKey] || latestSession;
        if (closedSession?.status === 'closed' && closedSession.closeSyncStatus !== 'synced' && isReplayDue(closedSession.closeNextAttemptAt)) {
          try {
            const serverId = Number(closedSession.serverSessionId || closedSession.session_id || 0);
            if (serverId > 0) {
              await apiJson('/api/sessions/close', {
                method: 'POST',
                body: JSON.stringify({ session_id: serverId })
              });
              await patchLocalSessionRecord(localSessionKey, {
                closeSyncStatus: 'synced',
                closeLastError: null,
                closeAttemptCount: 0,
                closeNextAttemptAt: null,
                closeLastAttemptAt: new Date().toISOString()
              }).catch(() => null);
              if (getSessionKeyForIdentity(currentSessionRef.current) === localSessionKey || getSessionKeyForIdentity(currentSessionRef.current) === resolvedAfterAlias) {
                setCurrentSession(null);
                setAttendanceSessionName('');
              }
            }
          } catch (error) {
            const retryable = isRetryableReplayError(error);
            const attemptCount = Number(closedSession.closeAttemptCount || 0) + 1;
            await patchLocalSessionRecord(localSessionKey, {
              closeSyncStatus: retryable ? 'pending_sync' : 'failed',
              closeLastError: getReplayErrorMessage(error, 'Could not save attendance.'),
              closeAttemptCount: attemptCount,
              closeNextAttemptAt: retryable ? getReplayBackoffDeadline(attemptCount) : null,
              closeLastAttemptAt: new Date().toISOString()
            }).catch(() => null);
            if (retryable) break;
          }
        }
      }

      void reason;
    } finally {
      localAttendanceReplayInFlightRef.current = false;
      const plan = getLocalAttendanceReplayPlan();
      if (plan.hasPending) {
        void scheduleLocalAttendanceReplay('replay_backoff');
      }
    }
  }, [apiJson, getLocalAttendanceReplayPlan, patchLocalAttendanceMark, patchLocalSessionRecord, scheduleLocalAttendanceReplay, syncAttendanceMarksForSession, syncLocalSessionToServer]);

  scheduleLocalAttendanceReplayRef.current = useCallback((reason: string, options?: { immediate?: boolean }) => {
    const plan = getLocalAttendanceReplayPlan();
    if (!plan.hasPending) {
      if (localAttendanceReplayTimerRef.current) {
        clearTimeout(localAttendanceReplayTimerRef.current);
        localAttendanceReplayTimerRef.current = null;
      }
      return false;
    }

    if (localAttendanceReplayTimerRef.current) {
      clearTimeout(localAttendanceReplayTimerRef.current);
      localAttendanceReplayTimerRef.current = null;
    }

    const now = Date.now();
    const dueInMs = plan.nextAttemptAt ? Math.max(0, plan.nextAttemptAt - now) : 0;
    const delay = options?.immediate ? 200 : Math.max(200, dueInMs);
    console.log('[AttendanceReplay] schedule', {
      reason,
      immediate: Boolean(options?.immediate),
      hasPending: plan.hasPending,
      nextAttemptAt: plan.nextAttemptAt,
      inFlight: localAttendanceReplayInFlightRef.current,
      delay
    });

    localAttendanceReplayTimerRef.current = setTimeout(() => {
      localAttendanceReplayTimerRef.current = null;
      void processLocalAttendanceReplayQueue(reason).catch(() => null);
    }, delay);

    return true;
  }, [getLocalAttendanceReplayPlan, processLocalAttendanceReplayQueue]);

  const applyMobileManifest = useCallback((payload: MobileManifestPayload | null, options?: { commitConfig?: boolean; persist?: boolean }) => {
    if (!payload?.app) return { updateAvailable: false, forceUpdate: false };
    const commitConfig = options?.commitConfig !== false;

    const nextConfig: MobileAppConfig = commitConfig
      ? {
        ...DEFAULT_MOBILE_CONFIG,
        ...(payload.app.config && typeof payload.app.config === 'object' ? payload.app.config : {})
      }
      : mobileConfig;
    const nextFeed = Array.isArray(payload.feed?.items) ? payload.feed.items : [];
    const nextManifest: MobileManifestPayload = {
      ...payload,
      app: {
        ...payload.app,
        version: payload.app.version || APP_VERSION,
        min_version: payload.app.min_version || payload.app.version || APP_VERSION,
        apk_version: payload.app.apk_version || payload.app.version || APP_VERSION,
        apk_min_version: payload.app.apk_min_version || payload.app.min_version || payload.app.version || APP_VERSION,
        update_mode: payload.app.update_mode || 'none',
        force_update: Boolean(payload.app.force_update),
        apk_url: payload.app.apk_url || '/apk/rmc-mobile.apk',
        config_version: Number(payload.app.config_version || 1) || 1,
        release_notes: Array.isArray(payload.app.release_notes)
          ? payload.app.release_notes.map((note) => String(note ?? '').trim()).filter(Boolean)
          : [],
        config: nextConfig
      },
      feed: {
        ...(payload.feed || {}),
        items: nextFeed
      }
    };
    const localConfigVersion = Number(appCacheRef.current.mobileManifest?.app.config_version || 0) || 0;
    const appliedConfigVersion = Math.max(
      Number(staffOtaAppliedConfigVersion || 0) || 0,
      Number(appCacheRef.current.staffOtaAppliedConfigVersion || 0) || 0,
      Number(staffOtaAppliedConfigVersionRef.current || 0) || 0
    );
    const remoteConfigVersion = Number(nextManifest.app.config_version || 1) || 1;
    const staffOtaUpdateAvailable = sessionRef.current?.type === 'staff'
      && isStaffOtaUpdateMode(nextManifest.app.update_mode)
      && remoteConfigVersion > Math.max(localConfigVersion, appliedConfigVersion);
    const apkUpdateAvailable = isApkUpdateAvailable(APP_VERSION, nextManifest.app);
    const updateAvailable = staffOtaUpdateAvailable || apkUpdateAvailable;
    console.log('[MobileManifest] decision ' + JSON.stringify({
      remoteConfigVersion,
      localConfigVersion,
      appliedConfigVersion,
      staffOtaUpdateAvailable,
      apkUpdateAvailable,
      commitConfig
    }));
    const nextPromptApp: MobileManifestPayload['app'] | null = staffOtaUpdateAvailable
      ? nextManifest.app
      : apkUpdateAvailable
        ? {
          ...nextManifest.app,
          update_mode: 'apk' as MobileUpdateMode,
          version: nextManifest.app.apk_version || nextManifest.app.version || APP_VERSION,
          min_version: nextManifest.app.apk_min_version || nextManifest.app.min_version || nextManifest.app.version || APP_VERSION
        }
        : null;
    setMobileManifest(nextManifest);
    setMobileFeed(nextFeed);
    setMobileManifestCheckedAt(nextManifest.checked_at || new Date().toISOString());
    setPendingMobileManifest(staffOtaUpdateAvailable ? nextManifest : null);
    if (commitConfig) {
      setMobileConfig(nextConfig);
    }
    setMobileUpdatePrompt(nextPromptApp);
    if (commitConfig && options?.persist !== false) {
      appCacheRef.current = {
        ...appCacheRef.current,
        mobileManifest: nextManifest,
        mobileConfig: nextConfig,
        mobileFeed: nextFeed
      };
      void persistAppCache({
        mobileManifest: nextManifest,
        mobileConfig: nextConfig,
        mobileFeed: nextFeed
      });
    }
    return {
      updateAvailable,
      forceUpdate: Boolean(nextManifest.app.force_update),
      staffOtaUpdateAvailable,
      apkUpdateAvailable
    };
  }, [appCacheRef, mobileConfig, persistAppCache, staffOtaAppliedConfigVersion]);

  const getCachedResource = useCallback(<T,>(key: string) => {
    return resourceCacheRef.current[key] as CachedResourceEntry<T> | undefined;
  }, []);

  const setCachedResource = useCallback(async <T,>(key: string, data: T) => {
    const next = { savedAt: Date.now(), data };
    resourceCacheRef.current = {
      ...resourceCacheRef.current,
      [key]: next
    };
    await persistAppCache({ resourceCache: resourceCacheRef.current });
    return data;
  }, [persistAppCache]);

  const invalidateCachedResource = useCallback((key: string) => {
    if (!resourceCacheRef.current[key]) return;
    const next = { ...resourceCacheRef.current };
    delete next[key];
    resourceCacheRef.current = next;
    void persistAppCache({ resourceCache: next });
  }, [persistAppCache]);

  useEffect(() => {
    uiSnapshotRef.current = {
      attendanceBatch,
      studentBatchFilter,
      reportBatch,
      doubtBatchFilter,
      testBatch,
      smsBatch,
      selectedLaunchId,
      selectedPaperId,
      selectedAbsenteeSessionId,
      selectedScoreboardLaunchId,
      studentTab,
      staffTab,
      staffNotificationSection
    };
  }, [
    attendanceBatch,
    studentBatchFilter,
    reportBatch,
    doubtBatchFilter,
    testBatch,
    smsBatch,
    selectedLaunchId,
    selectedPaperId,
    selectedAbsenteeSessionId,
    selectedScoreboardLaunchId,
    studentTab,
    staffTab,
    staffNotificationSection
  ]);

  apiJson = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const execute = async (): Promise<T> => {
        let response: Response;
        // Abort the request if the server doesn't respond in time, so a dead/slow
        // network surfaces as an error (and offline mode) instead of hanging forever.
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
        try {
          response = await fetch(makeAbsoluteUrl(baseUrl, path), {
            ...options,
            credentials: 'include',
            signal: options?.signal ?? controller?.signal ?? undefined,
            headers: {
              'Cache-Control': 'no-cache',
              ...options?.headers,
              'Content-Type': 'application/json',
              ...(cookieRef.current ? { Cookie: cookieRef.current } : {})
            }
          });
        } catch (error) {
          setOfflineMode(true);
          throw error;
        } finally {
          if (timer) clearTimeout(timer);
        }
        try {
          const setCookie = response.headers.get('set-cookie');
          if (setCookie) {
            cookieRef.current = mergeCookieHeaders(cookieRef.current, setCookie);
            setCookieHeader(cookieRef.current);
            await SecureStore.setItemAsync(STORAGE_COOKIE, cookieRef.current);
          }
          setOfflineMode(false);
          if (!response.ok) {
            const responseText = await response.text().catch(() => '');
            let detail = responseText.trim();
            if (detail) {
              try {
                const parsed = JSON.parse(detail);
                detail = String(parsed?.error || parsed?.message || detail || '').trim() || detail;
              } catch {
                detail = detail.replace(/\s+/g, ' ').trim();
              }
            }
            throw new Error(detail ? `API Error: ${response.status} - ${detail}` : `API Error: ${response.status}`);
          }
          return response.json();
        } catch (error) {
          throw error;
        }
      };

      try {
        return await execute();
      } catch (error) {
        const apiStatus = extractApiStatus(error);
        const canRecover = apiStatus === 401 || apiStatus === 403;
        if (canRecover && sessionRef.current?.type === 'staff' && await recoverStaffSessionRef.current().catch(() => false)) {
          return execute();
        }
        throw error;
      }
    }, [baseUrl]);

  const apiUpload = useCallback(async <T,>(path: string, formData: FormData): Promise<T> => {
      const execute = async (): Promise<T> => {
        let response: Response;
        // Longer ceiling than apiJson: uploads carry image payloads on slow links.
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 60000) : null;
        try {
          response = await fetch(makeAbsoluteUrl(baseUrl, path), {
            method: 'POST',
            credentials: 'include',
            body: formData,
            signal: controller?.signal ?? undefined,
            headers: {
              'Cache-Control': 'no-cache',
              ...(cookieRef.current ? { Cookie: cookieRef.current } : {})
            }
          });
        } catch (error) {
          setOfflineMode(true);
          throw error;
        } finally {
          if (timer) clearTimeout(timer);
        }
        const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        cookieRef.current = mergeCookieHeaders(cookieRef.current, setCookie);
        setCookieHeader(cookieRef.current);
        await SecureStore.setItemAsync(STORAGE_COOKIE, cookieRef.current);
      }
      setOfflineMode(false);
      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        let detail = responseText.trim();
        if (detail) {
          try {
            const parsed = JSON.parse(detail);
            detail = String(parsed?.error || parsed?.message || detail || '').trim() || detail;
          } catch {
            detail = detail.replace(/\s+/g, ' ').trim();
          }
        }
        throw new Error(detail ? `Upload Error: ${response.status} - ${detail}` : `Upload Error: ${response.status}`);
      }
      return response.json();
    };

      try {
        return await execute();
      } catch (error) {
        const apiStatus = extractApiStatus(error);
        const canRecover = apiStatus === 401 || apiStatus === 403;
        if (canRecover && sessionRef.current?.type === 'staff' && await recoverStaffSessionRef.current().catch(() => false)) {
          return execute();
        }
        throw error;
      }
    }, [baseUrl]);

  const loadCachedJson = useCallback(async <T,>(
    key: string,
    path: string,
    options?: { force?: boolean; ttlMs?: number; transform?: (payload: any) => T }
  ): Promise<T> => {
    const ttlMs = options?.ttlMs ?? RESOURCE_CACHE_TTL_MS;
    const cached = getCachedResource<T>(key);
    const freshEnough = cached && Date.now() - cached.savedAt <= ttlMs;
    const inFlightKey = `${key}::${path}`;
    if (resourceFetchInFlightRef.current[inFlightKey]) {
      return resourceFetchInFlightRef.current[inFlightKey] as Promise<T>;
    }
    if (freshEnough && !options?.force) {
      return cached.data;
    }
    try {
      const pending = (async () => {
        const payload = await apiJson<any>(path);
        const next = options?.transform ? options.transform(payload) : payload;
        await setCachedResource(key, next);
        return next;
      })();
      resourceFetchInFlightRef.current[inFlightKey] = pending;
      return await pending;
    } catch (error) {
      const apiStatus = extractApiStatus(error);
      const isAuthError = apiStatus === 401 || apiStatus === 403;
      if (isAuthError) {
        throw error;
      }
      if (cached) {
        if (!(error instanceof Error && error.message.startsWith('API Error:'))) {
          setOfflineMode(true);
        }
        return cached.data;
      }
      throw error;
    } finally {
      delete resourceFetchInFlightRef.current[inFlightKey];
    }
  }, [apiJson, getCachedResource, setCachedResource]);

  const ensureMobilePushChannel = useCallback(async () => {
    if (Platform.OS !== 'android' || mobilePushChannelReadyRef.current) {
      return;
    }
    await Notifications.setNotificationChannelAsync(MOBILE_ALERT_CHANNEL_ID, {
      name: 'RMC Updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
    });
    mobilePushChannelReadyRef.current = true;
  }, []);

  const registerMobilePushToken = useCallback(async (nextSession: SessionInfo | null, roleOverride?: 'device') => {
    if (shouldSkipPushRegistration()) {
      return;
    }
    await ensureMobilePushChannel();

    const permission = await Notifications.getPermissionsAsync();
    let permissionStatus = permission.status;
    if (permissionStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      permissionStatus = requested.status;
    }
    if (permissionStatus !== 'granted') {
      return;
    }

    const tokenResponse = Platform.OS === 'android'
      ? await Notifications.getDevicePushTokenAsync()
      : await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID });
    const pushToken = String(tokenResponse.data || '').trim();
    if (!pushToken) {
      return;
    }

    const role = roleOverride || nextSession?.type;
    if (!role) {
      return;
    }

    const ownerKey = role === 'staff'
      ? String(nextSession && nextSession.type === 'staff' ? (nextSession.user.username || nextSession.user.id || '') : '')
      : role === 'student'
        ? String(nextSession && nextSession.type === 'student' ? (nextSession.student.student_uid || '') : '')
        : `device:${pushToken.slice(0, 48)}`;
    const registrationKey = `${role}:${ownerKey}:${pushToken}`;
    if (mobilePushRegistrationRef.current === registrationKey) {
      return;
    }
    if (mobilePushRegistrationInFlightRef.current === registrationKey) {
      return;
    }

    const batchNames = role === 'student' && nextSession && nextSession.type === 'student'
      ? Array.from(new Set([
          ...splitBatchNames(nextSession.student.batch_name || ''),
          ...splitBatchNames(nextSession.student.system_batches || nextSession.student.batches || '')
        ]))
      : [];

    mobilePushRegistrationInFlightRef.current = registrationKey;
    try {
      await apiJson<{ status: string }>('/api/mobile/push/register', {
        method: 'POST',
        body: JSON.stringify({
          role,
          owner_key: ownerKey,
          owner_label: role === 'device'
            ? 'App Device'
            : role === 'staff' && nextSession && nextSession.type === 'staff'
              ? String(nextSession.user.full_name || nextSession.user.username || 'Staff')
              : role === 'student' && nextSession && nextSession.type === 'student'
                ? String(nextSession.student.name || nextSession.student.student_uid || 'Student')
                : role === 'staff'
                  ? 'Staff'
                  : 'Student',
          token: pushToken,
          push_provider: Platform.OS === 'android' ? 'fcm' : 'expo',
          platform: Platform.OS,
          device_name: Platform.OS,
          app_version: APP_VERSION,
          config_version: Math.max(
            Number(appCacheRef.current.mobileManifest?.app.config_version || 0) || 0,
            Number(appCacheRef.current.staffOtaAppliedConfigVersion || 0) || 0,
            Number(staffOtaAppliedConfigVersionRef.current || 0) || 0
          ),
          batch_names: batchNames
        })
      });

      mobilePushRegistrationRef.current = registrationKey;
    } finally {
      if (mobilePushRegistrationInFlightRef.current === registrationKey) {
        mobilePushRegistrationInFlightRef.current = '';
      }
    }
  }, [apiJson, ensureMobilePushChannel]);

  const showLiveNotification = useCallback(async (title: string, body: string, data: Record<string, unknown> = {}) => {
    const cleanTitle = String(title || 'RMC Mobile').trim() || 'RMC Mobile';
    const cleanBody = String(body || '').trim();
    const notificationKey = `${cleanTitle}::${cleanBody}`;
    const now = Date.now();
    if (liveNotificationDedupRef.current.key === notificationKey && (now - liveNotificationDedupRef.current.at) < 10000) {
      return;
    }
    liveNotificationDedupRef.current = { key: notificationKey, at: now };
    try {
      console.log('[Push] Scheduling local notification:', cleanTitle);
      await ensureMobilePushChannel();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: cleanTitle,
          body: cleanBody,
          data,
          sound: 'default',
          channelId: MOBILE_ALERT_CHANNEL_ID
        },
        trigger: null
      } as any);
    } catch (error) {
      console.warn('[Notifications] Local alert failed:', error);
    }
  }, [ensureMobilePushChannel]);

  const requestNotificationPermission = useCallback(async () => {
    try {
      await ensureMobilePushChannel();
      const permission = await Notifications.getPermissionsAsync();
      if (permission.status === 'granted') {
        console.log('[Push] Notification permission already granted');
        return true;
      }
      const requested = await Notifications.requestPermissionsAsync();
      console.log('[Push] Notification permission status:', requested.status);
      return requested.status === 'granted';
    } catch (error) {
      console.warn('[Notifications] Permission preflight failed:', error);
      return false;
    }
  }, [ensureMobilePushChannel]);

  const persistCookie = useCallback(async (value: string) => {
    cookieRef.current = value;
    setCookieHeader(value);
    await SecureStore.setItemAsync(STORAGE_COOKIE, value);
  }, []);

  const staffSessionRecoveryInFlightRef = useRef(false);
  const recoverStaffSessionRef = useRef<() => Promise<boolean>>(async () => false);

  const guessMimeType = useCallback((uri: string) => {
    const lower = uri.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.doc')) return 'application/msword';
    if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }, []);

  const makeUniqueDownloadFilename = useCallback((filename: string) => {
    const cleaned = filename.replace(/[\\/:*?"<>|]+/g, '_').trim();
    const extIndex = cleaned.lastIndexOf('.');
    const baseName = extIndex > 0 ? cleaned.slice(0, extIndex) : cleaned;
    const extension = extIndex > 0 ? cleaned.slice(extIndex) : '';
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return `${baseName || 'download'}_${stamp}${extension || ''}`;
  }, []);

  const openDocumentViewer = useCallback(async (localUri: string, fileName: string, title?: string, memoryKey?: string) => {
    if (!isPreviewableFileName(fileName || localUri)) return false;
    setBusyMessage('Preparing preview...');
    try {
      const ext = inferFileExtension(fileName || localUri).toLowerCase();
      const kind: DocumentPreviewState['kind'] = ext === '.pdf' ? 'pdf' : isImageFileName(fileName || localUri) ? 'image' : 'sheet';
      const html = kind === 'sheet' ? await buildDocumentPreviewHtml(localUri, fileName || getFileNameFromPath(localUri)) : '';
      const resolvedMemoryKey = memoryKey || fileName || getFileNameFromPath(localUri);
      setDocumentViewer({
        title: title || fileName || getFileNameFromPath(localUri),
        fileName: fileName || getFileNameFromPath(localUri),
        localUri,
        kind,
        html,
        memoryKey: resolvedMemoryKey,
        initialPage: kind === 'pdf' ? (pdfReadingPositions[resolvedMemoryKey] || 1) : undefined
      });
      return true;
    } catch (error) {
      console.warn('Document preview failed:', error);
      return false;
    } finally {
      setBusyProgress(null);
      setBusyMessage('');
    }
  }, [pdfReadingPositions]);

  const openDownloadedUri = useCallback(async (localUri: string, fileName?: string, title?: string, memoryKey?: string) => {
    const previewed = await openDocumentViewer(localUri, fileName || getFileNameFromPath(localUri), title, memoryKey);
    if (previewed) return;
    const mimeType = guessMimeType(fileName || localUri);
    const tryShare = async () => {
      if (!await Sharing.isAvailableAsync()) return false;
      await Sharing.shareAsync(localUri, {
        dialogTitle: 'Open downloaded file',
        mimeType
      });
      return true;
    };

    if (Platform.OS === 'android') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(localUri);
        await Linking.openURL(contentUri);
        return;
      } catch {
        if (await tryShare()) return;
        throw new Error('No app available to open this file on Android.');
      }
    }

    try {
      await Linking.openURL(localUri);
      return;
    } catch {
      if (await tryShare()) return;
      throw new Error('No app available to open this file.');
    }
  }, [guessMimeType, openDocumentViewer]);

  const downloadAndOpen = useCallback(async (path: string, filename: string) => {
    try {
      setBusyMessage('Downloading file...');
      setBusyProgress(0);
      const destination = new File(Paths.document, makeUniqueDownloadFilename(filename));
      await FileSystem.deleteAsync(destination.uri, { idempotent: true });
      const result = await downloadWithProgress(
        makeAbsoluteUrl(baseUrl, path),
        destination.uri,
        cookieRef.current,
        setBusyProgress
      );
      setOfflineMode(false);
      await openDownloadedUri(result.uri, filename, undefined, filename);
    } catch (error) {
      setOfflineMode(true);
      throw error;
    } finally {
      setBusyProgress(null);
      setBusyMessage('');
    }
    }, [baseUrl, makeUniqueDownloadFilename, openDownloadedUri]);

  const syncingRef = useRef<boolean>(false);
  const lastSyncTimeRef = useRef<number>(0);

  const syncSession = useCallback(async (force = false) => {
    if (syncingRef.current) return null;
    if (!force && Date.now() - lastSyncTimeRef.current < 10000 && sessionRef.current) {
      return sessionRef.current;
    }

    syncingRef.current = true;
    try {
      const payload = await apiJson<{ authenticated: boolean; session_type: 'student' | 'staff' | null; user?: StaffUser; student?: StudentProfile; }>('/api/session');
      lastSyncTimeRef.current = Date.now();

      if (!payload.authenticated || !payload.session_type) {
        const stickySession = appCacheRef.current.session ? restoreSession(appCacheRef.current.session) : sessionRef.current;
        if (stickySession) {
          setOfflineMode(true);
          setSession(stickySession);
          await persistAppCache({ session: snapshotSession(stickySession) });
          return stickySession;
        }
        await persistCookie('');
        setSession(null);
        await persistAppCache({ session: null });
        return null;
      }
      if (payload.session_type === 'student' && payload.student) {
        const nextSession: SessionInfo = { type: 'student', student: payload.student };
        setSession(nextSession);
        await persistAppCache({ session: snapshotSession(nextSession) });
        await persistTrustedSession(nextSession);
        return nextSession;
      }
      if (payload.session_type === 'staff' && payload.user) {
        const nextSession: SessionInfo = { type: 'staff', user: payload.user };
        setSession(nextSession);
        await persistAppCache({ session: snapshotSession(nextSession) });
        await persistTrustedSession(nextSession);
        return nextSession;
      }
      const stickySession = appCacheRef.current.session ? restoreSession(appCacheRef.current.session) : sessionRef.current;
      if (stickySession) {
        setOfflineMode(true);
        setSession(stickySession);
        await persistAppCache({ session: snapshotSession(stickySession) });
        return stickySession;
      }
      setSession(null);
      await persistAppCache({ session: null });
      return null;
    } catch (error) {
      const apiStatus = extractApiStatus(error);
      const isAuthError = apiStatus === 401 || apiStatus === 403;
      if (isAuthError) {
        lastSyncTimeRef.current = Date.now();
        const stickySession = appCacheRef.current.session ? restoreSession(appCacheRef.current.session) : sessionRef.current;
        if (stickySession) {
          setOfflineMode(true);
          setSession(stickySession);
          await persistAppCache({ session: snapshotSession(stickySession) });
          return stickySession;
        }
        setOfflineMode(false);
        await persistCookie('');
        setSession(null);
        await persistAppCache({ session: null });
        return null;
      }
      const cached = appCacheRef.current.session ? restoreSession(appCacheRef.current.session) : null;
      if (cached) {
        setOfflineMode(true);
        setSession(cached);
        return cached;
      }
      setSession(null);
      await persistAppCache({ session: null });
      return null;
    } finally {
      syncingRef.current = false;
    }
  }, [apiJson, persistAppCache, persistCookie, persistTrustedSession]);

  const loadPublicBatches = useCallback(async (force = false) => {
    const now = Date.now();
    if (publicBatchesInFlightRef.current) {
      return publicBatchesInFlightRef.current;
    }
    if (!force && publicBatchesLoadedAtRef.current && now - publicBatchesLoadedAtRef.current < 30 * 1000 && publicBatches.length) {
      return publicBatches;
    }
    const pending = (async () => {
      const next = await loadCachedJson<Batch[]>('public_batches', '/api/public/batches', {
        force,
        ttlMs: 30 * 1000,
        transform: (payload) => (Array.isArray(payload) ? payload : [])
      });
      setPublicBatches(next);
      publicBatchesLoadedAtRef.current = Date.now();
      await persistAppCache({ publicBatches: next });
      return next;
    })();
    publicBatchesInFlightRef.current = pending;
    try {
      return await pending;
    } finally {
      if (publicBatchesInFlightRef.current === pending) {
        publicBatchesInFlightRef.current = null;
      }
    }
  }, [loadCachedJson, persistAppCache, publicBatches]);

  const isServerUnavailableError = useCallback((error: unknown) => {
    const apiStatus = extractApiStatus(error);
    if (apiStatus === 530 || apiStatus === 502 || apiStatus === 503 || apiStatus === 504) return true;
    if (!(error instanceof Error)) return false;
    return /network request failed|failed to fetch|fetch failed|networkerror|econnrefused|etimedout|enotfound/i.test(error.message);
  }, []);

  const isSessionAlreadyRunningError = useCallback((error: unknown) => {
    const apiStatus = extractApiStatus(error);
    if (apiStatus === 409) return true;
    if (!(error instanceof Error)) return false;
    return /already a session running|close it before starting new one|close it before start/i.test(error.message);
  }, []);

  const getCachedSessionForLogin = useCallback((kind: 'student' | 'staff', identifier: string, meta?: { name?: string; phone?: string; father?: string }) => {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const stickyCandidate = appCacheRef.current.session ? restoreSession(appCacheRef.current.session) : sessionRef.current;
    if (stickyCandidate) {
      if (kind === 'student' && stickyCandidate.type === 'student') {
        const uidMatches = !normalizedIdentifier || String(stickyCandidate.student.student_uid || '').trim().toLowerCase() === normalizedIdentifier;
        const nameMatches = !meta?.name?.trim() || String(stickyCandidate.student.name || '').trim().toLowerCase() === meta.name.trim().toLowerCase();
        const phoneMatches = !meta?.phone?.trim() || String(stickyCandidate.student.phone || '').trim().toLowerCase() === meta.phone.trim().toLowerCase();
        const fatherMatches = !meta?.father?.trim() || String(stickyCandidate.student.father_name || '').trim().toLowerCase() === meta.father.trim().toLowerCase();
        if (uidMatches && nameMatches && phoneMatches && fatherMatches) return stickyCandidate;
      }
      if (kind === 'staff' && stickyCandidate.type === 'staff') {
        if (String(stickyCandidate.user.username || '').trim().toLowerCase() === normalizedIdentifier) return stickyCandidate;
      }
    }
    return findTrustedSession(kind, identifier, meta);
  }, [findTrustedSession]);

  const loadStudentPortal = useCallback(async (force = false) => {
    if (!session || session.type !== 'student') return;
    const studentUid = session.student.student_uid;
    const previousMaterials = studentMaterials;
    const previousNotices = studentNotices;
    const [materialsPayload, noticesPayload, notificationsPayload] = await Promise.all([
      loadCachedJson<MaterialItem[]>(`student_materials:${studentUid}`, '/api/student/materials', {
        force,
        ttlMs: 3 * 60 * 1000,
        transform: (payload) => (Array.isArray(payload) ? payload : (payload as any)?.materials ? (payload as any).materials : [])
      }),
      loadCachedJson<NoticeItem[]>(`student_notices:${studentUid}`, '/api/student/notices', {
        force,
        ttlMs: 3 * 60 * 1000,
        transform: (payload) => (Array.isArray(payload) ? payload : (payload as any)?.notices ? (payload as any).notices : [])
      }),
      loadCachedJson<{ notifications: PersonalNotification[] }>(`student_notifications:${studentUid}`, '/api/student/notifications', {
        force,
        ttlMs: 90 * 1000,
        transform: (payload) => ({
          notifications: payload?.notifications && Array.isArray(payload.notifications) ? payload.notifications : []
        })
      })
    ]);
    const nextMaterials = Array.isArray(materialsPayload) ? materialsPayload : [];
    const nextNotices = Array.isArray(noticesPayload) ? noticesPayload : [];
    const nextNotifications = Array.isArray(notificationsPayload.notifications) ? notificationsPayload.notifications : [];
    const materialsSignature = nextMaterials.slice(0, 8).map((item) => `${item.id}:${item.title}:${item.created_at}`).join('|');
    const noticesSignature = nextNotices.slice(0, 8).map((item) => `${item.id}:${item.title}:${item.created_at}`).join('|');
    const previousMaterialsSignature = studentMaterialsSignatureRef.current;
    const previousNoticesSignature = studentNoticesSignatureRef.current;
    studentMaterialsSignatureRef.current = materialsSignature;
    studentNoticesSignatureRef.current = noticesSignature;
    setStudentMaterials(nextMaterials);
    setStudentNotices(nextNotices);
    setStudentNotifications(nextNotifications);
    await persistAppCache({
      workspaceRole: 'student',
      studentMaterials: nextMaterials,
      studentNotices: nextNotices,
      studentNotifications: nextNotifications,
      downloadedMaterials: await readStudentMaterialCache(studentUid),
      session: snapshotSession(session)
    });
    setStudentDownloadedMaterials(await readStudentMaterialCache(studentUid));
    const previousMaterialIds = new Set(previousMaterials.map((item) => String(item.id)));
    const nextMaterialIds = new Set(nextMaterials.map((item) => String(item.id)));
    const removedMaterials = previousMaterials.filter((item) => !nextMaterialIds.has(String(item.id)));
    const addedMaterials = nextMaterials.filter((item) => !previousMaterialIds.has(String(item.id)));
    if (previousMaterialsSignature && previousMaterialsSignature !== materialsSignature) {
      if (removedMaterials.length > 0 && addedMaterials.length === 0) {
        void showLiveNotification(
          'Material deleted',
          'A study material was removed from your batch.',
          { type: 'material_deleted' }
        );
      } else {
        void showLiveNotification(
          'New material',
          'A new study material is available in your batch.',
          { type: 'material' }
        );
      }
    }
    const previousNoticeIds = new Set(previousNotices.map((item) => String(item.id)));
    const nextNoticeIds = new Set(nextNotices.map((item) => String(item.id)));
    const removedNotices = previousNotices.filter((item) => !nextNoticeIds.has(String(item.id)));
    const addedNotices = nextNotices.filter((item) => !previousNoticeIds.has(String(item.id)));
    if (previousNoticesSignature && previousNoticesSignature !== noticesSignature) {
      if (removedNotices.length > 0 && addedNotices.length === 0) {
        void showLiveNotification(
          'Notice deleted',
          'A notice was removed from the app.',
          { type: 'notice_deleted' }
        );
      } else {
        void showLiveNotification('New notice', 'You have a new notice in the app.', { type: 'notice' });
      }
    }
  }, [loadCachedJson, persistAppCache, session, showLiveNotification, studentMaterials, studentNotices]);

  const loadStudentTests = useCallback(async (force = false) => {
    if (!session || session.type !== 'student') return;
    const payload = await loadCachedJson<StudentDashboardTests>(`student_tests:${session.student.student_uid}`, '/api/student/tests/dashboard', {
      force,
      ttlMs: 90 * 1000,
      transform: (value) => ({
        upcoming: Array.isArray(value?.upcoming) ? value.upcoming : [],
        history: Array.isArray(value?.history) ? value.history : [],
        scoreboard_tests: Array.isArray(value?.scoreboard_tests) ? value.scoreboard_tests : []
      })
    });
    setStudentTests(payload);
  }, [loadCachedJson, session]);

  const loadRoster = useCallback(async (activeSessionId?: number, batchName?: string, force = false, commitToState = true): Promise<StudentRow[]> => {
    const requestKey = activeSessionId && activeSessionId > 0
      ? `roster:${activeSessionId}`
      : batchName
        ? `batch_roster:${batchName}`
        : 'roster:empty';
    const existing = rosterRequestInFlightRef.current[requestKey];
    if (existing) {
      return existing;
    }
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);

    const pending: Promise<StudentRow[]> = (async () => {
      if (activeSessionId && activeSessionId > 0) {
        try {
          const sessionKey = `server:${activeSessionId}`;
          const existingSession = currentCache.sessionsByKey?.[sessionKey]
            || (currentSessionRef.current && getSessionKeyForIdentity(currentSessionRef.current) === sessionKey ? currentSessionRef.current : null);
          const existingSessionData = (existingSession || currentSessionRef.current || {}) as Record<string, unknown>;
          const display = extractSessionDisplayMetadata(existingSessionData, batchName || currentSessionRef.current?.batch_id || '');
          const payload = await loadCachedJson<{ roster: StudentRow[] }>(`roster:${activeSessionId}`, `/api/sessions/${activeSessionId}/roster?summary=1`, {
            force,
            ttlMs: 30 * 1000,
            transform: (value) => ({ roster: compactStudentDirectoryRows(extractArrayPayload<StudentRow>(value, ['roster', 'students', 'data', 'rows'])) as unknown as StudentRow[] })
          });
          let nextRoster = Array.isArray(payload.roster) ? payload.roster : [];
          if (!nextRoster.length && batchName) {
            const batchPayload = await loadCachedJson<{ roster: StudentRow[] }>(`batch_roster:${batchName}`, `/api/students?batch=${encodeURIComponent(batchName)}`, {
              force,
              ttlMs: 30 * 1000,
              transform: (value) => ({ roster: compactStudentDirectoryRows(extractArrayPayload<StudentRow>(value, ['students', 'roster', 'data', 'rows'])) as unknown as StudentRow[] })
            });
            nextRoster = Array.isArray(batchPayload.roster) ? batchPayload.roster : [];
          }
          if (!nextRoster.length && batchName) {
            nextRoster = buildOfflineAttendanceRosterFallback(batchName, currentCache);
          }
          if (batchName) {
            const batchDirectoryRoster = buildDirectoryRosterRowsForBatch(batchName, currentCache.studentsByUid);
            if (batchDirectoryRoster.length) {
              nextRoster = mergeRosterRowsByUid(nextRoster, batchDirectoryRoster);
            }
          }
          const hydratedRoster = applyRosterAttendanceOverlay(nextRoster, activeSessionId, batchName);
          const rosterStudentsByUid = buildStudentsByUid(hydratedRoster, currentCache.studentsByUid);
          const rosterUids = buildRosterByBatch(hydratedRoster);
          const nextRosterByBatch = {
            ...currentCache.rosterByBatch,
            ...(batchName ? { [batchName]: rosterUids } : {})
          };
          const nextSessionsByKey = {
            ...currentCache.sessionsByKey,
            [sessionKey]: buildCanonicalSession(sessionKey, batchName || currentSessionRef.current?.batch_id || '', activeSessionId, {
              localSessionId: (existingSessionData.localSessionId as string | null | undefined) ?? currentSessionRef.current?.localSessionId ?? null,
              serverSessionId: activeSessionId,
              status: String(existingSessionData.status || '').trim() === 'closed' ? 'closed' : 'open',
              createdAt: String(existingSessionData.createdAt || existingSessionData.created_at || currentSessionRef.current?.created_at || new Date().toISOString()),
              closedAt: (existingSessionData.closedAt as string | null | undefined) ?? (existingSessionData.closed_at as string | null | undefined) ?? null,
              syncStatus: existingSessionData.syncStatus === 'synced'
                || existingSessionData.syncStatus === 'pending_create'
                || existingSessionData.syncStatus === 'pending_sync'
                || existingSessionData.syncStatus === 'failed'
                ? existingSessionData.syncStatus
                : 'synced',
              session_name: display.sessionName,
              sessionName: display.sessionName,
              column_name: display.columnName,
              columnName: display.columnName,
              title: display.title,
              displayName: display.displayName,
              name: display.name
            })
          };
          const nextStudentsByUid = {
            ...currentCache.studentsByUid,
            ...rosterStudentsByUid
          };
          const nextUpdatedAt = new Date().toISOString();
          appCacheRef.current = normalizeLocalAttendanceCache({
            ...appCacheRef.current,
            studentsByUid: nextStudentsByUid,
            rosterByBatch: nextRosterByBatch,
            sessionsByKey: nextSessionsByKey,
            updatedAt: nextUpdatedAt,
            cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
          });
          void persistLocalAttendanceCache({
            studentsByUid: nextStudentsByUid,
            rosterByBatch: nextRosterByBatch,
            sessionsByKey: nextSessionsByKey,
            updatedAt: nextUpdatedAt,
            cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
          });
          rosterSnapshotRef.current = hydratedRoster;
          offlineAttendanceSessionKeyRef.current = sessionKey;
          if (commitToState) {
            startTransition(() => setRoster(hydratedRoster));
          }
          refreshAttendanceDisplayRows(currentSessionRef.current?.status === 'closed' ? 'closed' : 'active', sessionKey, batchName, hydratedRoster);
          return hydratedRoster;
        } catch (error) {
          if (batchName) {
            return loadRoster(undefined, batchName, force, commitToState);
          }
          throw error;
        }
      }

      if (batchName) {
        const payload = await loadCachedJson<{ roster: StudentRow[] }>(`batch_roster:${batchName}`, `/api/students?batch=${encodeURIComponent(batchName)}`, {
          force,
          ttlMs: 30 * 1000,
          transform: (value) => ({ roster: compactStudentDirectoryRows(extractArrayPayload<StudentRow>(value, ['students', 'roster', 'data', 'rows'])) as unknown as StudentRow[] })
        });
        let nextRoster = Array.isArray(payload.roster) ? payload.roster : [];
        if (!nextRoster.length && batchName) {
          nextRoster = buildOfflineAttendanceRosterFallback(batchName, currentCache);
        }
        if (batchName) {
          const batchDirectoryRoster = buildDirectoryRosterRowsForBatch(batchName, currentCache.studentsByUid);
          if (batchDirectoryRoster.length) {
            nextRoster = mergeRosterRowsByUid(nextRoster, batchDirectoryRoster);
          }
        }
        const hydratedRoster = applyRosterAttendanceOverlay(nextRoster, activeSessionId, batchName);
        const rosterStudentsByUid = buildStudentsByUid(hydratedRoster, currentCache.studentsByUid);
        const rosterUids = buildRosterByBatch(hydratedRoster);
        const nextRosterByBatch = {
          ...currentCache.rosterByBatch,
          [batchName]: rosterUids
        };
        const nextStudentsByUid = {
          ...currentCache.studentsByUid,
          ...rosterStudentsByUid
        };
        const nextUpdatedAt = new Date().toISOString();
        appCacheRef.current = normalizeLocalAttendanceCache({
          ...appCacheRef.current,
          studentsByUid: nextStudentsByUid,
          rosterByBatch: nextRosterByBatch,
          updatedAt: nextUpdatedAt,
          cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
        });
        void persistLocalAttendanceCache({
          studentsByUid: nextStudentsByUid,
          rosterByBatch: nextRosterByBatch,
          updatedAt: nextUpdatedAt,
          cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
        });
        rosterSnapshotRef.current = hydratedRoster;
        if (commitToState) {
          startTransition(() => setRoster(hydratedRoster));
        }
        const restoredSessionMode = currentSessionRef.current?.status !== 'closed' ? 'active' : 'roster';
        const restoredSessionKey = currentSessionRef.current?.sessionKey || offlineAttendanceSessionKeyRef.current || '';
        refreshAttendanceDisplayRows(restoredSessionMode, restoredSessionKey, batchName, hydratedRoster);
        return hydratedRoster;
      }

      rosterSnapshotRef.current = [];
      if (commitToState) {
        startTransition(() => setRoster([]));
      }
      setAttendanceDisplayRows([]);
      return [];
    })();

    rosterRequestInFlightRef.current[requestKey] = pending;
    return pending.finally(() => {
      delete rosterRequestInFlightRef.current[requestKey];
    });
  }, [loadCachedJson, persistLocalAttendanceCache]);

  const queueOfflineAttendanceAction = useCallback(async (action: OfflineAttendanceAction) => {
    const nextQueue = [...(appCacheRef.current.attendanceQueue || []), action];
    await persistAppCache({ attendanceQueue: nextQueue, workspaceRole: 'staff' });
    offlineAttendanceSessionKeyRef.current = getQueuedAttendanceSessionKey(nextQueue);
    setAttendanceQueueRevision((value) => value + 1);
    return nextQueue;
  }, [persistAppCache]);

  function resolveStudentFromAttendanceToken(rawToken: string) {
    const token = normalizeScanToken(rawToken);
    if (!token) return null;
    const normalizedToken = token.toLowerCase().trim();
    const rosterPool = rosterSnapshotRef.current.length ? rosterSnapshotRef.current : roster;
    const rosterMatch = rosterPool.find((student) => {
      const secureToken = normalizeScanToken(student.secure_token || '').toLowerCase().trim();
      return student.student_uid.toLowerCase().trim() === normalizedToken || secureToken === normalizedToken;
    });
    if (rosterMatch) return rosterMatch;
    const directoryPool = studentDirectorySnapshotRef.current.length ? studentDirectorySnapshotRef.current : students;
    return directoryPool.find((student) => {
      const secureToken = normalizeScanToken(student.secure_token || '').toLowerCase().trim();
      return student.student_uid.toLowerCase().trim() === normalizedToken || secureToken === normalizedToken;
    }) || null;
  }

  function isAttendanceStudentValidForBatch(student: StudentRow | null | undefined, batchName: string) {
    const normalizedBatchName = String(batchName || '').trim();
    if (!normalizedBatchName || !student) return Boolean(student);
    const normalizedUid = String(student.student_uid || '').trim();
    if (normalizedUid) {
      const currentRoster = rosterSnapshotRef.current.length ? rosterSnapshotRef.current : roster;
      if (currentRoster.some((row) => String(row?.student_uid || '').trim() === normalizedUid)) {
        return true;
      }
    }
    return batchMatches(student, normalizedBatchName);
  }

function applyRosterAttendanceOverlay(rows: StudentRow[], activeSessionId?: number, batchName?: string) {
  const rosterRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
  const exactServerSessionKey = activeSessionId && activeSessionId > 0
    ? (resolveSessionKey(`server:${activeSessionId}`, currentCache.sessionAliasMap) || `server:${activeSessionId}`)
    : '';
  if (exactServerSessionKey) {
    const exactRows = deriveAttendanceRosterRows({
      batchName,
      sessionKey: exactServerSessionKey,
      studentsByUid: currentCache.studentsByUid,
      rosterByBatch: currentCache.rosterByBatch,
      attendanceMarksBySession: currentCache.attendanceMarksBySession,
      sessionAliasMap: currentCache.sessionAliasMap,
      legacyRoster: rosterRows
    });
    return exactRows.length ? exactRows : rosterRows;
  }
  const sessionKeyCandidates = new Set<string>();
  if (activeSessionId && activeSessionId > 0) {
    sessionKeyCandidates.add(`server:${activeSessionId}`);
    sessionKeyCandidates.add(String(activeSessionId));
  }
    if (currentSessionRef.current?.sessionKey) {
      sessionKeyCandidates.add(currentSessionRef.current.sessionKey);
    }
    if (currentSessionRef.current?.localSessionId) {
      sessionKeyCandidates.add(getLocalSessionKey(currentSessionRef.current.localSessionId));
    }
    if (currentSessionRef.current?.session_id) {
      sessionKeyCandidates.add(`server:${currentSessionRef.current.session_id}`);
      sessionKeyCandidates.add(String(currentSessionRef.current.session_id));
    }
    if (offlineAttendanceSessionKeyRef.current) sessionKeyCandidates.add(offlineAttendanceSessionKeyRef.current);
    if (batchName) {
      sessionKeyCandidates.add(batchName);
      sessionKeyCandidates.add(`offline:${batchName}`);
    }
    const resolvedSessionKeys = Array.from(sessionKeyCandidates)
      .map((sessionKey) => resolveSessionKey(sessionKey, currentCache.sessionAliasMap))
      .filter(Boolean);
    const sessionKeyForIndex = resolvedSessionKeys.find((candidate) => Object.keys(getSessionMarks(currentCache.attendanceMarksBySession, candidate, currentCache.sessionAliasMap)).length > 0)
      || resolvedSessionKeys[0]
      || '';
    const indexedRows = deriveAttendanceRosterRows({
      batchName,
      sessionKey: sessionKeyForIndex,
      studentsByUid: currentCache.studentsByUid,
      rosterByBatch: currentCache.rosterByBatch,
      attendanceMarksBySession: currentCache.attendanceMarksBySession,
      sessionAliasMap: currentCache.sessionAliasMap,
      legacyRoster: rosterRows
    });

    if (sessionKeyForIndex && Object.keys(getSessionMarks(currentCache.attendanceMarksBySession, sessionKeyForIndex, currentCache.sessionAliasMap)).length > 0) {
      return indexedRows;
    }

    const resolvedMarks = new Map<string, { status: number; created_at: string }>();
    const isLateSession = Boolean(currentSessionRef.current?.is_late === 1);
    const queue = Array.isArray(currentCache.attendanceQueue) ? currentCache.attendanceQueue : [];
    queue.forEach((action) => {
      if (action.type !== 'mark_qr' || !sessionKeyCandidates.has(action.session_key)) return;
      const resolved = resolveStudentFromAttendanceToken(action.token);
      if (!resolved) return;
      if (!isAttendanceStudentValidForBatch(resolved, batchName || currentSessionRef.current?.batch_id || '')) return;
      resolvedMarks.set(resolved.student_uid, {
        status: isLateSession ? 2 : 1,
        created_at: action.created_at
      });
    });

    const baseRows = indexedRows.length ? indexedRows : rosterRows;
    return baseRows.map((student) => {
      const mark = resolvedMarks.get(student.student_uid);
      if (!mark) return student;
      return {
        ...student,
        attendance_status: mark.status,
        attendance_marked_offline: true,
        attendance_marked_at: mark.created_at
      };
    }) as StudentRow[];
  }

  const patchRosterAttendanceRow = useCallback((studentUid: string, sessionKey?: string) => {
    const normalizedStudentUid = String(studentUid || '').trim();
    if (!normalizedStudentUid) return null;
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const sessionMode: 'active' | 'closed' = currentSessionRef.current?.status === 'closed' ? 'closed' : 'active';
    const resolvedSessionKey = resolveSessionKey(
      sessionKey || getSessionKeyForIdentity(currentSessionRef.current) || offlineAttendanceSessionKeyRef.current,
      currentCache.sessionAliasMap
    );
    const sessionMarks = getSessionMarks(currentCache.attendanceMarksBySession, resolvedSessionKey, currentCache.sessionAliasMap);
    let updatedRow: StudentRow | null = null;
    setAttendanceDisplayRows((prev) => {
      const currentRoster = prev.length ? prev : (rosterSnapshotRef.current.length ? rosterSnapshotRef.current : roster);
      const rowIndex = currentRoster.findIndex((row) => String(row?.student_uid || '').trim() === normalizedStudentUid);
      if (rowIndex < 0) return prev;
      const nextRow = deriveRosterRow(normalizedStudentUid, currentCache.studentsByUid, sessionMarks, currentRoster[rowIndex]);
      if (!nextRow) return prev;
      updatedRow = nextRow;
      if (currentRoster[rowIndex] === nextRow) return prev;
      const nextRoster = [...currentRoster];
      nextRoster[rowIndex] = nextRow;
      return sortAttendanceRowsForDisplay(nextRoster, sessionMode);
    });
    return updatedRow;
  }, [roster]);

  const loadBatchInsights = useCallback(async (batchName: string, force = false) => {
    if (!batchName) {
      setBatchSummary(null);
      setBatchHistory([]);
      return;
    }
    const requestKey = `batch:${batchName}`;
    const existing = batchInsightsRequestInFlightRef.current[requestKey];
    if (existing) {
      return existing;
    }
    const requestId = ++batchInsightsRequestRef.current;
    const pending = (async () => {
      const [summaryPayload, historyPayload] = await Promise.all([
        loadCachedJson<{ batch: BatchSummary }>(`batch_summary:${batchName}`, `/api/batches/${encodeURIComponent(batchName)}/summary`, {
          force,
          ttlMs: 2 * 60 * 1000,
          transform: (payload) => ({ batch: payload?.batch || null })
        }),
        loadCachedJson<AttendanceHistoryRow[]>(`batch_history:${batchName}`, `/api/batches/${encodeURIComponent(batchName)}/history`, {
          force,
          ttlMs: 2 * 60 * 1000,
          transform: (payload) => (Array.isArray(payload) ? payload : [])
        })
      ]);
      if (requestId !== batchInsightsRequestRef.current) return;
      setBatchSummary(summaryPayload.batch || null);
      setBatchHistory(Array.isArray(historyPayload) ? historyPayload : []);
    })();
    batchInsightsRequestInFlightRef.current[requestKey] = pending;
    return pending.finally(() => {
      delete batchInsightsRequestInFlightRef.current[requestKey];
    });
  }, [loadCachedJson]);

  const hydrateServerSessionRosterSnapshot = useCallback(async (
    sessionId: number,
    batchName: string,
    sessionName: string,
    force = false
  ) => {
    const normalizedSessionId = Number(sessionId || 0);
    const normalizedBatchName = String(batchName || '').trim();
    if (!normalizedSessionId) {
      return [];
    }

    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const sessionKey = getServerSessionKey(normalizedSessionId);
  const payload = await loadCachedJson<{ roster: StudentRow[] }>(
      getSmsSessionRosterCacheKey(normalizedBatchName, normalizedSessionId) || `session_roster_summary:${normalizedSessionId}`,
      `/api/sessions/${normalizedSessionId}/roster?summary=1`,
      {
        force,
        ttlMs: 30 * 1000,
        transform: (value) => ({
          roster: compactStudentDirectoryRows(extractArrayPayload<StudentRow>(value, ['roster', 'students', 'data', 'rows'])) as unknown as StudentRow[]
        })
      }
    );

    let nextRoster = Array.isArray(payload.roster) ? payload.roster : [];
    if (!nextRoster.length && normalizedBatchName) {
      const batchPayload = await loadCachedJson<{ roster: StudentRow[] }>(
        `batch_roster:${normalizedBatchName}`,
        `/api/students?batch=${encodeURIComponent(normalizedBatchName)}`,
        {
          force,
          ttlMs: 30 * 1000,
          transform: (value) => ({
            roster: compactStudentDirectoryRows(extractArrayPayload<StudentRow>(value, ['students', 'roster', 'data', 'rows'])) as unknown as StudentRow[]
          })
        }
      );
      nextRoster = Array.isArray(batchPayload.roster) ? batchPayload.roster : [];
    }

    if (!nextRoster.length) {
      nextRoster = buildOfflineAttendanceRosterFallback(normalizedBatchName, currentCache);
    }

    if (normalizedBatchName) {
      const batchDirectoryRoster = buildDirectoryRosterRowsForBatch(normalizedBatchName, currentCache.studentsByUid);
      if (batchDirectoryRoster.length) {
        nextRoster = mergeRosterRowsByUid(nextRoster, batchDirectoryRoster);
      }
    }

    const hydratedRoster = applyRosterAttendanceOverlay(nextRoster, normalizedSessionId, normalizedBatchName);
    const rosterStudentsByUid = buildStudentsByUid(hydratedRoster, currentCache.studentsByUid);
    const nextRosterByBatch = normalizedBatchName
      ? {
        ...currentCache.rosterByBatch,
        [normalizedBatchName]: buildRosterByBatch(hydratedRoster)
      }
      : currentCache.rosterByBatch;
    const nextSessionMarks = hydratedRoster.reduce<Record<string, CanonicalAttendanceMark>>((acc, row) => {
      const uid = String(row?.student_uid || '').trim();
      const status = Number(row?.attendance_status || 0) || 0;
      if (!uid || (status !== 1 && status !== 2)) {
        return acc;
      }
      acc[uid] = {
        markKey: getMarkKey(sessionKey, uid),
        sessionKey,
        studentUid: uid,
        status: status === 2 ? 'late' : 'present',
        markedAt: String(row.attendance_marked_at || (row as any).attendance_timestamp || new Date().toISOString()),
        syncStatus: 'synced',
        lastError: null,
        attemptCount: 0,
        nextAttemptAt: null,
        lastAttemptAt: null
      };
      return acc;
    }, {});
    const nextSessionsByKey = {
      ...currentCache.sessionsByKey,
      [sessionKey]: buildCanonicalSession(sessionKey, normalizedBatchName || sessionName || currentCache.currentSession?.batch_id || '', normalizedSessionId, {
        serverSessionId: normalizedSessionId,
        status: 'closed',
        createdAt: String(currentCache.sessionsByKey?.[sessionKey]?.createdAt || new Date().toISOString()),
        closedAt: String(currentCache.sessionsByKey?.[sessionKey]?.closedAt || new Date().toISOString()),
        syncStatus: 'synced',
        session_name: sessionName || currentCache.sessionsByKey?.[sessionKey]?.session_name || normalizedBatchName || 'Attendance Session',
        sessionName: sessionName || currentCache.sessionsByKey?.[sessionKey]?.sessionName || normalizedBatchName || 'Attendance Session',
        column_name: currentCache.sessionsByKey?.[sessionKey]?.column_name || currentCache.sessionsByKey?.[sessionKey]?.columnName || undefined,
        columnName: currentCache.sessionsByKey?.[sessionKey]?.columnName || currentCache.sessionsByKey?.[sessionKey]?.column_name || undefined,
        title: sessionName || currentCache.sessionsByKey?.[sessionKey]?.title || normalizedBatchName || 'Attendance Session',
        displayName: sessionName || currentCache.sessionsByKey?.[sessionKey]?.displayName || normalizedBatchName || 'Attendance Session',
        name: sessionName || currentCache.sessionsByKey?.[sessionKey]?.name || normalizedBatchName || 'Attendance Session'
      })
    };
    const nextAttendanceMarksBySession = {
      ...currentCache.attendanceMarksBySession,
      [sessionKey]: {
        ...(currentCache.attendanceMarksBySession?.[sessionKey] || {}),
        ...nextSessionMarks
      }
    };
    const nextStudentsByUid = {
      ...currentCache.studentsByUid,
      ...rosterStudentsByUid
    };
    const nextUpdatedAt = new Date().toISOString();
    const nextCache = normalizeLocalAttendanceCache({
      ...appCacheRef.current,
      studentsByUid: nextStudentsByUid,
      rosterByBatch: nextRosterByBatch,
      sessionsByKey: nextSessionsByKey,
      attendanceMarksBySession: nextAttendanceMarksBySession,
      updatedAt: nextUpdatedAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    appCacheRef.current = nextCache;
    void persistLocalAttendanceCache({
      studentsByUid: nextStudentsByUid,
      rosterByBatch: nextRosterByBatch,
      sessionsByKey: nextSessionsByKey,
      attendanceMarksBySession: nextAttendanceMarksBySession,
      updatedAt: nextUpdatedAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    return hydratedRoster;
  }, [loadCachedJson, persistLocalAttendanceCache]);

  const loadSmsBatchInsights = useCallback(async (batchName: string, force = false) => {
    if (!batchName) {
      setSmsBatchHistory([]);
      return;
    }
    const requestKey = `sms:${batchName}`;
    const existing = smsBatchInsightsRequestInFlightRef.current[requestKey];
    if (existing) {
      return existing;
    }
    const requestId = ++smsBatchInsightsRequestRef.current;
    const pending = (async () => {
      const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
      const onlinePreferred = force || (session?.type === 'staff' && !offlineMode);
      const cachedHistory = currentCache.smsBatchHistoryByBatch?.[batchName] || [];
      let historyRows: AttendanceHistoryRow[] = [];
      let usedCacheFallback = false;
      try {
        historyRows = await loadCachedJson<AttendanceHistoryRow[]>(`sms_batch_history:${batchName}`, `/api/batches/${encodeURIComponent(batchName)}/history`, {
          force: onlinePreferred,
          ttlMs: 2 * 60 * 1000,
          transform: (payload) => (Array.isArray(payload) ? payload : [])
        });
      } catch (error) {
        if (!cachedHistory.length) {
          throw error;
        }
        historyRows = cachedHistory;
        usedCacheFallback = true;
      }
      if (requestId !== smsBatchInsightsRequestRef.current) return;
      const nextHistory = usedCacheFallback
        ? buildSmsHistoryFallbackRows(batchName, normalizeAttendanceHistoryRows(historyRows), appCacheRef.current)
        : normalizeAttendanceHistoryRows(historyRows);
      if (onlinePreferred && !usedCacheFallback) {
        setOfflineMode(false);
      }
      setSmsBatchHistory(nextHistory);
      const nextSmsHistoryByBatch = {
        ...currentCache.smsBatchHistoryByBatch,
        [batchName]: nextHistory
      };
      appCacheRef.current = normalizeLocalAttendanceCache({
        ...appCacheRef.current,
        smsBatchHistoryByBatch: nextSmsHistoryByBatch,
        updatedAt: new Date().toISOString(),
        cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
      });
      void persistLocalAttendanceCache({
        smsBatchHistoryByBatch: nextSmsHistoryByBatch,
        updatedAt: new Date().toISOString(),
        cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
      });
      const batchSessionRows = nextHistory
        .slice()
        .sort(compareAttendanceHistoryRowsForLatestFirst)
        .filter((row) => Number(row?.session_id || 0) > 0)
        .filter((row, index, rows) => rows.findIndex((candidate) => Number(candidate.session_id || 0) === Number(row.session_id || 0)) === index)
        .filter((row) => force || Object.keys(getSessionMarks(currentCache.attendanceMarksBySession, `server:${Number(row.session_id || 0)}`, currentCache.sessionAliasMap)).length === 0)
        .slice(0, 5);
      await Promise.all(batchSessionRows.map((row) => {
        const sessionId = Number(row.session_id || 0);
        if (!sessionId) return Promise.resolve();
        return hydrateServerSessionRosterSnapshot(sessionId, batchName, String(row.session_name || batchName || '').trim(), force).catch((error) => {
          console.warn('[SMS] Failed to hydrate session roster snapshot:', error);
          return null;
        });
      }));
    })();
    smsBatchInsightsRequestInFlightRef.current[requestKey] = pending;
    return pending.finally(() => {
      delete smsBatchInsightsRequestInFlightRef.current[requestKey];
    });
  }, [getSessionMarks, hydrateServerSessionRosterSnapshot, loadCachedJson, offlineMode, session?.type]);

  const loadStudentDirectory = useCallback(async (force = false, commitToState = true) => {
    if (studentDirectoryRequestInFlightRef.current) {
      return studentDirectoryRequestInFlightRef.current;
    }
    const cached = await readStudentDirectoryCache();
    const freshEnough = cached && Date.now() - cached.savedAt <= STUDENT_DIRECTORY_CACHE_TTL_MS;
    const cachedStudents = Array.isArray(cached?.students) ? cached!.students : [];
    let nextStudents: CachedStudentRow[] = [];
    console.log('[StudentDirectory] load start', { force, commitToState, cachedCount: cachedStudents.length, freshEnough: Boolean(freshEnough) });

    const pending = (async () => {
      try {
        if (freshEnough && !force && cachedStudents.length > 0) {
          nextStudents = compactStudentDirectoryRows(cachedStudents);
          console.log('[StudentDirectory] using cached rows', nextStudents.length);
          if (hasMissingGuardianPhones(nextStudents)) {
            const fullPayload = await apiJson<any>('/api/students');
            const fullStudents = compactStudentDirectoryRows(extractArrayPayload<CachedStudentRow>(fullPayload, ['students', 'data', 'rows']));
            if (fullStudents.length) {
              nextStudents = mergeStudentDirectoryRows(nextStudents, fullStudents);
              await writeStudentDirectoryCache({
                savedAt: Date.now(),
                students: nextStudents
              });
            }
          }
        } else {
          const summaryPayload = await apiJson<any>('/api/students/summary');
          nextStudents = compactStudentDirectoryRows(extractArrayPayload<CachedStudentRow>(summaryPayload, ['students', 'data', 'rows']));
          console.log('[StudentDirectory] summary rows', nextStudents.length);
          if (!nextStudents.length || hasMissingGuardianPhones(nextStudents)) {
            const fallbackPayload = await apiJson<any>('/api/students');
            const fallbackRows = compactStudentDirectoryRows(extractArrayPayload<CachedStudentRow>(fallbackPayload, ['students', 'data', 'rows']));
            console.log('[StudentDirectory] fallback rows', fallbackRows.length);
            if (fallbackRows.length) {
              nextStudents = nextStudents.length ? mergeStudentDirectoryRows(nextStudents, fallbackRows) : fallbackRows;
            }
          }
          await writeStudentDirectoryCache({
            savedAt: Date.now(),
            students: nextStudents
          });
        }
      } catch (error) {
        try {
          const fallbackPayload = await apiJson<any>('/api/students');
          nextStudents = compactStudentDirectoryRows(extractArrayPayload<CachedStudentRow>(fallbackPayload, ['students', 'data', 'rows']));
          await writeStudentDirectoryCache({
            savedAt: Date.now(),
            students: nextStudents
          });
        } catch (fallbackError) {
          if (Array.isArray(cached?.students) && cached!.students.length) {
            nextStudents = cached!.students;
            if (!(error instanceof Error && error.message.startsWith('API Error:'))) {
              setOfflineMode(true);
            }
            console.log('[StudentDirectory] recovered from cache', nextStudents.length);
          } else {
            console.warn('[StudentDirectory] load failed', fallbackError || error);
            throw fallbackError || error;
          }
        }
      }

      studentDirectorySnapshotRef.current = nextStudents;
      const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
      const nextStudentsByUid = buildStudentsByUid(nextStudents, currentCache.studentsByUid);
      const nextUpdatedAt = new Date().toISOString();
      appCacheRef.current = normalizeLocalAttendanceCache({
        ...appCacheRef.current,
        studentsByUid: nextStudentsByUid,
        updatedAt: nextUpdatedAt,
        cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
      });
      void persistLocalAttendanceCache({
        studentsByUid: nextStudentsByUid,
        updatedAt: nextUpdatedAt,
        cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
      });
      startTransition(() => {
        setStudentDirectoryCount(nextStudents.length);
      });
      console.log('[StudentDirectory] committed rows', nextStudents.length);
      if (commitToState) {
        const hydratedStudents = nextStudents as unknown as StudentRow[];
        startTransition(() => setStudents(hydratedStudents));
        return hydratedStudents;
      }
      return nextStudents as unknown as StudentRow[];
    })();

    studentDirectoryRequestInFlightRef.current = pending;
    return pending.finally(() => {
      studentDirectoryRequestInFlightRef.current = null;
    });
  }, [apiJson, persistLocalAttendanceCache]);

  const loadStaffCore = useCallback(async (force = false) => {
    const requestId = ++staffCoreRequestRef.current;
    const cached = await readStaffCoreCache();
    const freshEnough = cached && Date.now() - cached.savedAt <= 3 * 60 * 1000;
    const cachedHasBatches = Array.isArray(cached?.batches) && cached.batches.length > 0;
    console.log('[StaffCore] load', {
      force,
      freshEnough: Boolean(freshEnough),
      cachedHasBatches,
      cachedSessionId: cached?.currentSession?.session_id || null,
      cachedSessionStatus: cached?.currentSession?.status || null
    });

    try {
      const currentSessionPromise = apiJson<{ status: string; data: AttendanceWorkspaceSession | null }>('/api/sessions/current');
      const batchesPromise = (!force && freshEnough && cachedHasBatches)
        ? Promise.resolve(null)
        : apiJson<Batch[]>('/api/batches');
      const [batchesPayload, currentSessionPayload] = await Promise.all([
        batchesPromise,
        currentSessionPromise
      ]);

      const nextBatches = batchesPayload
        ? extractArrayPayload<Batch>(batchesPayload, ['batches', 'data', 'rows'])
        : Array.isArray(cached?.batches) ? cached!.batches : [];
      const fetchedSession = (currentSessionPayload as any)?.data
        || (currentSessionPayload as any)?.active
        || (currentSessionRef.current && currentSessionRef.current.session_id < 0 ? currentSessionRef.current : null);
      const pendingStartedSession = normalizeAttendanceWorkspaceSession(attendanceSessionPendingRef.current);
      if (pendingStartedSession && fetchedSession && getSessionKeyForIdentity(fetchedSession) === getSessionKeyForIdentity(pendingStartedSession)) {
        attendanceSessionPendingRef.current = null;
      }
      const pendingLocalKey = offlineAttendanceSessionKeyRef.current || getQueuedSyncSessionKey(normalizeLocalAttendanceCache(appCacheRef.current).syncQueue);
      const currentUi = uiSnapshotRef.current;
      const rememberedAttendanceBatch = currentUi.attendanceBatch || lastKnownAttendanceBatchRef.current || '';
      const resolution = resolveActiveAttendanceSessionFromLedger({
        cache: appCacheRef.current,
        preferredSession: pendingStartedSession || null,
        serverSession: fetchedSession || pendingStartedSession || null,
        attendanceBatch: rememberedAttendanceBatch || currentSessionRef.current?.batch_id || '',
        attendanceSessionName,
        offlineAttendanceSessionKey: pendingLocalKey,
        preferLocalOpenSession: false,
        allowLocalOpenSession: false
      });
      const nextSession = resolution.currentSession;
      const sessionBatch = nextSession?.batch_id || '';
      const activeBatch = resolution.attendanceBatch || rememberedAttendanceBatch || sessionBatch || '';

      if (requestId !== staffCoreRequestRef.current) {
        return nextSession;
      }
      if (activeBatch) {
        lastKnownAttendanceBatchRef.current = activeBatch;
      }
      setOfflineMode(false);

      const nextCore: StaffCoreCache = {
        savedAt: Date.now(),
        batches: nextBatches,
        currentSession: nextSession
      };
      console.log('[StaffCore] resolved', {
        requestId,
        sessionId: nextSession?.session_id || null,
        sessionStatus: nextSession?.status || null,
        sessionBatch: nextSession?.batch_id || null,
        activeBatch
      });
      await writeStaffCoreCache(nextCore);
      applyStaffCoreSnapshot(nextCore, { preferOpenSession: false });
      if (activeBatch && !attendanceBatch) setAttendanceBatch(activeBatch);
      return nextSession;
    } catch (error) {
      console.warn('[StaffCore] load failed', error);
      if (cached) {
        console.log('[StaffCore] fallback cached snapshot', {
          requestId,
          cachedSessionId: cached.currentSession?.session_id || null,
          cachedSessionStatus: cached.currentSession?.status || null
        });
        setOfflineMode(true);
        return applyStaffCoreSnapshot(cached);
      }
      throw error;
    }
  }, [apiJson, applyStaffCoreSnapshot, attendanceBatch]);

  const waitForRunningAttendanceSession = useCallback(async () => {
    let nextSession: AttendanceWorkspaceSession | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      nextSession = await apiJson<{ status: string; data: AttendanceWorkspaceSession | null }>('/api/sessions/current')
        .then((payload) => normalizeAttendanceWorkspaceSession((payload as any)?.data || (payload as any)?.active || null))
        .catch(() => null);
      if (nextSession?.session_id && nextSession.status !== 'closed') {
        return nextSession;
      }
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 250 + (attempt * 150)));
    }
    return nextSession;
  }, [apiJson]);

  const fetchRunningAttendanceSessionOnce = useCallback(async () => {
    return apiJson<{ status: string; data: AttendanceWorkspaceSession | null }>('/api/sessions/current')
      .then((payload) => normalizeAttendanceWorkspaceSession((payload as any)?.data || (payload as any)?.active || null))
      .catch(() => null);
  }, [apiJson]);

  const applyStartedAttendanceSession = useCallback(async (startedSession: AttendanceWorkspaceSession | null | undefined, fallbackBatch?: string, fallbackSessionName?: string) => {
    const normalizedStartedSession = normalizeAttendanceWorkspaceSession(startedSession);
    if (!normalizedStartedSession?.session_id || normalizedStartedSession.status === 'closed') {
      return null;
    }
    attendanceSessionPendingRef.current = normalizedStartedSession;
    currentSessionRef.current = normalizedStartedSession;
    if (normalizedStartedSession.batch_id) {
      lastKnownAttendanceBatchRef.current = normalizedStartedSession.batch_id;
    }
    if (fallbackSessionName && !String(attendanceSessionNameRef.current || '').trim()) {
      attendanceSessionNameRef.current = fallbackSessionName;
    }

    const resolvedActiveSession = resolveActiveAttendanceSessionFromLedger({
      cache: appCacheRef.current,
      preferredSession: normalizedStartedSession,
      serverSession: normalizedStartedSession,
      attendanceBatch: fallbackBatch || normalizedStartedSession.batch_id || attendanceBatch,
      attendanceSessionName: fallbackSessionName || attendanceSessionNameRef.current,
      offlineAttendanceSessionKey: offlineAttendanceSessionKeyRef.current,
      allowLocalOpenSession: false
    });
    const visibleSession = resolvedActiveSession.currentSession || normalizedStartedSession;
    const nextBatch = resolvedActiveSession.attendanceBatch || visibleSession.batch_id || fallbackBatch || '';
    const sessionKey = String(visibleSession.sessionKey || getSessionKeyForIdentity(visibleSession) || '').trim();
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const nextSessionsByKey = {
      ...currentCache.sessionsByKey,
      ...(sessionKey ? {
        [sessionKey]: buildCanonicalSession(sessionKey, nextBatch, visibleSession.session_id, {
          localSessionId: visibleSession.localSessionId ?? null,
          serverSessionId: visibleSession.serverSessionId ?? visibleSession.session_id ?? null,
          status: 'open',
          createdAt: String(visibleSession.created_at || new Date().toISOString()),
          closedAt: null,
          syncStatus: 'synced',
          lastError: null,
          session_name: visibleSession.session_name,
          sessionName: visibleSession.sessionName,
          column_name: visibleSession.column_name,
          columnName: visibleSession.columnName,
          title: visibleSession.title,
          displayName: visibleSession.displayName,
          name: visibleSession.name
        })
      } : {})
    };
    const nextCache = normalizeLocalAttendanceCache({
      ...currentCache,
      currentSession: visibleSession,
      sessionsByKey: nextSessionsByKey,
      updatedAt: new Date().toISOString(),
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });

    appCacheRef.current = nextCache;
    offlineAttendanceSessionKeyRef.current = resolvedActiveSession.offlineAttendanceSessionKey || sessionKey;
    if (resolvedActiveSession.currentSession) {
      setCurrentSession(resolvedActiveSession.currentSession);
    } else {
      setCurrentSession(visibleSession);
    }
    if (resolvedActiveSession.attendanceBatch) {
      setAttendanceBatch(resolvedActiveSession.attendanceBatch);
    } else if (nextBatch) {
      setAttendanceBatch(nextBatch);
    }
    if (resolvedActiveSession.attendanceSessionName && !String(attendanceSessionNameRef.current || '').trim()) {
      setAttendanceSessionName(resolvedActiveSession.attendanceSessionName);
    }

    void persistLocalAttendanceCache({
      currentSession: visibleSession,
      sessionsByKey: nextSessionsByKey,
      updatedAt: nextCache.updatedAt,
      cacheVersion: LOCAL_ATTENDANCE_CACHE_VERSION
    });
    if (nextBatch) {
      void loadRoster(visibleSession.session_id, nextBatch, true).catch(() => null);
    }
    void refreshLiveSessionStateRef.current(true, nextBatch).catch(() => null);
    void scheduleLocalAttendanceReplay('session-start-adopted', { immediate: true });
    return visibleSession;
  }, [attendanceBatch, loadRoster, persistLocalAttendanceCache, scheduleLocalAttendanceReplay]);

  const adoptRunningAttendanceSession = useCallback(async () => {
    const nextSession = await waitForRunningAttendanceSession();
    if (!nextSession?.session_id || nextSession.status === 'closed') {
      return null;
    }

    const resolvedActiveSession = resolveActiveAttendanceSessionFromLedger({
      cache: appCacheRef.current,
      preferredSession: nextSession,
      serverSession: nextSession,
      attendanceBatch,
      attendanceSessionName,
      offlineAttendanceSessionKey: offlineAttendanceSessionKeyRef.current,
      allowLocalOpenSession: false
    });
    const visibleSession = resolvedActiveSession.currentSession || nextSession;
    const nextBatch = resolvedActiveSession.attendanceBatch || visibleSession.batch_id || attendanceBatch || '';

    setCurrentSession(visibleSession);
    if (resolvedActiveSession.attendanceBatch) {
      setAttendanceBatch(resolvedActiveSession.attendanceBatch);
    }
    if (resolvedActiveSession.attendanceSessionName) {
      setAttendanceSessionName(resolvedActiveSession.attendanceSessionName);
    }
    if (resolvedActiveSession.offlineAttendanceSessionKey) {
      offlineAttendanceSessionKeyRef.current = resolvedActiveSession.offlineAttendanceSessionKey;
    }
    if (nextBatch) {
      await loadRoster(visibleSession.session_id, nextBatch, true).catch(() => null);
    }
    void scheduleLocalAttendanceReplay('session-start-adopted', { immediate: true });
    return visibleSession;
  }, [attendanceBatch, attendanceSessionName, loadRoster, scheduleLocalAttendanceReplay, waitForRunningAttendanceSession]);

  const flushOfflineAttendanceQueue = useCallback(async () => {
    if (attendanceQueueSyncInFlightRef.current) return;
    attendanceQueueSyncInFlightRef.current = true;
    try {
      const queued = Array.isArray(appCacheRef.current.attendanceQueue) ? appCacheRef.current.attendanceQueue : [];
      if (!queued.length) {
        return;
      }
      await persistAppCache({ attendanceQueue: [], workspaceRole: 'staff' });
      offlineAttendanceSessionKeyRef.current = '';
      setAttendanceQueueRevision((value) => value + 1);
    } finally {
      attendanceQueueSyncInFlightRef.current = false;
    }
  }, [persistAppCache]);

  const refreshAttendanceWorkspace = useCallback(async (force = false) => {
    const nextSession = await loadStaffCore(force);
    const nextBatch = lastKnownAttendanceBatchRef.current || nextSession?.batch_id || '';
    await loadStudentDirectory(force, true).catch(() => null);
    if (nextSession?.session_id && nextBatch) {
      await loadRoster(nextSession.session_id, nextBatch, force, true).catch(() => null);
    }
  }, [loadRoster, loadStaffCore, loadStudentDirectory]);

  const refreshLiveSessionState = useCallback(async (force = false, batchHint?: string | null) => {
    console.log('[RefreshLive] entry', {
      sessionType: sessionRef.current?.type || null,
      staffTab: uiSnapshotRef.current.staffTab,
      force,
      batchHint: batchHint || null
    });
    const hasActiveAttendanceSession = Boolean(currentSessionRef.current?.session_id && currentSessionRef.current.status !== 'closed');
    if (sessionRef.current?.type !== 'staff' && !hasActiveAttendanceSession) return;
    void loadMobileManifestRef.current(force).catch(() => null);
    const currentStaffTab = uiSnapshotRef.current.staffTab;
    console.log('[RefreshLive] staff path', { currentStaffTab });
    if (currentStaffTab === 'attendance') {
      await refreshAttendanceWorkspaceRef.current(force);
    } else {
      await refreshStaffWorkspaceRef.current(force);
    }

    const nextSmsBatch = String(
      batchHint
      || uiSnapshotRef.current.smsBatch
      || lastKnownAttendanceBatchRef.current
      || currentSessionRef.current?.batch_id
      || ''
    ).trim();
    if (nextSmsBatch) {
      await loadSmsBatchInsightsRef.current(nextSmsBatch, force);
    }
  }, []);

  const loadMaterials = useCallback(async (force = false) => {
    const previousMaterials = materials;
    const next = await loadCachedJson<MaterialItem[]>('staff_materials', '/api/materials', {
      force,
      ttlMs: 2 * 60 * 1000,
      transform: (payload) => (Array.isArray(payload?.materials) ? payload.materials : [])
    });
    const nextSignature = next.slice(0, 8).map((item) => `${item.id}:${item.title}:${item.created_at}`).join('|');
    const previousSignature = staffMaterialsSignatureRef.current;
    staffMaterialsSignatureRef.current = nextSignature;
    startTransition(() => setMaterials(next));
    await persistAppCache({ workspaceRole: 'staff', materials: next });
    if (previousSignature && previousSignature !== nextSignature) {
      const previousIds = new Set(previousMaterials.map((item) => String(item.id)));
      const nextIds = new Set(next.map((item) => String(item.id)));
      const removedMaterials = previousMaterials.filter((item) => !nextIds.has(String(item.id)));
      const addedMaterials = next.filter((item) => !previousIds.has(String(item.id)));
      if (removedMaterials.length > 0 && addedMaterials.length === 0) {
        void showLiveNotification('Material deleted', 'A study material was removed.', { type: 'material_deleted' });
      } else {
        void showLiveNotification('Study materials updated', 'Open Materials to see the latest upload.', { type: 'material' });
      }
    }
    return next;
  }, [loadCachedJson, materials, persistAppCache, showLiveNotification]);

  const loadNotices = useCallback(async (force = false) => {
    const next = await loadCachedJson<NoticeItem[]>('staff_notices', '/api/notices', {
      force,
      ttlMs: 2 * 60 * 1000,
      transform: (payload) => (Array.isArray(payload?.notices) ? payload.notices : [])
    });
    const nextSignature = next.slice(0, 8).map((item) => `${item.id}:${item.title}:${item.created_at}`).join('|');
    const previousSignature = staffNoticesSignatureRef.current;
    staffNoticesSignatureRef.current = nextSignature;
    startTransition(() => setNotices(next));
    await persistAppCache({ workspaceRole: 'staff', notices: next });
    if (previousSignature && previousSignature !== nextSignature) {
      void showLiveNotification('New notice', 'Open Inbox to review the latest notice.', { type: 'notice' });
    }
    return next;
  }, [loadCachedJson, persistAppCache, showLiveNotification]);

  const loadLeads = useCallback(async (force = false) => {
    const next = await loadCachedJson<LeadItem[]>('staff_leads', '/api/leads', {
      force,
      ttlMs: 90 * 1000,
      transform: (payload) => (Array.isArray(payload?.leads) ? payload.leads : [])
    });
    startTransition(() => setLeads(next));
    await persistAppCache({ workspaceRole: 'staff', leads: next });
    return next;
  }, [loadCachedJson, persistAppCache]);

  const primeTeacherOfflinePack = useCallback(async (seed: { students?: CachedStudentRow[]; batches?: Batch[]; materials?: MaterialItem[] } = {}) => {
    if (teacherOfflinePrimeInFlightRef.current) return;
    teacherOfflinePrimeInFlightRef.current = true;
    try {
      const batchRows = Array.isArray(seed.batches) ? seed.batches : staffBatchesRef.current;
      await mapWithConcurrency(batchRows, 2, async (batch) => {
        if (!batch?.name) return;
        try {
          await loadCachedJson<{ batch: BatchSummary }>(`batch_summary:${batch.name}`, `/api/batches/${encodeURIComponent(batch.name)}/summary`, {
            force: true,
            ttlMs: 30 * 60 * 1000,
            transform: (payload) => ({ batch: payload?.batch || null })
          });
          await loadCachedJson<AttendanceHistoryRow[]>(`batch_history:${batch.name}`, `/api/batches/${encodeURIComponent(batch.name)}/history`, {
            force: true,
            ttlMs: 30 * 60 * 1000,
            transform: (payload) => (Array.isArray(payload) ? payload : [])
          });
        } catch (error) {
          if (!isServerUnavailableError(error)) {
            console.warn('[OfflinePack] batch cache prime failed', error);
          }
        }
      });
    } finally {
      teacherOfflinePrimeInFlightRef.current = false;
    }
  }, [isServerUnavailableError, loadCachedJson]);

  const loadReports = useCallback(async (overBatch?: string, force = false) => {
    const currentUi = uiSnapshotRef.current;
    const targetBatch = overBatch || currentUi.reportBatch || 'ALL';
    const requestId = ++reportRequestRef.current;
    setReportLoading(true);
    try {
      if (targetBatch !== 'ALL') setReport(null);
      const [alertsPayload, reportPayload] = await Promise.all([
        loadCachedJson<{ alerts: WeeklyAlert[] }>('attendance_alerts', '/api/reports/attendance_alerts', {
          force,
          ttlMs: 90 * 1000,
          transform: (payload) => ({ alerts: Array.isArray(payload?.alerts) ? payload.alerts : [] })
        }),
        targetBatch !== 'ALL' ? loadCachedJson<{ status: string } & BatchReport>(`batch_report:${targetBatch}`, `/api/reports/batch/${encodeURIComponent(targetBatch)}`, {
          force,
          ttlMs: 90 * 1000,
          transform: (payload) => payload
        }) : Promise.resolve(null)
      ]);
      if (reportRequestRef.current !== requestId) return;
      setWeeklyAlerts(Array.isArray(alertsPayload.alerts) ? alertsPayload.alerts : []);
      setReport(targetBatch !== 'ALL' && reportPayload && reportPayload.status === 'success' ? reportPayload : null);
    } finally {
      if (reportRequestRef.current === requestId) {
        setReportLoading(false);
      }
    }
  }, [loadCachedJson]);

  const loadFeeWorkspace = useCallback(async () => {
    setFeeLoading(true);
    try {
      const [dashboardPayload, priorityPayload] = await Promise.all([
        apiJson<FeeDashboardPayload>('/api/fees/dashboard'),
        apiJson<{ status: string; priority_summary: FeePriorityRow[] }>('/api/fees/priority-summary')
      ]);
      setFeeDashboard(dashboardPayload);
      setFeePriorityRows(Array.isArray(priorityPayload.priority_summary) ? priorityPayload.priority_summary : []);
    } finally {
      setFeeLoading(false);
    }
  }, [apiJson]);

  const loadFeeStudentSummary = useCallback(async (uidOverride?: string) => {
    const uid = String(uidOverride || feeStudentUid).trim();
    if (!uid) {
      Alert.alert('Student UID required', 'Enter a student UID to load the fee summary.');
      return;
    }
    setFeeLoading(true);
    try {
      const payload = await apiJson<FeeStudentSummaryPayload>(`/api/fees/students/${encodeURIComponent(uid)}/summary`);
      setFeeStudentSummary(payload);
    } finally {
      setFeeLoading(false);
    }
  }, [apiJson, feeStudentUid]);

  const feePlanCreatedBy = session?.type === 'staff'
    ? String(session.user.username || session.user.id || 'staff')
    : 'staff';

  const createFeePlanForStudent = useCallback(async () => {
    const studentUid = String(feeCreateStudentUid || feeStudentUid || feeStudentSummary?.student?.student_uid || '').trim();
    if (!studentUid) {
      Alert.alert('Student UID required', 'Select or enter a student UID first.');
      return;
    }
    const batchName = String(feeCreateBatchName || feeStudentSummary?.student?.batch_name || '').trim();
    const totalAmount = Number(feeCreateTotalAmount);
    const discountAmount = Number(feeCreateDiscountAmount);
    const installmentCount = Math.max(1, Number(feeCreateInstallmentCount) || (feeCreateMode === 'one_time' ? 1 : 3));
    const startDate = String(feeCreateStartDate || todayDateInput()).trim();
    if (!batchName) {
      Alert.alert('Batch required', 'Load the student summary first so the batch can be reused.');
      return;
    }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid total fee amount.');
      return;
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      Alert.alert('Invalid discount', 'Discount must be zero or a positive number.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      Alert.alert('Invalid start date', 'Use YYYY-MM-DD for the start date.');
      return;
    }

    setFeeCreateSubmitting(true);
    try {
      const payload = await apiJson<FeeCreatePlanResponse>('/api/fees/plans', {
        method: 'POST',
        body: JSON.stringify({
          student_uid: studentUid,
          batch_name: batchName,
          plan_mode: feeCreateMode,
          total_amount: totalAmount,
          discount_amount: discountAmount,
          start_date: startDate,
          installment_count: feeCreateMode === 'one_time' ? 1 : installmentCount,
          created_by: feePlanCreatedBy
        })
      });
      const createdPlanId = payload.plan?.plan_id ?? payload.snapshot?.plan_id ?? payload.plan?.id;
      Alert.alert(
        'Fee plan created',
        createdPlanId ? `Draft plan #${createdPlanId} created for ${studentUid}.` : `Draft plan created for ${studentUid}.`
      );
      await loadFeeWorkspace();
      await loadFeeStudentSummary(studentUid);
    } catch (error) {
      Alert.alert('Create failed', error instanceof Error ? error.message : 'Could not create the fee plan.');
    } finally {
      setFeeCreateSubmitting(false);
    }
  }, [
    apiJson,
    feeCreateBatchName,
    feeCreateDiscountAmount,
    feeCreateInstallmentCount,
    feeCreateMode,
    feeCreateStartDate,
    feeCreateStudentUid,
    feeCreateTotalAmount,
    feePlanCreatedBy,
    feeStudentSummary?.student?.batch_name,
    feeStudentSummary?.student?.student_uid,
    feeStudentUid,
    loadFeeStudentSummary,
    loadFeeWorkspace,
    session?.type
  ]);

  const loadAdmin = useCallback(async () => {
    const payload = await apiJson<{ status: string } & SystemStats>('/api/admin/system_stats');
    setSystemStats(payload);
    await persistAppCache({ workspaceRole: 'staff', systemStats: payload });
  }, [apiJson, persistAppCache]);

  const loadTestAdmin = useCallback(async () => {
    const [papersPayload, launchesPayload, submissionsPayload] = await Promise.all([
      apiJson<{ status: string; papers: TestPaperSummary[] }>('/api/tests/papers'),
      apiJson<{ status: string; launches: TestLaunchSummary[] }>('/api/tests/launches'),
      apiJson<{ status: string; submissions: StaffSubmissionRow[] }>(selectedLaunchId ? `/api/tests/submissions?launch_id=${encodeURIComponent(selectedLaunchId)}` : '/api/tests/submissions')
    ]);
    const nextPapers = Array.isArray(papersPayload.papers) ? papersPayload.papers : [];
    const nextLaunches = Array.isArray(launchesPayload.launches) ? launchesPayload.launches : [];
    setTestPapers(nextPapers);
    setTestLaunches(nextLaunches);
    setTestSubmissions(Array.isArray(submissionsPayload.submissions) ? submissionsPayload.submissions : []);
    await persistAppCache({
      workspaceRole: 'staff',
      testPapers: nextPapers,
      testLaunches: nextLaunches,
      testSubmissions: Array.isArray(submissionsPayload.submissions) ? submissionsPayload.submissions : []
    });
    if (!selectedPaperId && nextPapers[0]) setSelectedPaperId(String(nextPapers[0].id));
    if (!selectedLaunchId && nextLaunches[0]) setSelectedLaunchId(String(nextLaunches[0].id));
  }, [apiJson, persistAppCache, selectedLaunchId, selectedPaperId]);

  const loadScoreboard = useCallback(async (launchId: number, role: 'student' | 'staff') => {
    const path = role === 'student' ? `/api/student/tests/${launchId}/scoreboard` : `/api/tests/launches/${launchId}/scoreboard`;
    const payload = await apiJson<{ status: string } & ScoreboardPayload>(path);
    setScoreboardPayload(payload);
    setSelectedScoreboardLaunchId(String(launchId));
  }, [apiJson]);

  const loadDoubts = useCallback(async (type: 'student' | 'staff', studentUid?: string, overFilter?: string, force = false) => {
    const currentUi = uiSnapshotRef.current;
    const filter = overFilter || (type === 'staff' ? currentUi.doubtBatchFilter : '');
    const endpoint = type === 'student'
      ? (studentUid ? `/api/doubts/student/${encodeURIComponent(studentUid)}` : '')
      : (filter && filter !== 'ALL' ? `/api/doubts/pending/batch/${encodeURIComponent(filter)}` : '/api/doubts/pending');
    if (!endpoint) {
      setStudentDoubts([]);
      return;
    }
    const cacheKey = type === 'student'
      ? `student_doubts:${studentUid || 'none'}`
      : `staff_doubts:${filter || 'all'}`;
    const payload = await loadCachedJson<{ doubts: DoubtItem[] }>(cacheKey, endpoint, {
      force,
      ttlMs: 90 * 1000,
      transform: (value) => ({ doubts: Array.isArray(value?.doubts) ? value.doubts : [] })
    });
    if (type === 'student') setStudentDoubts(Array.isArray(payload.doubts) ? payload.doubts : []);
    else setStaffDoubts(Array.isArray(payload.doubts) ? payload.doubts : []);
  }, [loadCachedJson]);

  const loadMobileManifest = useCallback(async (force = false) => {
    const now = Date.now();
    if (mobileManifestInFlightRef.current) {
      return mobileManifestInFlightRef.current;
    }
    if (!force && mobileManifestLoadedAtRef.current && now - mobileManifestLoadedAtRef.current < 30 * 1000) {
      return mobileManifestBlockedRef.current;
    }
    const pending = (async () => {
        const requestId = ++mobileManifestRequestRef.current;
        try {
          const payload = await retryWithBackoff(
            () => apiJson<MobileManifestPayload>(`/api/mobile/manifest?app_version=${encodeURIComponent(APP_VERSION)}${force ? '&force=1' : ''}`),
            {
              attempts: force ? 3 : 2,
              delaysMs: force ? [300, 1000] : [250],
              shouldRetry: shouldRetryManifestFetch
            }
          );
          if (mobileManifestRequestRef.current !== requestId) return mobileManifestBlockedRef.current;
          const localConfigVersion = Math.max(
            Number(appCacheRef.current.mobileManifest?.app.config_version || 0) || 0,
            Number(staffOtaAppliedConfigVersion || 0) || 0,
            Number(appCacheRef.current.staffOtaAppliedConfigVersion || 0) || 0,
            Number(staffOtaAppliedConfigVersionRef.current || 0) || 0
          );
          const remoteConfigVersion = Number(payload?.app?.config_version || 1) || 1;
          const configUpdateAvailable = sessionRef.current?.type === 'staff'
            && isStaffOtaUpdateMode(payload?.app?.update_mode)
            && remoteConfigVersion > localConfigVersion;
        const result = applyMobileManifest(payload, { commitConfig: !configUpdateAvailable });
          if (payload.checked_at) {
            setMobileManifestCheckedAt(payload.checked_at);
          }
          mobileManifestBlockedRef.current = Boolean(result.forceUpdate && result.updateAvailable);
          mobileManifestLoadedAtRef.current = Date.now();
        return mobileManifestBlockedRef.current;
      } catch (error) {
        const cached = appCacheRef.current.mobileManifest || null;
        if (cached) {
          const result = applyMobileManifest(cached);
          mobileManifestBlockedRef.current = Boolean(result.forceUpdate && result.updateAvailable);
          mobileManifestLoadedAtRef.current = Date.now();
          return mobileManifestBlockedRef.current;
        }
        mobileManifestLoadedAtRef.current = Date.now();
        mobileManifestBlockedRef.current = false;
        return false;
      }
    })();
    mobileManifestInFlightRef.current = pending;
    try {
      return await pending;
    } finally {
      if (mobileManifestInFlightRef.current === pending) {
        mobileManifestInFlightRef.current = null;
      }
    }
  }, [apiJson, applyMobileManifest]);

  const scheduleManifestRefresh = useCallback((_reason: string, delayMs = 750, force = false) => {
    if (mobileManifestRefreshTimerRef.current) {
      clearTimeout(mobileManifestRefreshTimerRef.current);
      mobileManifestRefreshTimerRef.current = null;
    }
    mobileManifestRefreshForceRef.current = mobileManifestRefreshForceRef.current || force;
    mobileManifestRefreshTimerRef.current = setTimeout(() => {
      mobileManifestRefreshTimerRef.current = null;
      const nextForce = mobileManifestRefreshForceRef.current;
      mobileManifestRefreshForceRef.current = false;
      void loadMobileManifestRef.current?.(nextForce).catch(() => null);
    }, Math.max(200, delayMs));
    return true;
  }, []);

  const schedulePublicBatchesRefresh = useCallback((_reason: string, delayMs = 750, force = false) => {
    if (publicBatchesRefreshTimerRef.current) {
      clearTimeout(publicBatchesRefreshTimerRef.current);
      publicBatchesRefreshTimerRef.current = null;
    }
    publicBatchesRefreshForceRef.current = publicBatchesRefreshForceRef.current || force;
    publicBatchesRefreshTimerRef.current = setTimeout(() => {
      publicBatchesRefreshTimerRef.current = null;
      const nextForce = publicBatchesRefreshForceRef.current;
      publicBatchesRefreshForceRef.current = false;
      void loadPublicBatchesRef.current?.(nextForce).catch(() => null);
    }, Math.max(200, delayMs));
    return true;
  }, []);

  const acknowledgeStaffOtaPrompt = useCallback(async (manifestApp: MobileManifestPayload['app']) => {
    if (!manifestApp) return;
    const appliedConfigVersion = Number(manifestApp.config_version || 1) || 1;
    staffOtaAppliedConfigVersionRef.current = Math.max(staffOtaAppliedConfigVersionRef.current, appliedConfigVersion);
    setStaffOtaAppliedConfigVersion((current) => Math.max(current, appliedConfigVersion));
    console.log('[StaffOTA] applied version persisted ' + JSON.stringify({
      appliedConfigVersion
    }));
    const nextManifest: MobileManifestPayload = {
      status: appCacheRef.current.mobileManifest?.status || 'success',
      ...(appCacheRef.current.mobileManifest || {}),
      app: {
        ...manifestApp,
        update_mode: isStaffOtaUpdateMode(manifestApp.update_mode) ? manifestApp.update_mode : 'ota',
        config_version: appliedConfigVersion,
        release_notes: Array.isArray(manifestApp.release_notes)
          ? manifestApp.release_notes.map((note) => String(note ?? '').trim()).filter(Boolean)
          : []
      },
      feed: appCacheRef.current.mobileManifest?.feed || { items: [] }
    };
    appCacheRef.current = {
      ...appCacheRef.current,
      mobileManifest: nextManifest
    };
    setMobileManifest(nextManifest);
    setPendingMobileManifest(null);
    setMobileUpdatePrompt(null);
    mobileManifestBlockedRef.current = false;
    mobileManifestLoadedAtRef.current = Date.now();
    await SecureStore.setItemAsync(STAFF_OTA_APPLIED_CONFIG_VERSION_KEY, String(appliedConfigVersion)).catch(() => null);
    await persistAppCache({
      mobileManifest: nextManifest,
      staffOtaAppliedConfigVersion: appliedConfigVersion
    });
  }, [persistAppCache]);

  const performStaffExpoUpdate = useCallback(async (source: 'auto' | 'manual') => {
    if (Platform.OS === 'web' || !Updates.isEnabled) {
      if (source === 'manual') {
        Alert.alert('Update unavailable', 'This build does not have Expo OTA updates enabled yet.');
      }
      return false;
    }
    if (sessionRef.current?.type !== 'staff') {
      if (source === 'manual') {
        Alert.alert('Update unavailable', 'This update is only available on staff devices.');
      }
      return false;
    }

    const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
    const maxAttempts = 3;

    try {
      syncExpoUpdateRequestHeadersForSession(sessionRef.current?.type);
      if (mobileUpdatePrompt && isStaffOtaUpdateMode(mobileUpdatePrompt.update_mode)) {
        await acknowledgeStaffOtaPrompt(mobileUpdatePrompt);
      }
      setBusyMessage('Checking for staff update...');
      setBusyProgress(20);
      await nextTick();

      const update = await retryWithBackoff(
        () => {
          syncExpoUpdateRequestHeadersForSession(sessionRef.current?.type);
          return Updates.checkForUpdateAsync();
        },
        {
          attempts: maxAttempts,
          delaysMs: [350, 1200],
          shouldRetry: isTransientExpoUpdateError
        }
      );

      if (!update.isAvailable) {
        if (mobileUpdatePrompt && isStaffOtaUpdateMode(mobileUpdatePrompt.update_mode)) {
          await acknowledgeStaffOtaPrompt(mobileUpdatePrompt);
        }
        if (source === 'auto') {
          staffOtaAutoCheckDoneRef.current = true;
          staffOtaAutoRetryCountRef.current = 0;
        } else {
          setMobileUpdatePrompt(null);
          Alert.alert('Update unavailable', 'This staff OTA is already installed on this device.');
        }
        return false;
      }

      setBusyMessage('Downloading staff update...');
      setBusyProgress(65);
      await nextTick();

      await retryWithBackoff(
        () => {
          syncExpoUpdateRequestHeadersForSession(sessionRef.current?.type);
          return Updates.fetchUpdateAsync();
        },
        {
          attempts: maxAttempts,
          delaysMs: [500, 1500],
          shouldRetry: isTransientExpoUpdateError
        }
      );

      if (!mobileUpdatePrompt) return false;
      await acknowledgeStaffOtaPrompt(mobileUpdatePrompt);
      setBusyMessage('Applying staff update...');
      setBusyProgress(95);
      await nextTick();
      if (source === 'auto') {
        staffOtaAutoCheckDoneRef.current = true;
        staffOtaAutoRetryCountRef.current = 0;
      }
      setBusyMessage('');
      setBusyProgress(null);
      void Updates.reloadAsync().catch((reloadError) => {
        console.warn('[OTA] Reload after staff update failed:', reloadError);
      });
      return true;
    } catch (error) {
      console.warn('[OTA] Staff update failed:', error);
      const message = getErrorMessage(error);
      const retryable = isTransientExpoUpdateError(error);
      if (source === 'auto' && retryable && staffOtaAutoRetryCountRef.current < 2) {
        const attempt = staffOtaAutoRetryCountRef.current + 1;
        staffOtaAutoRetryCountRef.current = attempt;
        const retryDelayMs = [3000, 8000][Math.min(attempt - 1, 1)] || 3000;
        setBusyMessage(`Retrying staff update (${attempt + 1}/3)...`);
        setBusyProgress(35);
        if (staffOtaAutoRetryTimerRef.current) clearTimeout(staffOtaAutoRetryTimerRef.current);
        staffOtaAutoRetryTimerRef.current = setTimeout(() => {
          staffOtaAutoRetryTimerRef.current = null;
          void performStaffExpoUpdate('auto').catch(() => null);
        }, retryDelayMs);
        return false;
      }

      if (source === 'auto') {
        staffOtaAutoCheckDoneRef.current = true;
        staffOtaAutoRetryCountRef.current = 0;
        console.warn('[OTA] Auto-check gave up after retries:', message);
      } else {
        Alert.alert('Update failed', message || 'Could not download the staff OTA update.');
      }
      return false;
    } finally {
      if (source === 'manual' || staffOtaAutoCheckDoneRef.current) {
        setBusyMessage('');
        setBusyProgress(null);
      } else if (!staffOtaAutoRetryTimerRef.current) {
        setBusyMessage('');
        setBusyProgress(null);
      }
    }
  }, []);

  const handleMobileUpdateAction = useCallback(async () => {
    if (!mobileUpdatePrompt) return;
    console.log('[MobileManifest] update button pressed ' + JSON.stringify({
      updateMode: mobileUpdatePrompt.update_mode,
      configVersion: Number(mobileUpdatePrompt.config_version || 0) || 0
    }));
    if (mobileUpdatePrompt.update_mode === 'apk') {
      const targetUrl = makeAbsoluteUrl(baseUrl, mobileUpdatePrompt.apk_url || '/apk/rmc-mobile.apk');
      await Linking.openURL(targetUrl);
      return;
    }
    if (sessionRef.current?.type !== 'staff' || !isStaffOtaUpdateMode(mobileUpdatePrompt.update_mode)) {
      Alert.alert('Update unavailable', 'This update is only available on staff devices.');
      return;
    }
    await acknowledgeStaffOtaPrompt(mobileUpdatePrompt);
    await performStaffExpoUpdate('manual');
  }, [baseUrl, mobileUpdatePrompt, performStaffExpoUpdate]);

  const hydrateStaffWorkspace = useCallback(async (force = false) => {
    setBusyMessage('Downloading batch and session data...');
    setBusyProgress(15);
    const nextSession = await loadStaffCore(force);
    setBusyMessage('Downloading student directory...');
    setBusyProgress(30);
    await loadStudentDirectory(force, true).catch(() => null);
    setBusyMessage('Downloading roster and attendance data...');
    setBusyProgress(40);
    const nextBatch = lastKnownAttendanceBatchRef.current || nextSession?.batch_id || '';
    await loadRoster(nextSession?.session_id, nextBatch, force, true);
    setBusyProgress(100);
    return nextSession;
  }, [loadRoster, loadStaffCore, loadStudentDirectory]);

  const recoverStaffSession = useCallback(async () => {
    if (staffSessionRecoveryInFlightRef.current) return false;
    const username = String(sessionRef.current?.type === 'staff'
      ? sessionRef.current.user.username
      : staffUsername).trim();
    if (!username) return false;

    const deviceId = deviceIdRef.current || await getOrCreateDeviceId();
    deviceIdRef.current = deviceId;
    const secret = await readStaffLoginSecret(deviceId, username).catch(() => null);
    if (!secret) return false;

    staffSessionRecoveryInFlightRef.current = true;
    try {
      await persistCookie('');
      const response = await fetch(makeAbsoluteUrl(baseUrl, '/api/login'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password: secret })
      });

      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        cookieRef.current = mergeCookieHeaders(cookieRef.current, setCookie);
        setCookieHeader(cookieRef.current);
        await SecureStore.setItemAsync(STORAGE_COOKIE, cookieRef.current);
      }

      if (!response.ok) return false;
      const payload = await response.json().catch(() => null);
      if (!payload?.user || payload.user.role === 'student') return false;

      const nextSession = { type: 'staff' as const, user: payload.user };
      setSession(nextSession);
      await persistAppCache({ session: snapshotSession(nextSession), workspaceRole: 'staff' });
      await persistTrustedSession(nextSession);

      try {
        if (payload.bootstrap) {
          await applyStaffBootstrap(payload.bootstrap);
        } else {
          await hydrateStaffWorkspace(false);
        }
      } catch (workspaceError) {
        console.warn('[AUTH] Staff session recovery bootstrap failed, continuing with cached data:', workspaceError);
      }

      setOfflineMode(false);
      return true;
    } catch (error) {
      console.warn('[AUTH] Staff session recovery failed:', error);
      return false;
    } finally {
      staffSessionRecoveryInFlightRef.current = false;
    }
  }, [applyStaffBootstrap, baseUrl, hydrateStaffWorkspace, persistAppCache, persistCookie, persistTrustedSession, staffUsername]);

  useEffect(() => {
    recoverStaffSessionRef.current = recoverStaffSession;
  }, [recoverStaffSession]);

  const submitDoubt = useCallback(async () => {
    if (!newDoubtText.trim()) return;
    setBusyMessage('Submitting doubt...');
    try {
      const formData = new FormData();
      formData.append('question_text', newDoubtText.trim());
      if (newDoubtPhoto) {
        formData.append('question_image', { uri: newDoubtPhoto, name: 'doubt.jpg', type: 'image/jpeg' } as never);
      }
      await apiUpload('/api/doubts', formData);
      setNewDoubtText('');
      setNewDoubtPhoto('');
      await loadDoubts('student', session?.type === 'student' ? session.student.student_uid : undefined, undefined, true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Submit failed', error instanceof Error ? error.message : 'Could not submit doubt.');
    }
  }, [apiJson, apiUpload, loadDoubts, newDoubtPhoto, newDoubtText, session]);

  const replyDoubt = useCallback(async (doubtId: number) => {
    setBusyMessage('Replying...');
    try {
      const formData = new FormData();
      if (doubtReplyPhoto) {
        formData.append('reply_image', { uri: doubtReplyPhoto, name: 'reply.jpg', type: 'image/jpeg' } as never);
      }
      await apiUpload(`/api/doubts/${doubtId}/reply`, formData);
      setDoubtReplyPhoto('');
      await loadDoubts('staff', undefined, undefined, true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Reply failed', error instanceof Error ? error.message : 'Could not reply.');
    }
  }, [apiUpload, loadDoubts, doubtReplyPhoto]);

  const refreshStaffWorkspace = useCallback(async (force = false) => {
    const nextSession = await loadStaffCore(force);
    const manifestBlocked = await loadMobileManifest(true).catch(() => false);
    if (manifestBlocked) {
      return nextSession;
    }
    const nextBatch = lastKnownAttendanceBatchRef.current || nextSession?.batch_id || '';
    await loadStudentDirectory(force, true).catch(() => null);
    if (nextSession?.session_id && nextBatch) {
      await loadRoster(nextSession.session_id, nextBatch, force, staffTab === 'attendance').catch(() => null);
    }
    if (staffTab === 'materials') await loadMaterials(force);
    if (staffTab === 'home' || staffTab === 'notifications') await loadLeads(force);
    if (staffTab === 'notifications') await loadNotices(force);
    if (staffTab === 'reports') await loadReports(undefined, force);
    if (isTestCloneServer && staffTab === 'fees') await loadFeeWorkspace();
    if (staffTab === 'doubts') await loadDoubts('staff', undefined, undefined, force);
    if (staffTab === 'admin' && isHost) await loadAdmin();
  }, [isHost, isTestCloneServer, loadAdmin, loadDoubts, loadFeeWorkspace, loadLeads, loadMaterials, loadNotices, loadReports, loadRoster, loadStaffCore, loadStudentDirectory, staffTab]);

  const refreshAll = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const manifestBlocked = await loadMobileManifest(force);
      if (manifestBlocked) {
        return;
      }
      const current = await syncSession();
      if (!current) {
        await loadPublicBatches(force);
        return;
      }
      if (current.type === 'student') {
        await Promise.all([loadStudentPortal(force), loadStudentTests(force), loadDoubts('student', current.student.student_uid, undefined, force)]);
      } else {
        await refreshStaffWorkspace(force);
      }
    } finally {
      setRefreshing(false);
    }
  }, [loadDoubts, loadMobileManifest, loadPublicBatches, loadStudentPortal, loadStudentTests, refreshStaffWorkspace, syncSession]);

  const websocketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<SessionInfo>(session);
  const currentSessionRef = useRef<AttendanceWorkspaceSession | null>(currentSession);
  const attendanceSessionNameRef = useRef(attendanceSessionName);
  const refreshAllRef = useRef(refreshAll);
  const refreshStaffWorkspaceRef = useRef(refreshStaffWorkspace);
  const refreshAttendanceWorkspaceRef = useRef(refreshAttendanceWorkspace);
  const refreshLiveSessionStateRef = useRef(refreshLiveSessionState);
  const loadStaffCoreRef = useRef(loadStaffCore);
  const loadStudentPortalRef = useRef(loadStudentPortal);
  const loadMaterialsRef = useRef(loadMaterials);
  const loadNoticesRef = useRef(loadNotices);
  const loadLeadsRef = useRef(loadLeads);
  const loadDoubtsRef = useRef(loadDoubts);
  const loadMobileManifestRef = useRef(loadMobileManifest);
  const applyCachedWorkspaceRef = useRef(applyCachedWorkspace);
  const syncSessionRef = useRef(syncSession);
  const loadStudentTestsRef = useRef(loadStudentTests);
  const loadPublicBatchesRef = useRef(loadPublicBatches);
  const loadSmsBatchInsightsRef = useRef(loadSmsBatchInsights);
  const liveNotificationDedupRef = useRef({ key: '', at: 0 });
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const studentMaterialsSignatureRef = useRef('');
  const studentNoticesSignatureRef = useRef('');
  const staffMaterialsSignatureRef = useRef('');
  const staffNoticesSignatureRef = useRef('');
  const mobileManifestInFlightRef = useRef<Promise<boolean> | null>(null);
  const mobileManifestLoadedAtRef = useRef(0);
  const mobileManifestBlockedRef = useRef(false);
  const mobileManifestRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileManifestRefreshForceRef = useRef(false);
  const staffOtaAppliedConfigVersionRef = useRef(0);
  const staffOtaAutoCheckInFlightRef = useRef(false);
  const staffOtaAutoCheckDoneRef = useRef(false);
  const staffOtaAutoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staffOtaAutoRetryCountRef = useRef(0);
  const publicBatchesInFlightRef = useRef<Promise<Batch[]> | null>(null);
  const publicBatchesLoadedAtRef = useRef(0);
  const publicBatchesRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publicBatchesRefreshForceRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    syncExpoUpdateRequestHeadersForSession(sessionRef.current?.type);
    if (session?.type !== 'staff' && staffOtaAutoRetryTimerRef.current) {
      clearTimeout(staffOtaAutoRetryTimerRef.current);
      staffOtaAutoRetryTimerRef.current = null;
      staffOtaAutoRetryCountRef.current = 0;
    }
  }, [session?.type]);

  useEffect(() => {
    if (Platform.OS === 'web' || !Updates.isEnabled || session?.type !== 'staff') {
      staffOtaAutoCheckDoneRef.current = false;
      staffOtaAutoRetryCountRef.current = 0;
      if (staffOtaAutoRetryTimerRef.current) {
        clearTimeout(staffOtaAutoRetryTimerRef.current);
        staffOtaAutoRetryTimerRef.current = null;
      }
      return;
    }
    if (staffOtaAutoCheckDoneRef.current || staffOtaAutoCheckInFlightRef.current) {
      return;
    }

    staffOtaAutoCheckInFlightRef.current = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const reloaded = await performStaffExpoUpdate('auto');
          if (reloaded) {
            console.log('[OTA] Staff update applied successfully.');
          }
        } catch (error) {
          console.warn('[OTA] Staff auto-check failed:', error);
        } finally {
          if (!staffOtaAutoRetryTimerRef.current) {
            setBusyMessage('');
            setBusyProgress(null);
          }
          staffOtaAutoCheckInFlightRef.current = false;
        }
      })();
    }, 500);

    return () => {
      clearTimeout(timer);
      if (staffOtaAutoRetryTimerRef.current) {
        clearTimeout(staffOtaAutoRetryTimerRef.current);
        staffOtaAutoRetryTimerRef.current = null;
      }
    };
  }, [performStaffExpoUpdate, session?.type]);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    attendanceSessionNameRef.current = attendanceSessionName;
  }, [attendanceSessionName]);

  useEffect(() => {
    refreshAllRef.current = refreshAll;
    refreshStaffWorkspaceRef.current = refreshStaffWorkspace;
    refreshAttendanceWorkspaceRef.current = refreshAttendanceWorkspace;
    refreshLiveSessionStateRef.current = refreshLiveSessionState;
    loadStaffCoreRef.current = loadStaffCore;
    loadStudentPortalRef.current = loadStudentPortal;
    loadMaterialsRef.current = loadMaterials;
    loadNoticesRef.current = loadNotices;
    loadLeadsRef.current = loadLeads;
    loadDoubtsRef.current = loadDoubts;
    loadMobileManifestRef.current = loadMobileManifest;
    applyCachedWorkspaceRef.current = applyCachedWorkspace;
    syncSessionRef.current = syncSession;
    loadStudentTestsRef.current = loadStudentTests;
    loadPublicBatchesRef.current = loadPublicBatches;
    loadSmsBatchInsightsRef.current = loadSmsBatchInsights;
  }, [
    loadDoubts,
    loadLeads,
    loadMaterials,
    loadNotices,
    loadStaffCore,
    loadStudentPortal,
    loadMobileManifest,
    refreshAll,
    refreshStaffWorkspace,
    applyCachedWorkspace,
    syncSession,
    loadStudentTests,
    loadPublicBatches,
    loadSmsBatchInsights,
    refreshAttendanceWorkspace
  ]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const type = String(notification.request.content.data?.type || '');
      console.log('[Push] Notification received:', type || 'unknown');
      if (type === 'material' || type === 'material_deleted') {
        void (sessionRef.current?.type === 'student'
          ? loadStudentPortalRef.current(true)
          : refreshStaffWorkspaceRef.current(true));
      } else if (type === 'notice') {
        void (sessionRef.current?.type === 'student'
          ? loadStudentPortalRef.current(true)
          : refreshStaffWorkspaceRef.current(true));
      } else if (type === 'app_update') {
        void loadMobileManifestRef.current(true);
      } else if ((type === 'student_registered' || type === 'student_first_login') && sessionRef.current?.type === 'staff') {
        void refreshStaffWorkspaceRef.current(true);
      }
    });
    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      const type = String(event.notification.request.content.data?.type || '');
      if (type === 'material' || type === 'material_deleted') {
        void (sessionRef.current?.type === 'student'
          ? loadStudentPortalRef.current(true)
          : refreshStaffWorkspaceRef.current(true));
      } else if (type === 'notice') {
        void (sessionRef.current?.type === 'student'
          ? loadStudentPortalRef.current(true)
          : refreshStaffWorkspaceRef.current(true));
      } else if (type === 'app_update') {
        void loadMobileManifestRef.current(true);
      } else if ((type === 'student_registered' || type === 'student_first_login') && sessionRef.current?.type === 'staff') {
        void refreshStaffWorkspaceRef.current(true);
      }
    });
    return () => {
      received.remove();
      response.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const authSession = sessionRef.current;
      if (previousState !== 'active' && nextState === 'active' && (authSession || currentSessionRef.current)) {
        console.log('[AppState] App returned to foreground, refreshing session data');
        if (authSession?.type === 'student') {
          void loadStudentPortalRef.current(true);
          void loadStudentTestsRef.current(true);
          void loadDoubtsRef.current('student', authSession.student.student_uid, undefined, true);
        } else {
          void refreshLiveSessionStateRef.current(true);
        }
        void scheduleManifestRefresh('foreground', 850, false);
        void scheduleLocalAttendanceReplay('foreground', { immediate: true });
      }
    });
    return () => subscription.remove();
  }, [scheduleLocalAttendanceReplay, scheduleManifestRefresh]);

  useEffect(() => {
    if (!currentSession?.session_id || currentSession.status === 'closed') return;

    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      void refreshLiveSessionStateRef.current(true, currentSession.batch_id || attendanceBatch || lastKnownAttendanceBatchRef.current || '');
      void scheduleLocalAttendanceReplay('staff-session-poll', { immediate: false });
    };

    tick();
    const interval = setInterval(tick, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [attendanceBatch, currentSession?.session_id, currentSession?.status, scheduleLocalAttendanceReplay]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    if (currentSession?.session_id && currentSession.status !== 'closed') return;

    let mounted = true;
    let inFlight = false;
    const tick = () => {
      if (!mounted || inFlight) return;
      inFlight = true;
      void (async () => {
        const runningSession = await fetchRunningAttendanceSessionOnce();
        if (!mounted) {
          return;
        }
        if (!runningSession?.session_id || runningSession.status === 'closed') {
          void refreshLiveSessionStateRef.current(true, attendanceBatch || lastKnownAttendanceBatchRef.current || smsBatch || '').catch(() => null);
          return;
        }
        const resolvedSession = resolveActiveAttendanceSessionFromLedger({
          cache: appCacheRef.current,
          preferredSession: runningSession,
          serverSession: runningSession,
          attendanceBatch: attendanceBatch || lastKnownAttendanceBatchRef.current || '',
          attendanceSessionName: attendanceSessionNameRef.current,
          offlineAttendanceSessionKey: offlineAttendanceSessionKeyRef.current,
          allowLocalOpenSession: false
        });
        const nextSession = resolvedSession.currentSession || runningSession;
        if (!nextSession?.session_id || nextSession.status === 'closed') {
          return;
        }
        await applyStartedAttendanceSession(nextSession, resolvedSession.attendanceBatch || nextSession.batch_id || attendanceBatch, resolvedSession.attendanceSessionName || attendanceSessionNameRef.current || '').catch(() => null);
      })().finally(() => {
      inFlight = false;
      });
    };

    tick();
    const interval = setInterval(tick, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [applyStartedAttendanceSession, attendanceBatch, attendanceSessionNameRef, currentSession?.session_id, currentSession?.status, fetchRunningAttendanceSessionOnce, refreshLiveSessionStateRef, session?.type, smsBatch]);

    const pushRegistrationScope = session?.type === 'staff'
      ? `staff:${session.user.id || session.user.username}`
      : session?.type === 'student'
        ? `student:${session.student.id || session.student.student_uid}`
        : 'device';

    useEffect(() => {
      if (!session) {
        mobilePushRegistrationRef.current = '';
        void registerMobilePushToken(null, 'device').catch((error) => {
          console.warn('[Push] Device registration failed:', error);
        });
        return;
      }
      void registerMobilePushToken(session).catch((error) => {
        console.warn('[Push] Registration failed:', error);
      });
    }, [pushRegistrationScope, registerMobilePushToken, session?.type]);

  useEffect(() => {
    if (!session || !baseUrl) return;

    let socket: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connect = () => {
      const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

      try {
        socket = new WebSocket(wsUrl);
        websocketRef.current = socket;

        socket.onopen = () => {
          console.log('[WebSocket] Connected');
        };

        socket.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            const eventType = String(data?.type || '');
            const eventBatch = String(
              data?.batch_id
              || data?.batchName
              || data?.session?.batch_id
              || data?.current_session?.batch_id
              || ''
            ).trim();
            if (['roster_update', 'attendance_marked', 'session_started', 'session_closed', 'session_late_mode'].includes(eventType)) {
              void refreshLiveSessionStateRef.current(true, eventBatch);
              void loadStaffCoreRef.current(true);
              void schedulePublicBatchesRefresh(eventType, 850, true);
            } else if (eventType === 'batch_updated' || eventType === 'student_records_updated') {
              void loadStaffCoreRef.current(true);
              void schedulePublicBatchesRefresh(eventType, 850, true);
              if (sessionRef.current?.type === 'student') {
                void loadStudentPortalRef.current(true);
              }
            } else if (eventType === 'student_registered' || eventType === 'student_first_login') {
              if (sessionRef.current?.type === 'staff') {
                void scheduleManifestRefresh(eventType, 850, true);
                void refreshStaffWorkspaceRef.current(true);
                void showLiveNotification(
                  eventType === 'student_first_login' ? 'Student opened the app' : 'New student joined',
                  eventType === 'student_first_login'
                    ? `${String(data?.name || 'A student')} just logged into the app for the first time${Array.isArray(data?.batches) && data.batches.length ? ` in ${data.batches.join(', ')}` : ''}.`
                    : `${String(data?.name || 'A student')} just registered${Array.isArray(data?.batches) && data.batches.length ? ` in ${data.batches.join(', ')}` : ''}.`,
                  { type: eventType }
                );
              }
            } else if (eventType === 'system_reset') {
              void refreshAllRef.current(true);
            } else if (eventType === 'notice_update' || eventType === 'student_notice') {
              void loadNoticesRef.current(true);
              void scheduleManifestRefresh(eventType, 850, true);
              if (sessionRef.current?.type === 'student') {
                void loadStudentPortalRef.current(true);
                void showLiveNotification(
                  'New notice',
                  'A new notice was published. Open Notices to review it.',
                  { type: 'notice' }
                );
              } else if (sessionRef.current?.type === 'staff') {
                void refreshStaffWorkspaceRef.current(true);
                void showLiveNotification(
                  'New notice',
                  'A new notice was published. Open Inbox to review it.',
                  { type: 'notice' }
                );
              }
            } else if (eventType === 'material_update' || eventType === 'material_deleted') {
              void loadMaterialsRef.current(true);
              void scheduleManifestRefresh(eventType, 850, true);
              if (sessionRef.current?.type === 'student') {
                void loadStudentPortalRef.current(true);
                void showLiveNotification(
                  eventType === 'material_deleted' ? 'Material deleted' : 'New material',
                  eventType === 'material_deleted'
                    ? 'A study material was removed. Open Materials to review the latest list.'
                    : 'A new study material was uploaded. Open Materials to review it.',
                  { type: eventType === 'material_deleted' ? 'material_deleted' : 'material' }
                );
              } else if (sessionRef.current?.type === 'staff') {
                void refreshStaffWorkspaceRef.current(true);
                void showLiveNotification(
                  eventType === 'material_deleted' ? 'Material deleted' : 'New material',
                  eventType === 'material_deleted'
                    ? 'A study material was removed. Open Library to review it.'
                    : 'A new study material was uploaded. Open Library to review it.',
                  { type: eventType === 'material_deleted' ? 'material_deleted' : 'material' }
                );
              }
            } else if (eventType === 'lead') {
              void loadLeadsRef.current(true);
            } else if (eventType === 'doubt_update') {
              if (sessionRef.current?.type === 'staff') {
                void loadDoubtsRef.current('staff', undefined, undefined, true);
              }
              if (sessionRef.current?.type === 'student') {
                void loadDoubtsRef.current('student', sessionRef.current.student.student_uid, undefined, true);
              }
            }
          } catch (err) {
            console.error('[WebSocket] Parse error:', err);
          }
        };

        socket.onclose = (e) => {
          console.log('[WebSocket] Closed:', e.code, e.reason);
          reconnectTimeout = setTimeout(connect, 5000);
        };

        socket.onerror = (e) => {
          console.error('[WebSocket] Error:', e);
        };
      } catch (err) {
        console.error('[WebSocket] Setup error:', err);
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [baseUrl, session ? 1 : 0]);

  useEffect(() => {
    if (startupBootDoneRef.current || startupBootInFlightRef.current) {
      return;
    }
    startupBootInFlightRef.current = true;
    void (async () => {
      try {
        const [cached, cachedStaffCore, cachedStudentDirectory, cachedTrustedSessions, deviceId, persistedAppliedVersionRaw] = await Promise.all([
          readAppCache(),
          readStaffCoreCache(),
          readStudentDirectoryCache(),
          readLocalJson<TrustedSessionRecord[]>(TRUSTED_SESSION_CACHE_KEY),
          getOrCreateDeviceId(),
          SecureStore.getItemAsync(STAFF_OTA_APPLIED_CONFIG_VERSION_KEY).catch(() => '')
        ]);
        deviceIdRef.current = deviceId;
        trustedSessionsRef.current = Array.isArray(cachedTrustedSessions) ? cachedTrustedSessions : [];
        const freshSessionState = await ensureFreshAttendanceSessionCache(cached, cachedStaffCore);
        const appliedConfigVersion = Number(String(persistedAppliedVersionRaw || '').trim() || 0) || 0;
        staffOtaAppliedConfigVersionRef.current = appliedConfigVersion;
        setStaffOtaAppliedConfigVersion(appliedConfigVersion);
        appCacheRef.current = normalizeLocalAttendanceCache({
          ...freshSessionState.cache,
          staffOtaAppliedConfigVersion: Math.max(
            Number(freshSessionState.cache.staffOtaAppliedConfigVersion || 0) || 0,
            appliedConfigVersion
          )
        });
        applyCachedWorkspaceRef.current?.(appCacheRef.current);
        applyStaffCoreSnapshot(freshSessionState.staffCore);
        applyStudentDirectorySnapshot(cachedStudentDirectory);
        const storedCookie = (await SecureStore.getItemAsync(STORAGE_COOKIE)) || '';
        const storedBaseUrl = (await SecureStore.getItemAsync(STORAGE_BASE_URL)) || '';
        const initialBaseUrl = await resolveStartupBaseUrl(storedBaseUrl);
        console.log('[RMC Mobile] startup base URL:', initialBaseUrl, 'stored:', storedBaseUrl || '(empty)');
        setBaseUrl(initialBaseUrl);
        setBaseUrlDraft(initialBaseUrl);
        await SecureStore.setItemAsync(STORAGE_BASE_URL, initialBaseUrl);
        cookieRef.current = storedCookie;
        setCookieHeader(storedCookie);
        const manifestBlocked = await loadMobileManifestRef.current?.(false).catch(() => false);
        bootManifestPrimedRef.current = true;
        if (manifestBlocked) {
          return;
        }
        const current = await syncSessionRef.current?.(false).catch(() => null);
        if (current?.type === 'student') {
          void Promise.all([
            loadStudentPortalRef.current?.(false),
            loadStudentTestsRef.current?.(false),
            loadDoubtsRef.current?.('student', current.student.student_uid, undefined, false)
          ].map((promise) => Promise.resolve(promise).catch(() => null)));
        } else if (current?.type === 'staff') {
          void refreshStaffWorkspaceRef.current?.(false).catch(() => null);
        } else if (!cached.publicBatches?.length) {
          void loadPublicBatchesRef.current?.(false).catch(() => null);
        }
      } finally {
        startupBootDoneRef.current = true;
        startupBootInFlightRef.current = false;
        setBooting(false);
        void scheduleLocalAttendanceReplay('app_start', { immediate: true });
      }
    })();
  }, [applyStaffCoreSnapshot, applyStudentDirectorySnapshot, scheduleLocalAttendanceReplay]);

  useEffect(() => {
    if (booting || !baseUrl || bootManifestPrimedRef.current) return;
    bootManifestPrimedRef.current = true;
    void loadMobileManifestRef.current?.(false).catch(() => null);
  }, [baseUrl, booting]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    (async () => {
      try {
        if (staffTab === 'materials') await loadMaterials(true);
        if (staffTab === 'notifications') await Promise.all([loadNotices(true), loadLeads(true)]);
        if (staffTab === 'doubts') await loadDoubts('staff', undefined, doubtBatchFilter, false);
        if (staffTab === 'admin' && isHost) await loadAdmin();
      } catch {
        // retry via refresh if needed
      }
    })();
    }, [isHost, loadAdmin, loadDoubts, loadLeads, loadMaterials, loadNotices, loadReports, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'reports') return;
    loadReports(reportBatch, true).catch(() => null);
  }, [loadReports, reportBatch, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'fees' || !isTestCloneServer) return;
    loadFeeWorkspace().catch(() => null);
  }, [isTestCloneServer, loadFeeWorkspace, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'fees' || !isTestCloneServer) return;
    if (feeStudentUid.trim()) return;
    const nextStudentUid = feePriorityRows[0]?.student_uid || feeDashboard?.recent_plans?.find((plan) => plan.student_uid)?.student_uid || '';
    if (!nextStudentUid) return;
    setFeeStudentUid(nextStudentUid);
    loadFeeStudentSummary(nextStudentUid).catch(() => null);
  }, [feeDashboard?.recent_plans, feePriorityRows, feeStudentUid, isTestCloneServer, loadFeeStudentSummary, session?.type, staffTab]);

  useEffect(() => {
    if (guestTab !== 'register' && (session?.type !== 'staff' || staffTab !== 'register')) return;
    void schedulePublicBatchesRefresh('guest_register', 850, true);
  }, [guestTab, session?.type, staffTab, schedulePublicBatchesRefresh]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'fees' || !isTestCloneServer) return;
    const summaryStudent = feeStudentSummary?.student;
    if (!summaryStudent?.student_uid) return;
    setFeeCreateStudentUid((current) => String(current || feeStudentUid || summaryStudent.student_uid || '').trim());
    setFeeCreateBatchName((current) => String(current || summaryStudent.batch_name || '').trim());
    setFeeStudentUid((current) => String(current || summaryStudent.student_uid || '').trim());
  }, [feeStudentSummary?.student?.batch_name, feeStudentSummary?.student?.student_uid, feeStudentUid, isTestCloneServer, session?.type, staffTab]);

  useEffect(() => {
    if (!batchHistory.length) return;
    if (!selectedAbsenteeSessionId || !batchHistory.some((entry) => String(entry.session_id || '') === selectedAbsenteeSessionId)) {
      const nextSessionId = String(batchHistory[batchHistory.length - 1]?.session_id || batchHistory[0]?.session_id || '');
      setSelectedAbsenteeSessionId(nextSessionId);
    }
  }, [batchHistory, selectedAbsenteeSessionId]);

  useEffect(() => {
    if (session?.type !== 'student') return;
    if (!selectedScoreboardLaunchId && studentTests.scoreboard_tests[0]) {
      setSelectedScoreboardLaunchId(String(studentTests.scoreboard_tests[0].launch_id));
    }
  }, [selectedScoreboardLaunchId, session?.type, studentTests.scoreboard_tests]);

  useEffect(() => {
    if (session?.type !== 'student' || !selectedScoreboardLaunchId) return;
    loadScoreboard(Number(selectedScoreboardLaunchId), 'student').catch(() => null);
  }, [loadScoreboard, selectedScoreboardLaunchId, session?.type]);

  useEffect(() => {
    if (session?.type !== 'staff' || !selectedLaunchId) return;
    loadScoreboard(Number(selectedLaunchId), 'staff').catch(() => null);
  }, [loadScoreboard, selectedLaunchId, session?.type]);

  useEffect(() => {
    if (uiPersistTimerRef.current) clearTimeout(uiPersistTimerRef.current);
    uiPersistTimerRef.current = setTimeout(() => {
      void persistAppCache({
        ui: {
          attendanceBatch: uiSnapshotRef.current.attendanceBatch,
          studentBatchFilter: uiSnapshotRef.current.studentBatchFilter,
          reportBatch: uiSnapshotRef.current.reportBatch,
          doubtBatchFilter: uiSnapshotRef.current.doubtBatchFilter,
          testBatch: uiSnapshotRef.current.testBatch,
          smsBatch: uiSnapshotRef.current.smsBatch,
          selectedLaunchId: uiSnapshotRef.current.selectedLaunchId,
          selectedPaperId: uiSnapshotRef.current.selectedPaperId,
          selectedAbsenteeSessionId: uiSnapshotRef.current.selectedAbsenteeSessionId,
          selectedScoreboardLaunchId: uiSnapshotRef.current.selectedScoreboardLaunchId,
          studentTab: uiSnapshotRef.current.studentTab,
          staffTab: uiSnapshotRef.current.staffTab,
          staffNotificationSection: uiSnapshotRef.current.staffNotificationSection
        }
      });
    }, 180);
    return () => {
      if (uiPersistTimerRef.current) clearTimeout(uiPersistTimerRef.current);
    };
  }, [
    attendanceBatch,
    doubtBatchFilter,
    persistAppCache,
    reportBatch,
    selectedAbsenteeSessionId,
    selectedLaunchId,
    selectedPaperId,
    selectedScoreboardLaunchId,
    smsBatch,
    staffNotificationSection,
    staffTab,
    studentBatchFilter,
    studentTab,
    testBatch
  ]);

  useEffect(() => {
    if (attendanceBatch) {
      lastKnownAttendanceBatchRef.current = attendanceBatch;
    }
  }, [attendanceBatch]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'students') return;
    loadStudentDirectory(false, true).catch(() => null);
  }, [loadStudentDirectory, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'attendance') return;
    const openSession = currentSession && currentSession.status !== 'closed' ? currentSession : null;
    if (openSession) {
      if (getSessionKeyForIdentity(currentSessionRef.current) !== openSession.sessionKey || currentSessionRef.current?.status === 'closed') {
        currentSessionRef.current = openSession;
        setCurrentSession(openSession);
      }
      if (openSession.batch_id && openSession.batch_id !== attendanceBatch) {
        setAttendanceBatch(openSession.batch_id);
      }
      if (openSession.session_name && !String(attendanceSessionName || '').trim()) {
        setAttendanceSessionName(openSession.session_name);
      }
      if (openSession.localSessionId) {
        offlineAttendanceSessionKeyRef.current = getLocalSessionKey(openSession.localSessionId);
      } else if (openSession.sessionKey) {
        offlineAttendanceSessionKeyRef.current = openSession.sessionKey;
      }
      const nextSessionId = openSession.session_id;
      const nextBatch = openSession.batch_id || attendanceBatch || '';
      if (nextBatch) {
        if (nextSessionId) {
          loadRoster(nextSessionId, nextBatch, false, true).catch(() => null);
        } else {
          loadRoster(undefined, nextBatch, false, true).catch(() => null);
        }
      }
      return;
    }

    const nextBatch = attendanceBatch || lastKnownAttendanceBatchRef.current || '';
    if (!nextBatch) {
      setRoster([]);
      setAttendanceDisplayRows([]);
      return;
    }
    loadRoster(undefined, nextBatch, false, true).catch(() => null);
    }, [attendanceBatch, attendanceSessionCacheRevision, attendanceSessionName, currentSession?.sessionKey, currentSession?.status, loadRoster, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    if (!smsBatch) {
      setSmsBatchHistory([]);
      return;
    }
    loadSmsBatchInsights(smsBatch).catch(() => null);
    }, [loadSmsBatchInsights, session?.type, smsBatch]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'sms') return;
    if (smsAudience !== 'session') {
      setSmsAudience('session');
    }
  }, [session?.type, staffTab, smsAudience]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    if (smsAudience !== 'session') return;
    const smsSessionCandidatesLocal = buildSmsSessionCandidates({
      batchName: smsBatch,
      history: smsBatchHistory,
      currentSession,
      sessionsByKey: appCacheRef.current.sessionsByKey,
      sessionAliasMap: appCacheRef.current.sessionAliasMap
    });
    if (!smsSessionCandidatesLocal.length) return;
    const sessionExists = smsSessionCandidatesLocal.some((entry) => entry.key === smsSessionId);
    if (!smsSessionId || !sessionExists) {
      const nextSessionId = smsSessionCandidatesLocal[0]?.key || '';
      setSmsSessionId(nextSessionId);
    }
  }, [attendanceSessionCacheRevision, session?.type, smsAudience, smsBatch, smsBatchHistory, smsSessionId]);

  const buildSuggestedSmsTemplate = useCallback(() => {
    const batchLabel = smsBatch || 'the selected batch';
    const smsSessionCandidatesLocal = buildSmsSessionCandidates({
      batchName: smsBatch,
      history: smsBatchHistory,
      currentSession,
      sessionsByKey: appCacheRef.current.sessionsByKey,
      sessionAliasMap: appCacheRef.current.sessionAliasMap
    });
    const selectedSession = smsSessionCandidatesLocal.find((entry) => entry.key === smsSessionId) || smsSessionCandidatesLocal[0] || null;
    const sessionLabel = selectedSession?.label || (smsBatch ? `${smsBatch} Attendance` : 'the selected session');
    const sessionDate = selectedSession?.date || '{{date}}';
    const recipientGreeting = normalizeSmsRecipientMode(smsRecipientMode) === 'guardian'
      ? 'Dear Parent/Guardian'
      : 'Hello {{name}}';

    if (smsAudience === 'session') {
      const activeStatuses = [...new Set(smsStatuses.map((status) => String(status || '').trim().toLowerCase()).filter(Boolean))];
      if (activeStatuses.length === 1 && activeStatuses[0] === 'present') {
        return `${recipientGreeting}, {{name}} has been marked PRESENT for ${sessionLabel} in batch {{batch}} on ${sessionDate}. Please review the app for the latest update.`;
      }
      if (activeStatuses.length === 1 && activeStatuses[0] === 'absent') {
        return `${recipientGreeting}, {{name}} was marked ABSENT for ${sessionLabel} in batch {{batch}} on ${sessionDate}. Please contact RMC if this needs correction.`;
      }
      if (activeStatuses.length === 1 && activeStatuses[0] === 'late') {
        return `${recipientGreeting}, {{name}} was marked LATE for ${sessionLabel} in batch {{batch}} on ${sessionDate}. Arrival time: {{arrival_time}}. Please review the attendance details.`;
      }
      return `${recipientGreeting}, {{name}} attendance update for ${sessionLabel} in batch {{batch}} on ${sessionDate}: {{status}}. Arrival time: {{arrival_time}}. Please review the app for details.`;
    }

    if (smsAudience === 'batch') {
      return `${recipientGreeting}, this is an update for batch ${batchLabel}. Please check the RMC app for the latest schedule, notes, and announcements.`;
    }

    if (smsAudience === 'all') {
      return `${recipientGreeting}, this is a general RMC announcement for all batches. Please check the app for the latest notices, materials, and updates.`;
    }

    return `${recipientGreeting}, this is an important RMC update. Please review the app for details and next steps.`;
  }, [attendanceSessionCacheRevision, smsAudience, smsBatch, smsBatchHistory, smsRecipientMode, smsStatuses, smsSessionId]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    const nextTemplate = buildSuggestedSmsTemplate();
    if (!smsMessage.trim() || smsMessage === smsTemplateRef.current) {
      setSmsMessage(nextTemplate);
    }
    smsTemplateRef.current = nextTemplate;
  }, [buildSuggestedSmsTemplate, session?.type, smsMessage]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    if (!attendanceBatch) {
      setBatchSummary(null);
      setBatchHistory([]);
      return;
    }
    loadBatchInsights(attendanceBatch).catch(() => null);
    }, [attendanceBatch, loadBatchInsights, session?.type]);

  const saveBaseUrl = useCallback(async () => {
    const normalized = normalizeBaseUrl(baseUrlDraft);
    if (!normalized) {
      Alert.alert('Server URL required', 'Enter the address of the RMC server.');
      return;
    }
    setBusyMessage('Checking server...');
    try {
      const response = await fetch(makeAbsoluteUrl(normalized, '/api/session'));
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      setBaseUrl(normalized);
      setBaseUrlDraft(normalized);
      await SecureStore.setItemAsync(STORAGE_BASE_URL, normalized);
      setBusyMessage('');
      setServerOverrideVisible(false);
      Alert.alert('Connected', 'Server URL saved.');
      await refreshAll(true);
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Connection failed', error instanceof Error ? error.message : 'Could not reach the server.');
    }
  }, [baseUrlDraft, refreshAll]);

  const openServerOverride = useCallback(() => {
    if (!isHost || session?.type !== 'staff') {
      Alert.alert('Restricted', 'Emergency server override is available only for host admin accounts.');
      return;
    }
    setBaseUrlDraft(baseUrl || LOCALHOST_SERVER_URL);
    setServerOverrideVisible(true);
  }, [baseUrl, isHost, session]);

  const pickMaterialFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false
    });
    if (result.canceled || !result.assets?.length) return;
    setMaterialUpload(result.assets[0]);
  }, []);

  const saveMaterial = useCallback(async () => {
    if (!materialTitle.trim()) {
      Alert.alert('Missing title', 'Please add a title for the material.');
      return;
    }
    if (!materialBatchId.trim()) {
      Alert.alert('Batch required', 'Please choose a batch before saving the material.');
      return;
    }
    if (!materialUpload && !materialLink.trim()) {
      Alert.alert('Missing source', 'Pick a file or enter a web link.');
      return;
    }

    setBusyMessage('Saving material...');
    try {
      let filePath = materialLink.trim();
      if (materialUpload) {
        const uploadForm = new FormData();
        uploadForm.append('file', {
          uri: materialUpload.uri,
          name: materialUpload.name || 'material-file',
          type: materialUpload.mimeType || 'application/octet-stream'
        } as never);
        const uploadPayload = await apiUpload<{ status: string; file: { url: string } }>('/api/materials/upload', uploadForm);
        filePath = uploadPayload.file.url;
      }

      await apiJson('/api/materials', {
        method: 'POST',
        body: JSON.stringify({
          title: materialTitle.trim(),
          batch_id: materialBatchId,
          description: materialDescription.trim(),
          file_path: filePath
        })
      });

      setMaterialTitle('');
      setMaterialDescription('');
      setMaterialBatchId('');
      setMaterialLink('');
      setMaterialUpload(null);
      await loadMaterials(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save material.');
    }
  }, [apiJson, apiUpload, loadMaterials, materialBatchId, materialDescription, materialLink, materialTitle, materialUpload]);

  const deleteMaterial = useCallback(async (materialId: number) => {
    setBusyMessage('Deleting material...');
    try {
      await apiJson(`/api/materials/${materialId}`, { method: 'DELETE' });
      await loadMaterials(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Delete failed', error instanceof Error ? error.message : 'Could not delete material.');
    }
  }, [apiJson, loadMaterials]);

  const handleMaterialOpen = useCallback(async (material: MaterialItem) => {
    const targetPath = material.download_path || material.file_path;
    if (!targetPath) {
      Alert.alert('Unavailable', 'No file or link is attached to this material.');
      return;
    }
    const targetName = getFileNameFromPath(targetPath);
    const shouldPreview = isPreviewableFileName(targetName);
    if (/^https?:\/\//i.test(targetPath) && !shouldPreview) {
      await Linking.openURL(targetPath);
      return;
    }
    const sourceUrl = /^https?:\/\//i.test(targetPath) ? targetPath : makeAbsoluteUrl(baseUrl, targetPath);
    try {
      setBusyMessage('Downloading material...');
      setBusyProgress(0);
      if (session && session.type === 'student') {
        const cached = await cacheMaterialForStudent(
          session.student.student_uid,
          material,
          sourceUrl,
          cookieRef.current,
          setBusyProgress
        );
        setOfflineMode(false);
        await openDownloadedUri(cached.local_uri, cached.file_name, material.title, cached.source_url || cached.file_name);
        return;
      }
      const cached = await cacheMaterialForStudent(
        `staff_${staffUsername || 'workspace'}`,
        material,
        sourceUrl,
        cookieRef.current,
        setBusyProgress
      );
      setOfflineMode(false);
      await openDownloadedUri(cached.local_uri, cached.file_name, material.title, cached.source_url || cached.file_name);
    } catch (error) {
      setOfflineMode(true);
      Alert.alert('Download failed', error instanceof Error ? error.message : 'Could not download this file right now.');
    } finally {
      setBusyProgress(null);
      setBusyMessage('');
    }
  }, [baseUrl, openDownloadedUri, session, staffUsername]);

  const openCachedMaterial = useCallback(async (item: CachedMaterial) => {
    try {
      await openDownloadedUri(item.local_uri, item.file_name, item.title, item.source_url || item.file_name);
    } catch {
      Alert.alert('Unavailable', 'Could not open the saved material on this device.');
    }
  }, [openDownloadedUri]);

  const chooseImageUri = useCallback(async (source: 'camera' | 'library') => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow photo access to continue.');
      return '';
    }

    const pickerResult = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true });

    if (pickerResult.canceled || !pickerResult.assets?.length) return '';
    return pickerResult.assets[0].uri;
  }, []);

  const submitLeadRequest = useCallback(async () => {
    if (!leadRequestName.trim() || !leadRequestPhone.trim()) {
      Alert.alert('Missing fields', 'Name and phone are required.');
      return;
    }
    setBusyMessage('Sending request...');
    try {
      await apiJson('/api/leads', {
        method: 'POST',
        body: JSON.stringify({
          name: leadRequestName.trim(),
          phone: leadRequestPhone.trim(),
          source: 'id_card_permission_request'
        })
      });
      setLeadRequestName('');
      setLeadRequestPhone('');
      setBusyMessage('');
      Alert.alert('Sent', 'Your request has been submitted.');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Request failed', error instanceof Error ? error.message : 'Could not submit the request.');
    }
  }, [apiJson, leadRequestName, leadRequestPhone]);

  const pickRegistrationPhoto = useCallback(async (source: 'camera' | 'library') => {
    const uri = await chooseImageUri(source);
    if (!uri) return;
    setRegistrationForm((prev) => ({ ...prev, photo: uri }));
  }, [chooseImageUri]);

  const toggleRegistrationBatch = useCallback((batchName: string) => {
    const normalized = batchName.trim();
    if (!normalized) return;
    setRegistrationForm((prev) => {
      const selected = new Set(prev.current_batches.map((batch) => batch.trim()).filter(Boolean));
      if (selected.has(normalized)) {
        selected.delete(normalized);
      } else {
        selected.add(normalized);
      }
      const orderedByCatalog = publicBatches
        .map((batch) => batch.name.trim())
        .filter((batch) => batch && selected.has(batch));
      const remainder = Array.from(selected).filter((batch) => !orderedByCatalog.includes(batch));
      return { ...prev, current_batches: [...orderedByCatalog, ...remainder] };
    });
  }, [publicBatches]);

  const submitRegistration = useCallback(async () => {
    const studentPhoneDigits = normalizePhoneDigits(registrationForm.phone);
    const parentPhoneDigits = normalizePhoneDigits(registrationForm.guardian_phone);
    if (!registrationForm.name.trim() || !registrationForm.phone.trim() || !registrationForm.guardian_phone.trim() || !registrationForm.father_name.trim() || !registrationForm.student_class.trim() || registrationForm.current_batches.length === 0 || !registrationForm.aspiration.trim()) {
      Alert.alert('Missing details', 'Please complete the student name, phone, parent phone, father name, class, batch, aspiration, and photo.');
      return;
    }
    if (!isTenDigitPhone(studentPhoneDigits)) {
      Alert.alert('Invalid student phone', 'Student phone must contain exactly 10 digits. Letters, spaces, and symbols are not allowed.');
      return;
    }
    if (!isTenDigitPhone(parentPhoneDigits)) {
      Alert.alert('Invalid parent phone', 'Parent phone must contain exactly 10 digits. Letters, spaces, and symbols are not allowed.');
      return;
    }
    if (!registrationForm.photo) {
      Alert.alert('Photo required', 'Please add a portrait photo before registering.');
      return;
    }

    setBusyMessage('Submitting registration...');
    try {
      const mimeType = inferFileExtension(registrationForm.photo).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      const base64Photo = await FileSystem.readAsStringAsync(registrationForm.photo, { encoding: 'base64' as any });
      const payload = {
        name: registrationForm.name.trim(),
        phone: studentPhoneDigits,
        father_name: registrationForm.father_name.trim(),
        guardian_phone: parentPhoneDigits,
        address: registrationForm.address.trim(),
        student_class: registrationForm.student_class.trim(),
        aspiration: registrationForm.aspiration.trim(),
        current_batches: registrationForm.current_batches,
        photo: `data:${mimeType};base64,${base64Photo}`
      };
      const response = await apiJson<any>('/api/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setRegistrationForm({
        name: '',
        phone: '',
        father_name: '',
        guardian_phone: '',
        address: '',
        student_class: '',
        current_batches: [],
        aspiration: '',
        photo: ''
      });
      setBusyMessage('');

      if (response?.mode === 'retrieval') {
        Alert.alert('Already registered', `This phone already has an ID card.\nUID: ${response.student_uid || response.uid || 'N/A'}`);
      } else {
        Alert.alert('Registration complete', `Student UID: ${response?.student_uid || response?.uid || 'N/A'}`);
      }
      return;
    } catch (error) {
      if (extractApiStatus(error) === 403) {
        try {
          await apiJson('/api/leads', {
            method: 'POST',
            body: JSON.stringify({
              name: registrationForm.name.trim(),
              phone: registrationForm.phone.trim(),
              father_name: registrationForm.father_name.trim(),
              guardian_phone: registrationForm.guardian_phone.trim() || registrationForm.phone.trim(),
              source: 'id_card_permission_request'
            })
          });
          Alert.alert('Approval pending', 'Registration needs teacher approval. We sent an ID approval request from the app.');
        } catch (leadError) {
          Alert.alert('Registration blocked', leadError instanceof Error ? leadError.message : 'Teacher approval is required before generating the ID card.');
        }
      } else {
        Alert.alert('Registration failed', error instanceof Error ? error.message : 'Could not register the student.');
      }
    } finally {
      setBusyMessage('');
    }
  }, [apiJson, registrationForm]);

  const handleStudentLogin = useCallback(async () => {
    const hasUid = studentUid.trim().length > 0;
    const hasTrioLock = studentName.trim().length > 0 || studentPhone.trim().length > 0 || studentFather.trim().length > 0;
    if (!hasUid && !hasTrioLock) {
      Alert.alert('Missing details', 'Enter a Student UID or the Trio-Lock details.');
      return;
    }
    setBusyMessage('Logging in...');
    try {
      await apiJson('/api/student/login', {
        method: 'POST',
        body: JSON.stringify({
          uid: studentUid.trim(),
          name: studentName.trim(),
          phone: studentPhone.trim(),
          father_name: studentFather.trim()
        })
      });
      const current = await syncSession();
      if (current?.type === 'student') {
        try {
          await Promise.all([
            loadStudentPortal(true),
            loadStudentTests(true),
            loadDoubts('student', current.student.student_uid, undefined, true)
          ]);
        } catch (workspaceError) {
          if (!isServerUnavailableError(workspaceError)) throw workspaceError;
          await Promise.all([
            loadStudentPortal(false),
            loadStudentTests(false),
            loadDoubts('student', current.student.student_uid, undefined, false)
          ].map((promise) => promise.catch(() => null)));
          setOfflineMode(true);
        }
        await persistAppCache({ workspaceRole: 'student' });
        setGuestTab('welcome');
        setStudentTab('overview');
        setStudentQrExpanded(false);
      }
      setBusyMessage('');
    } catch (error) {
      const cached = isServerUnavailableError(error)
        ? getCachedSessionForLogin('student', studentUid.trim(), {
          name: studentName.trim(),
          phone: studentPhone.trim(),
          father: studentFather.trim()
        })
        : null;
      if (cached && cached.type === 'student') {
        setSession(cached);
        setOfflineMode(true);
        await persistAppCache({ session: snapshotSession(cached), workspaceRole: 'student' });
        await persistTrustedSession(cached);
        await Promise.all([
          loadStudentPortal(false),
          loadStudentTests(false),
          loadDoubts('student', cached.student.student_uid, undefined, false)
        ].map((promise) => promise.catch(() => null)));
        setGuestTab('welcome');
        setStudentTab('overview');
        setBusyMessage('');
        return;
      }
      setBusyMessage('');
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Could not log in.');
    }
  }, [apiJson, getCachedSessionForLogin, isServerUnavailableError, loadDoubts, loadStudentPortal, loadStudentTests, persistAppCache, persistTrustedSession, studentFather, studentName, studentPhone, studentUid, syncSession]);

  const handleStaffLogin = useCallback(async () => {
    if (!staffUsername.trim() || !staffPassword.trim()) {
      Alert.alert('Missing details', 'Enter your staff username and password.');
      return;
    }
    setBusyMessage('Logging in...');
    try {
      const payload = await apiJson<{ status: string; user?: StaffUser; bootstrap?: StaffBootstrapPayload }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: staffUsername.trim(), password: staffPassword })
      });
      const nextSession = payload.user ? ({ type: 'staff' as const, user: payload.user }) : await syncSession();
      if (nextSession?.type === 'staff') {
        setSession(nextSession);
        await persistAppCache({ session: snapshotSession(nextSession), workspaceRole: 'staff' });
        await persistTrustedSession(nextSession);
        const deviceId = deviceIdRef.current || await getOrCreateDeviceId();
        deviceIdRef.current = deviceId;
        await persistStaffLoginSecret(deviceId, staffUsername.trim(), staffPassword).catch((secretError) => {
          console.warn('[AUTH] Could not persist offline staff secret:', secretError);
        });
        try {
          setBusyMessage('Downloading core staff data...');
          setBusyProgress(0);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (payload.bootstrap) {
            await applyStaffBootstrap(payload.bootstrap);
            setOfflineMode(false);
          } else {
            await hydrateStaffWorkspace(true);
          }
        } catch (workspaceError) {
          console.warn('[AUTH] Staff workspace sync failed after login, keeping session active:', workspaceError);
          if (isServerUnavailableError(workspaceError)) {
            await hydrateStaffWorkspace(false).catch(() => null);
            setOfflineMode(true);
          }
        }
        setGuestTab('welcome');
        setStaffTab('home', { resetReason: 'login' });
      }
      setBusyMessage('');
      setBusyProgress(null);
    } catch (error) {
      const secretMatches = isServerUnavailableError(error)
        ? await readStaffLoginSecret(deviceIdRef.current || await getOrCreateDeviceId(), staffUsername.trim()).then((secret) => secret === staffPassword).catch(() => false)
        : false;
      const cached = secretMatches ? getCachedSessionForLogin('staff', staffUsername.trim()) : null;
      if (cached && cached.type === 'staff') {
        setSession(cached);
        setOfflineMode(true);
        await persistAppCache({ session: snapshotSession(cached), workspaceRole: 'staff' });
        await persistTrustedSession(cached);
        await hydrateStaffWorkspace(false).catch(() => null);
        setGuestTab('welcome');
        setStaffTab('home', { resetReason: 'login' });
        setBusyMessage('');
        setBusyProgress(null);
        return;
      }
      setBusyMessage('');
      setBusyProgress(null);
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Could not log in.');
    }
  }, [apiJson, applyStaffBootstrap, getCachedSessionForLogin, isServerUnavailableError, persistAppCache, persistStaffLoginSecret, persistTrustedSession, hydrateStaffWorkspace, staffPassword, staffUsername, syncSession]);

  const handleStaffQrLogin = useCallback(async (token: string) => {
    if (!token.trim()) return;
    setBusyMessage('Scanning staff QR...');
    try {
      const payload = await apiJson<{ status: string; user?: StaffUser; bootstrap?: StaffBootstrapPayload }>('/api/login/qr', {
        method: 'POST',
        body: JSON.stringify({ token })
      });
      const nextSession = payload.user ? ({ type: 'staff' as const, user: payload.user }) : await syncSession();
      if (nextSession?.type === 'staff') {
        setSession(nextSession);
        await persistAppCache({ session: snapshotSession(nextSession), workspaceRole: 'staff' });
        await persistTrustedSession(nextSession);
        try {
          setBusyMessage('Downloading server data...');
          setBusyProgress(0);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (payload.bootstrap) {
            await applyStaffBootstrap(payload.bootstrap);
            setOfflineMode(false);
          } else {
            await hydrateStaffWorkspace(true);
          }
        } catch (workspaceError) {
          console.warn('[AUTH] Staff QR workspace sync failed after login, keeping session active:', workspaceError);
          if (isServerUnavailableError(workspaceError)) {
            await hydrateStaffWorkspace(false).catch(() => null);
            setOfflineMode(true);
          }
        }
        setGuestTab('welcome');
        setStaffTab('home', { resetReason: 'login' });
      }
      setBusyMessage('');
      setBusyProgress(null);
      setStaffScannerVisible(false);
    } catch (error) {
      const cached = isServerUnavailableError(error)
        ? (appCacheRef.current.session ? restoreSession(appCacheRef.current.session) : sessionRef.current)
        : null;
      if (cached && cached.type === 'staff') {
        setSession(cached);
        setOfflineMode(true);
        await persistAppCache({ session: snapshotSession(cached), workspaceRole: 'staff' });
        await persistTrustedSession(cached);
        await hydrateStaffWorkspace(false).catch(() => null);
        setGuestTab('welcome');
        setStaffTab('home', { resetReason: 'login' });
        setBusyMessage('');
        setBusyProgress(null);
        setStaffScannerVisible(false);
        return;
      }
      setBusyMessage('');
      setBusyProgress(null);
      Alert.alert('Scan failed', error instanceof Error ? error.message : 'Could not verify the staff QR.');
    }
  }, [apiJson, applyStaffBootstrap, hydrateStaffWorkspace, isServerUnavailableError, persistAppCache, persistTrustedSession, syncSession]);

  const handleStudentQrLogin = useCallback(async (token: string) => {
    if (!token.trim()) return;
    setBusyMessage('Scanning student QR...');
    try {
      await apiJson('/api/student/login/qr', {
        method: 'POST',
        body: JSON.stringify({ token })
      });
      const current = await syncSession();
      if (current?.type === 'student') {
        await Promise.all([
          loadStudentPortal(true),
          loadStudentTests(true),
          loadDoubts('student', current.student.student_uid, undefined, true)
        ]);
        setGuestTab('welcome');
        setStudentTab('overview');
      }
      setBusyMessage('');
      setStudentScannerVisible(false);
    } catch (error) {
      const cached = isServerUnavailableError(error)
        ? (appCacheRef.current.session ? restoreSession(appCacheRef.current.session) : sessionRef.current)
        : null;
      if (cached && cached.type === 'student') {
        setSession(cached);
        setOfflineMode(true);
        await persistAppCache({ session: snapshotSession(cached), workspaceRole: 'student' });
        await persistTrustedSession(cached);
        await Promise.all([
          loadStudentPortal(false),
          loadStudentTests(false),
          loadDoubts('student', cached.student.student_uid, undefined, false)
        ].map((promise) => promise.catch(() => null)));
        setGuestTab('welcome');
        setStudentTab('overview');
        setBusyMessage('');
        setStudentScannerVisible(false);
        return;
      }
      setBusyMessage('');
      Alert.alert('Scan failed', error instanceof Error ? error.message : 'Could not verify the student QR.');
    }
  }, [apiJson, isServerUnavailableError, loadDoubts, loadStudentPortal, loadStudentTests, persistAppCache, persistTrustedSession, syncSession]);

    const showAttendanceToast = useCallback((student: StudentRow, result: { alreadyMarked: boolean; statusLabel: string; detail: string }) => {
      setLastScannedStudent(student);
      setAttendanceScanResult(result);
    }, []);

  const handleLogout = useCallback(async () => {
    try {
      if (session?.type === 'student') {
        await apiJson('/api/student/logout', { method: 'POST' });
      } else if (session?.type === 'staff') {
        await apiJson('/api/logout', { method: 'POST' });
      }
    } finally {
      cookieRef.current = '';
      setCookieHeader('');
      await SecureStore.setItemAsync(STORAGE_COOKIE, '');
      setSession(null);
      setCurrentSession(null);
      attendanceSessionPendingRef.current = null;
        lastKnownAttendanceBatchRef.current = '';
        offlineAttendanceSessionKeyRef.current = '';
        setLastScannedStudent(null);
      setAttendancePreviewStudent(null);
      setAttendanceScanResult(null);
      studentDirectorySnapshotRef.current = [];
      rosterSnapshotRef.current = [];
      setStudentDirectoryCount(0);
      setStudents([]);
      setRoster([]);
      setAttendanceDisplayRows([]);
      await persistAppCache({
        session: null,
        currentSession: null,
        attendanceQueue: [],
        studentsByUid: {},
        rosterByBatch: {},
        sessionsByKey: {},
        attendanceMarksBySession: {},
        syncQueue: [],
        sessionAliasMap: {},
        workspaceRole: null
      });
      setGuestTab('welcome');
      setStudentTab('overview');
      setStaffTab('home', { resetReason: 'logout' });
      setStudentQrExpanded(false);
      setStudentDoubts([]);
      setStaffDoubts([]);
    }
  }, [apiJson, session]);

  const pickDoubtPhoto = useCallback(async (source: 'camera' | 'library') => {
    const uri = await chooseImageUri(source);
    if (!uri) return;
    setNewDoubtPhoto(uri);
  }, [chooseImageUri]);

  const pickReplyPhoto = useCallback(async (source: 'camera' | 'library') => {
    const uri = await chooseImageUri(source);
    if (!uri) return;
    setDoubtReplyPhoto(uri);
  }, [chooseImageUri]);

  const updateDoubtStatus = useCallback(async (doubtId: number, status: 'solved' | 'flagged') => {
    setBusyMessage('Updating doubt...');
    try {
      if (status === 'solved' && doubtReplyPhoto) {
        const formData = new FormData();
        formData.append('reply_image', { uri: doubtReplyPhoto, name: 'reply.jpg', type: 'image/jpeg' } as never);
        await apiUpload(`/api/doubts/reply/${doubtId}`, formData);
        setDoubtReplyPhoto('');
      } else {
        await apiJson(`/api/doubts/status/${doubtId}`, {
          method: 'POST',
          body: JSON.stringify({ status })
        });
      }
      await loadDoubts('staff', undefined, undefined, true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Could not update the doubt.');
    }
  }, [apiJson, apiUpload, doubtReplyPhoto, loadDoubts]);

  const verifyAttendanceQr = useCallback(async (token: string) => {
    if (!currentSession?.session_id || !attendanceBatch || currentSession.status === 'closed') {
      Alert.alert('Session closed', 'Session closed');
      return;
    }

    let resolvedStudent = resolveStudentFromAttendanceToken(token);
    let resolvedViaServer = false;
    if (!resolvedStudent || !isAttendanceStudentValidForBatch(resolvedStudent, attendanceBatch)) {
      const currentServerSessionId = Number(currentSession.serverSessionId || currentSession.session_id || 0);
      if (!currentServerSessionId || String(currentSession.sessionKey || '').startsWith('local:')) {
        Alert.alert('Student not found', 'Student not found');
        return;
      }
      try {
        const payload = await apiJson<{ status: string; data: StudentRow; session_id: number; attendance_status: number; already_marked?: boolean }>(
          '/api/verify_qr',
          {
            method: 'POST',
            body: JSON.stringify({
              token,
              session_id: currentServerSessionId,
              batch_id: attendanceBatch
            })
          }
        );
        if (!payload?.data) {
          Alert.alert('Student not found', 'Student not found');
          return;
        }
        resolvedStudent = {
          ...payload.data,
          attendance_status: Number(payload.attendance_status || 0) || Number(payload.data.attendance_status || 0) || (currentSessionRef.current?.is_late === 1 ? 2 : 1)
        } as StudentRow;
        resolvedViaServer = true;
      } catch (error) {
        const status = extractApiStatus(error);
        if (status === 403) {
          Alert.alert('Wrong batch', 'This student is not in the selected batch.');
        } else {
          Alert.alert('Student not found', error instanceof Error ? error.message : 'Student not found');
        }
        return;
      }
    }
    if (!resolvedStudent) {
      Alert.alert('Student not found', 'Student not found');
      return;
    }

    const attendanceStatus = currentSessionRef.current?.is_late === 1 ? 2 : 1;
    const localMark = await upsertLocalAttendanceMark({
      student: resolvedStudent,
      sessionId: currentSession.session_id,
      batchName: attendanceBatch,
      status: attendanceStatus === 2 ? 'late' : 'present'
    });

    const previewProfile = studentRowToProfile({
      ...resolvedStudent,
      attendance_status: attendanceStatus
    } as StudentRow);
    const cachedPhoto = await cacheStudentPhoto(
      previewProfile.student_uid,
      /^file:\/\//i.test(previewProfile.photo_path || previewProfile.photo || '')
        ? String(previewProfile.photo_path || previewProfile.photo || '')
        : makeAbsoluteUrl(baseUrl, previewProfile.photo_path || previewProfile.photo || ''),
      cookieRef.current
    ).catch(() => null);
    if (cachedPhoto?.local_uri) {
      previewProfile.photo = cachedPhoto.local_uri;
      previewProfile.photo_path = cachedPhoto.local_uri;
    }

    setBusyMessage('Marking attendance...');
    setAttendancePreviewStudent(previewProfile);
    setStudentModalVisible(false);

    const isDuplicate = !localMark.didInsert;
    const localStatusLabel = isDuplicate
      ? 'Already marked'
      : attendanceStatus === 2
        ? 'Late'
        : 'Present';
    const localDetail = isDuplicate ? 'Already marked' : 'Attendance marked';
    showAttendanceToast({
      ...previewProfile,
      attendance_status: attendanceStatus
    } as StudentRow, {
      alreadyMarked: isDuplicate,
      statusLabel: localStatusLabel,
      detail: localDetail
    });
    void patchRosterAttendanceRow(localMark.mark?.studentUid || resolvedStudent.student_uid, localMark.sessionKey || currentSession.sessionKey);

    const currentServerSessionId = Number(currentSession.serverSessionId || currentSession.session_id || 0);
    if (resolvedViaServer) {
      await patchLocalAttendanceMark(localMark.sessionKey, localMark.mark?.studentUid || resolvedStudent.student_uid, {
        status: normalizeAttendanceStatusLabel(attendanceStatus === 2 ? 'late' : 'present'),
        syncStatus: 'synced',
        lastError: null
      }).catch(() => null);
      await loadStudentDirectory(true, true).catch(() => null);
      void loadRoster(currentSession.session_id, attendanceBatch, true, true).catch(() => null);
      setBusyMessage('');
      return;
    }

    if (isDuplicate) {
      setBusyMessage('');
      return;
    }

    if (!currentServerSessionId || String(currentSession.sessionKey || '').startsWith('local:')) {
      setBusyMessage('');
      void scheduleLocalAttendanceReplay('attendance-mark-local', { immediate: true });
      return;
    }

    try {
      const payload = await apiJson<{ status: string; data: StudentRow; session_id: number; attendance_status: number; already_marked?: boolean }>(
        '/api/verify_qr',
        {
          method: 'POST',
          body: JSON.stringify({
            token,
            session_id: currentServerSessionId,
            batch_id: attendanceBatch
          })
        }
      );

      const verifiedStudent = payload.data ? {
        ...payload.data,
        attendance_status: Number(payload.attendance_status || 0) || Number(payload.data.attendance_status || 0) || attendanceStatus
      } as StudentRow : null;
      const alreadyMarked = Boolean(payload.already_marked);
      if (verifiedStudent) {
        await patchLocalAttendanceMark(localMark.sessionKey, localMark.mark?.studentUid || resolvedStudent.student_uid, {
          status: normalizeAttendanceStatusLabel(attendanceStatus === 2 ? 'late' : 'present'),
          syncStatus: 'synced',
          lastError: null
        });
        const syncedPreview = studentRowToProfile(verifiedStudent);
        const syncedPhoto = await cacheStudentPhoto(
          syncedPreview.student_uid,
          /^file:\/\//i.test(syncedPreview.photo_path || syncedPreview.photo || '')
            ? String(syncedPreview.photo_path || syncedPreview.photo || '')
            : makeAbsoluteUrl(baseUrl, syncedPreview.photo_path || syncedPreview.photo || ''),
          cookieRef.current
        ).catch(() => null);
        if (syncedPhoto?.local_uri) {
          syncedPreview.photo = syncedPhoto.local_uri;
          syncedPreview.photo_path = syncedPhoto.local_uri;
        }
        setAttendancePreviewStudent(syncedPreview);
        showAttendanceToast(syncedPreview, {
          alreadyMarked,
          statusLabel: alreadyMarked ? 'Already marked' : attendanceStatus === 2 ? 'Late' : 'Present',
          detail: alreadyMarked ? 'Already marked' : 'Attendance marked'
        });
        void patchRosterAttendanceRow(localMark.mark?.studentUid || resolvedStudent.student_uid, localMark.sessionKey || currentSession.sessionKey);
        void scheduleLocalAttendanceReplay('attendance-mark-online', { immediate: true });
        setBusyMessage('');
        return;
      }
      throw new Error('Attendance marked');
    } catch (error) {
      await patchLocalAttendanceMark(localMark.sessionKey, localMark.mark?.studentUid || resolvedStudent.student_uid, {
        status: normalizeAttendanceStatusLabel(attendanceStatus === 2 ? 'late' : 'present'),
        syncStatus: 'pending_sync',
        lastError: null
      }).catch(() => null);
      setBusyMessage('');
      setAttendancePreviewStudent(previewProfile);
      setStudentModalVisible(false);
      showAttendanceToast(previewProfile as StudentRow, {
        alreadyMarked: false,
        statusLabel: attendanceStatus === 2 ? 'Late' : 'Present',
        detail: 'Attendance marked'
      });
      void patchRosterAttendanceRow(localMark.mark?.studentUid || resolvedStudent.student_uid, localMark.sessionKey || currentSession.sessionKey);
      void scheduleLocalAttendanceReplay('attendance-mark-retry', { immediate: true });
    }
  }, [apiJson, attendanceBatch, baseUrl, cookieRef, currentSession?.serverSessionId, currentSession?.sessionKey, currentSession?.status, patchLocalAttendanceMark, patchRosterAttendanceRow, scheduleLocalAttendanceReplay, showAttendanceToast, upsertLocalAttendanceMark]);

  const startAttendanceSession = useCallback(async () => {
    if (!attendanceBatch) {
      Alert.alert('Batch required', 'Choose a batch before starting attendance.');
      return;
    }
    const sessionName = attendanceSessionName.trim();
    if (!sessionName) {
      Alert.alert('Session name required', 'Enter a session name before starting attendance.');
      return;
    }
    const resolvedActiveSession = resolveActiveAttendanceSessionFromLedger({
      cache: appCacheRef.current,
      preferredSession: currentSessionRef.current,
      serverSession: currentSessionRef.current,
      attendanceBatch,
      attendanceSessionName,
      offlineAttendanceSessionKey: offlineAttendanceSessionKeyRef.current
    });
    if (resolvedActiveSession.currentSession && resolvedActiveSession.currentSession.status === 'open') {
      setCurrentSession(resolvedActiveSession.currentSession);
      if (resolvedActiveSession.attendanceBatch) {
        setAttendanceBatch(resolvedActiveSession.attendanceBatch);
      }
      if (resolvedActiveSession.attendanceSessionName !== attendanceSessionName) {
        setAttendanceSessionName(resolvedActiveSession.attendanceSessionName);
      }
      if (resolvedActiveSession.offlineAttendanceSessionKey) {
        offlineAttendanceSessionKeyRef.current = resolvedActiveSession.offlineAttendanceSessionKey;
      }
      return;
    }
    const preflightRunningSession = await fetchRunningAttendanceSessionOnce().catch(() => null);
    if (preflightRunningSession?.session_id && preflightRunningSession.status !== 'closed') {
      const adoptedSession = await applyStartedAttendanceSession(preflightRunningSession, attendanceBatch, sessionName);
      if (adoptedSession?.session_id) {
        setAttendanceSessionName('');
        setBusyMessage('');
        return;
      }
    }
    if (attendanceSessionActionInFlight) {
      return;
    }
    setAttendanceSessionActionInFlight(true);
    setBusyMessage('Starting session...');
    try {
      const startResponse = await apiJson<{
        status: string;
        session_id?: number;
        session_name?: string;
        batch_id?: string;
        column_name?: string;
        redirect?: string;
      }>('/api/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          batch_id: attendanceBatch,
          session_name: sessionName
        })
      });
      const startedSession = normalizeAttendanceWorkspaceSession({
        session_id: startResponse.session_id ?? 0,
        session_name: startResponse.session_name || sessionName,
        batch_id: startResponse.batch_id || attendanceBatch,
        column_name: startResponse.column_name || sessionName,
        status: 'open',
        is_late: 0,
        syncStatus: 'synced',
        created_at: new Date().toISOString(),
        closed_at: null
      });
      attendanceSessionPendingRef.current = startedSession;
      const adoptedSession = await applyStartedAttendanceSession(startedSession, attendanceBatch, sessionName);
      if (!adoptedSession?.session_id) {
        const nextSession = await waitForRunningAttendanceSession();
        if (nextSession?.session_id) {
          await applyStartedAttendanceSession(nextSession, attendanceBatch, sessionName);
        }
      }
      setAttendanceSessionName('');
      setBusyMessage('');
    } catch (error) {
      if (isSessionAlreadyRunningError(error)) {
        const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
        const activeServerSessionId = extractActiveServerSessionIdFromConflict(error);
        const closedSessionForServer = activeServerSessionId
          ? findClosedLocalSessionForServerSessionId(activeServerSessionId, currentCache, offlineAttendanceSessionKeyRef.current)
          : null;
        if (activeServerSessionId && closedSessionForServer) {
          const closedSessionKey = String(closedSessionForServer.sessionKey || '').trim();
          try {
            await apiJson('/api/sessions/close', {
              method: 'POST',
              body: JSON.stringify({ session_id: activeServerSessionId })
            });
            await patchLocalSessionRecord(closedSessionKey, {
              closeSyncStatus: 'synced',
              closeLastError: null,
              closeAttemptCount: 0,
              closeNextAttemptAt: null,
              closeLastAttemptAt: new Date().toISOString()
            }).catch(() => null);
            await loadStaffCore(true).catch(() => null);
            await apiJson('/api/sessions/start', {
              method: 'POST',
              body: JSON.stringify({
                batch_id: attendanceBatch,
                session_name: sessionName
              })
            });
            const retryStartedSession = normalizeAttendanceWorkspaceSession({
              session_id: activeServerSessionId,
              session_name: sessionName,
              batch_id: attendanceBatch,
              column_name: sessionName,
              status: 'open',
              is_late: 0,
              syncStatus: 'synced',
              created_at: new Date().toISOString(),
              closed_at: null
            });
            await applyStartedAttendanceSession(retryStartedSession, attendanceBatch, sessionName);
            const nextSession = await waitForRunningAttendanceSession();
            if (nextSession?.session_id) {
              await applyStartedAttendanceSession(nextSession, attendanceBatch, sessionName);
            }
            setAttendanceSessionName('');
            setBusyMessage('');
            return;
          } catch (retryError) {
            if (!isServerUnavailableError(retryError)) {
              setBusyMessage('');
              Alert.alert('Start failed', retryError instanceof Error ? retryError.message : 'Could not start the session.');
              return;
            }
          }
        }
        const adoptedSession = await adoptRunningAttendanceSession().catch(() => null);
        if (adoptedSession?.session_id && adoptedSession.status !== 'closed') {
          setBusyMessage('');
          return;
        }
        void processLocalAttendanceReplayQueue('start-session-conflict').catch(() => null);
        setBusyMessage('');
        Alert.alert('Start failed', error instanceof Error ? error.message : 'Could not start the session.');
        return;
      }
      if (isServerUnavailableError(error)) {
        const localSession = await createLocalAttendanceSession(attendanceBatch, sessionName).catch(() => null);
        if (localSession) {
          void loadRoster(localSession.session_id, attendanceBatch, true).catch(() => null);
          void scheduleLocalAttendanceReplay('session-start-local', { immediate: true });
          setAttendanceSessionName('');
          setBusyMessage('');
          return;
        }
        setBusyMessage('');
        Alert.alert('Start failed', 'Could not start the session.');
        return;
      }
      setBusyMessage('');
      Alert.alert('Start failed', error instanceof Error ? error.message : 'Could not start the session.');
    } finally {
      setAttendanceSessionActionInFlight(false);
    }
  }, [adoptRunningAttendanceSession, apiJson, attendanceBatch, attendanceSessionActionInFlight, attendanceSessionName, createLocalAttendanceSession, currentSession?.session_id, isServerUnavailableError, isSessionAlreadyRunningError, loadRoster, loadStaffCore, patchLocalSessionRecord, processLocalAttendanceReplayQueue, scheduleLocalAttendanceReplay]);

  const setLateMode = useCallback(async () => {
    if (!currentSession?.session_id) {
      Alert.alert('Session required', 'Start an attendance session first.');
      return;
    }
    if (attendanceSessionActionInFlight) {
      return;
    }
    setAttendanceSessionActionInFlight(true);
    if (!currentSession.serverSessionId || String(currentSession.sessionKey || '').startsWith('local:')) {
      try {
        await updateCurrentAttendanceSession({
          is_late: 1,
          syncStatus: 'pending_sync'
        }).catch(() => null);
        setBusyMessage('');
        void scheduleLocalAttendanceReplay('late-mode-local', { immediate: true });
        return;
      } finally {
        setAttendanceSessionActionInFlight(false);
      }
    }
    setBusyMessage('Enabling late mode...');
    try {
      await apiJson(`/api/sessions/${currentSession.serverSessionId || currentSession.session_id}/late`, { method: 'POST' });
      await loadStaffCore(true);
      void scheduleLocalAttendanceReplay('late-mode-online', { immediate: true });
      setBusyMessage('');
    } catch (error) {
      if (isServerUnavailableError(error)) {
        await updateCurrentAttendanceSession({
          is_late: 1,
          syncStatus: 'pending_sync'
        }).catch(() => null);
        setBusyMessage('');
        void scheduleLocalAttendanceReplay('late-mode-retry', { immediate: true });
        return;
      }
      setBusyMessage('');
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Could not enable late mode.');
    } finally {
      setAttendanceSessionActionInFlight(false);
    }
  }, [apiJson, attendanceSessionActionInFlight, currentSession, isServerUnavailableError, loadStaffCore, scheduleLocalAttendanceReplay, updateCurrentAttendanceSession]);

  const closeAttendanceSession = useCallback(async () => {
    if (!currentSession?.session_id) {
      Alert.alert('Session required', 'No active attendance session to close.');
      return;
    }
    if (attendanceSessionActionInFlight) {
      return;
    }
    setAttendanceSessionActionInFlight(true);
    if (!currentSession.serverSessionId || String(currentSession.sessionKey || '').startsWith('local:')) {
      try {
        await updateCurrentAttendanceSession({
          status: 'closed',
          closed_at: new Date().toISOString(),
          syncStatus: 'pending_sync'
        }).catch(() => null);
        refreshAttendanceDisplayRows('roster', '', attendanceBatch, roster);
        setCurrentSession(null);
        setAttendanceSessionName('');
        setLastScannedStudent(null);
        setAttendancePreviewStudent(null);
        setAttendanceScanResult(null);
        attendanceSessionPendingRef.current = null;
        setBusyMessage('');
        void scheduleLocalAttendanceReplay('close-session-local', { immediate: true });
        return;
      } finally {
        setAttendanceSessionActionInFlight(false);
      }
    }
    setBusyMessage('Closing session...');
    try {
      await apiJson('/api/sessions/close', {
        method: 'POST',
        body: JSON.stringify({ session_id: currentSession.serverSessionId || currentSession.session_id })
      });
      await patchLocalSessionRecord(getSessionKeyForIdentity(currentSession), {
        status: 'closed',
        closed_at: new Date().toISOString(),
        syncStatus: 'synced',
        closeSyncStatus: 'synced',
        closeAttemptCount: 0,
        closeNextAttemptAt: null,
        closeLastAttemptAt: new Date().toISOString(),
        closeLastError: null,
        lastError: null,
        attemptCount: 0,
        nextAttemptAt: null,
        lastAttemptAt: new Date().toISOString()
      }).catch(() => null);
      refreshAttendanceDisplayRows('roster', '', attendanceBatch, roster);
      setCurrentSession(null);
      setAttendanceSessionName('');
      setLastScannedStudent(null);
      setAttendancePreviewStudent(null);
      setAttendanceScanResult(null);
      attendanceSessionPendingRef.current = null;
      await loadStaffCore(true);
      await refreshLiveSessionStateRef.current(true, attendanceBatch).catch(() => null);
      void scheduleLocalAttendanceReplay('close-session-online', { immediate: true });
      setBusyMessage('');
    } catch (error) {
      if (isServerUnavailableError(error)) {
        await updateCurrentAttendanceSession({
          status: 'closed',
          closed_at: new Date().toISOString(),
          syncStatus: 'pending_sync'
        }).catch(() => null);
        refreshAttendanceDisplayRows('roster', '', attendanceBatch, roster);
        setCurrentSession(null);
        setAttendanceSessionName('');
        setLastScannedStudent(null);
        setAttendancePreviewStudent(null);
        setAttendanceScanResult(null);
        attendanceSessionPendingRef.current = null;
        setBusyMessage('');
        void scheduleLocalAttendanceReplay('close-session-retry', { immediate: true });
        return;
      }
      setBusyMessage('');
      Alert.alert('Close failed', error instanceof Error ? error.message : 'Could not close the session.');
    } finally {
      setAttendanceSessionActionInFlight(false);
    }
  }, [apiJson, attendanceSessionActionInFlight, currentSession, isServerUnavailableError, loadStaffCore, scheduleLocalAttendanceReplay, updateCurrentAttendanceSession]);

  const openStudentDetail = useCallback(async (student: StudentRow) => {
    setStudentModalVisible(false);
    const cachedDetail = await readStudentDetailCache(student.student_uid).catch(() => null);
    if (cachedDetail) {
      const cachedPhoto = await cacheStudentPhoto(
        cachedDetail.student_uid,
        /^file:\/\//i.test(cachedDetail.photo_path || cachedDetail.photo || '')
          ? String(cachedDetail.photo_path || cachedDetail.photo || '')
          : makeAbsoluteUrl(baseUrl, cachedDetail.photo_path || cachedDetail.photo || ''),
        cookieRef.current
      ).catch(() => null);
      const hydratedCachedDetail = cachedPhoto?.local_uri
        ? { ...cachedDetail, photo: cachedPhoto.local_uri, photo_path: cachedPhoto.local_uri }
        : cachedDetail;
      setSelectedStudent(hydratedCachedDetail);
      setSelectedStudentBatches(getStudentBatchList(hydratedCachedDetail));
      setStudentModalVisible(true);
    } else {
      setBusyMessage(`Loading ${student.name || 'student'} details...`);
    }
    try {
      const payload = await apiJson<{ status?: string; data: StudentProfile }>(`/api/student_details/${encodeURIComponent(student.student_uid)}`);
      const detail = payload?.data;
      if (!detail) {
        throw new Error('Student details were not returned.');
      }
      const cachedPhoto = await cacheStudentPhoto(
        detail.student_uid,
        /^file:\/\//i.test(detail.photo_path || detail.photo || '')
          ? String(detail.photo_path || detail.photo || '')
          : makeAbsoluteUrl(baseUrl, detail.photo_path || detail.photo || ''),
        cookieRef.current
      ).catch(() => null);
      const hydratedDetail = cachedPhoto?.local_uri
        ? { ...detail, photo: cachedPhoto.local_uri, photo_path: cachedPhoto.local_uri }
        : detail;
      setSelectedStudent(hydratedDetail);
      setSelectedStudentBatches(getStudentBatchList(hydratedDetail));
      setStudentModalVisible(true);
      await writeStudentDetailCache(hydratedDetail);
    } catch (error) {
      const cachedRow = studentDirectorySnapshotRef.current.find((row) => row.student_uid === student.student_uid) || rosterSnapshotRef.current.find((row) => row.student_uid === student.student_uid) || student;
      const cachedProfile = studentRowToProfile(cachedRow);
      const cachedPhoto = await cacheStudentPhoto(
        cachedProfile.student_uid,
        /^file:\/\//i.test(cachedProfile.photo_path || cachedProfile.photo || '')
          ? String(cachedProfile.photo_path || cachedProfile.photo || '')
          : makeAbsoluteUrl(baseUrl, cachedProfile.photo_path || cachedProfile.photo || ''),
        cookieRef.current
      ).catch(() => null);
      const hydratedProfile = cachedPhoto?.local_uri
        ? { ...cachedProfile, photo: cachedPhoto.local_uri, photo_path: cachedPhoto.local_uri }
        : cachedProfile;
      setSelectedStudent(hydratedProfile);
      setSelectedStudentBatches(getStudentBatchList(hydratedProfile));
      setStudentModalVisible(true);
      if (!cachedDetail && !isServerUnavailableError(error)) {
        Alert.alert('Load failed', error instanceof Error ? error.message : 'Could not load student details.');
      }
    } finally {
      setBusyMessage('');
    }
  }, [apiJson, baseUrl, isServerUnavailableError]);

  const openStudentEditPage = useCallback(async () => {
    if (!selectedStudent) {
      Alert.alert('Student required', 'Choose a student first.');
      return;
    }
    if (session?.type !== 'staff') {
      Alert.alert('Restricted', 'Student edits are available to staff accounts only.');
      return;
    }

    setBusyMessage(`Opening edit page for ${selectedStudent.name || 'student'}...`);
    try {
      const payload = await apiJson<{ status?: string; update_url?: string }>('/api/students/update-session', {
        method: 'POST',
        body: JSON.stringify({ student_uid: selectedStudent.student_uid })
      });
      const updateUrl = payload?.update_url;
      if (!updateUrl) {
        throw new Error('Edit session was not returned.');
      }
      await Linking.openURL(makeAbsoluteUrl(baseUrl, updateUrl));
    } catch (error) {
      Alert.alert('Edit failed', error instanceof Error ? error.message : 'Could not open the edit page.');
    } finally {
      setBusyMessage('');
    }
  }, [apiJson, baseUrl, selectedStudent, session?.type]);

  const syncBatchSelectionAfterMutation = useCallback((previousName: string, nextName: string | null) => {
    const nextValue = nextName || '';
    const ui = uiSnapshotRef.current;
    if (ui.attendanceBatch === previousName) {
      setAttendanceBatch(nextValue);
      lastKnownAttendanceBatchRef.current = nextValue;
    }
    if (ui.studentBatchFilter === previousName) setStudentBatchFilter(nextValue);
    if (ui.reportBatch === previousName) setReportBatch(nextValue || 'ALL');
    if (ui.doubtBatchFilter === previousName) setDoubtBatchFilter(nextValue);
    if (ui.testBatch === previousName) setTestBatch(nextValue);
    if (ui.smsBatch === previousName) {
      setSmsBatch(nextValue);
      if (!nextValue) {
        setSmsSessionId('');
        setSmsBatchHistory([]);
      }
    }
  }, []);

  const createBatch = useCallback(async () => {
    if (!newBatchName.trim()) {
      Alert.alert('Missing name', 'Enter a batch name.');
      return;
    }
    setBusyMessage('Creating batch...');
    try {
      await apiJson('/api/batches', {
        method: 'POST',
        body: JSON.stringify({ name: newBatchName.trim(), description: newBatchDescription.trim() })
      });
      setNewBatchName('');
      setNewBatchDescription('');
      await loadStaffCore(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Create failed', error instanceof Error ? error.message : 'Could not create the batch.');
    }
  }, [apiJson, loadStaffCore, newBatchDescription, newBatchName]);

  const saveBatchEdit = useCallback(async () => {
    if (!editingBatchId || !editingBatchName.trim()) {
      Alert.alert('Missing details', 'Choose a batch and enter a new name.');
      return;
    }
    const originalName = batches.find((batch) => batch.id === editingBatchId)?.name || '';
    const nextName = editingBatchName.trim();
    setBusyMessage('Saving batch...');
    try {
      await apiJson(`/api/batches/${editingBatchId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: nextName,
          description: editingBatchDescription.trim()
        })
      });
      setEditingBatchId(null);
      setEditingBatchName('');
      setEditingBatchDescription('');
      if (originalName) {
        syncBatchSelectionAfterMutation(originalName, nextName);
      }
      await loadStaffCore(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save the batch.');
    }
  }, [apiJson, batches, editingBatchDescription, editingBatchId, editingBatchName, loadStaffCore, syncBatchSelectionAfterMutation]);

  const deleteBatch = useCallback(async (batch: Batch) => {
    setBusyMessage('Deleting batch...');
    try {
      await apiJson(`/api/batches/${batch.id}`, { method: 'DELETE' });
      syncBatchSelectionAfterMutation(batch.name, null);
      await loadStaffCore(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Delete failed', error instanceof Error ? error.message : 'Could not delete the batch.');
    }
  }, [apiJson, loadStaffCore, syncBatchSelectionAfterMutation]);

  const saveStudentBatches = useCallback(async () => {
    if (!selectedStudent) {
      Alert.alert('Student required', 'Choose a student first.');
      return;
    }
    setBusyMessage('Saving batches...');
    try {
      await apiJson('/api/batches/assign', {
        method: 'POST',
        body: JSON.stringify({
          student_uid: selectedStudent.student_uid,
          batch_names: selectedStudentBatches
        })
      });
      await loadStudentDirectory(true);
      await loadRoster(currentSessionRef.current?.session_id, attendanceBatch, true).catch(() => null);
      setBusyMessage('');
      Alert.alert('Saved', 'Student batch assignment updated.');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save the batches.');
    }
  }, [apiJson, attendanceBatch, currentSession?.session_id, loadRoster, loadStudentDirectory, selectedStudent, selectedStudentBatches]);

  const deleteStudent = useCallback(async () => {
    Alert.alert('Not available', 'Student deletion is not wired in this mobile build yet.');
  }, []);

  const createNotice = useCallback(async () => {
    if (!noticeTitle.trim() || !noticeContent.trim() || !noticeTarget) {
      Alert.alert('Missing fields', 'Title, content, and target are required.');
      return;
    }
    setBusyMessage('Publishing notice...');
    try {
      await apiJson('/api/notices', { method: 'POST', body: JSON.stringify({ title: noticeTitle.trim(), content: noticeContent.trim(), target_batch: noticeTarget }) });
      setNoticeTitle('');
      setNoticeContent('');
      setNoticeTarget('ALL');
      await loadNotices(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Publish failed', error instanceof Error ? error.message : 'Could not create notice.');
    }
  }, [apiJson, loadNotices, noticeContent, noticeTarget, noticeTitle]);

  const markLeadRead = useCallback(async (leadId: number) => {
    await apiJson(`/api/leads/${leadId}/read`, { method: 'POST' });
    await loadLeads(true);
  }, [apiJson, loadLeads]);

  const markAllLeadsRead = useCallback(async () => {
    setBusyMessage('Marking requests...');
    try {
      await Promise.all(leads.filter((lead) => lead.is_read === 0).map((lead) => apiJson(`/api/leads/${lead.id}/read`, { method: 'POST' })));
      await loadLeads(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Could not update requests.');
    }
  }, [apiJson, leads, loadLeads]);

  const setLeadApproval = useCallback(async (leadId: number, allowed: boolean) => {
    setBusyMessage(allowed ? 'Approving...' : 'Blocking...');
    try {
      await apiJson(`/api/leads/${leadId}/id-card-approval`, { method: 'POST', body: JSON.stringify({ allowed }) });
      await loadLeads(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Approval failed', error instanceof Error ? error.message : 'Could not update approval.');
    }
  }, [apiJson, loadLeads]);

  const exportCsv = useCallback(async (batch?: string) => {
    try {
      const path = batch ? `/api/admin/export_csv?batch=${encodeURIComponent(batch)}` : '/api/admin/export_csv';
      await downloadAndOpen(path, batch ? `${batch}_report.csv` : 'rmc_export.csv');
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not export CSV.');
    }
  }, [downloadAndOpen]);

  const exportAbsenteeCsv = useCallback(async () => {
    if (!selectedAbsenteeSessionId) {
      Alert.alert('Session required', 'Choose a closed session first.');
      return;
    }
    const sessionEntry = batchHistory.find((entry) => String(entry.session_id || '') === selectedAbsenteeSessionId);
    try {
      await downloadAndOpen(
        `/api/reports/absentees/export?session_id=${encodeURIComponent(selectedAbsenteeSessionId)}`,
        `${(attendanceBatch || sessionEntry?.batch_id || 'batch').replace(/[^a-zA-Z0-9_-]+/g, '_')}_absentees.csv`
      );
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not export absentees.');
    }
  }, [attendanceBatch, batchHistory, downloadAndOpen, selectedAbsenteeSessionId]);

  const exportTestReportCsv = useCallback(async () => {
    if (!testBatch) {
      Alert.alert('Batch required', 'Choose a batch first.');
      return;
    }
    try {
      await downloadAndOpen(
        `/api/reports/tests/export?batch=${encodeURIComponent(testBatch)}`,
        `${testBatch.replace(/[^a-zA-Z0-9_-]+/g, '_')}_test_report.csv`
      );
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not export test report.');
    }
  }, [downloadAndOpen, testBatch]);

  const previewSms = useCallback(async () => {
    setBusyMessage('Preparing preview...');
    try {
      const smsSessionCandidatesLocal = buildSmsSessionCandidates({
        batchName: smsBatch,
        history: smsBatchHistory,
        currentSession,
        sessionsByKey: appCacheRef.current.sessionsByKey,
        sessionAliasMap: appCacheRef.current.sessionAliasMap
      });
      const selectedSession = resolveSmsSessionCandidate({
        requestedKey: smsSessionId,
        candidates: smsSessionCandidatesLocal,
        sessionsByKey: appCacheRef.current.sessionsByKey,
        sessionAliasMap: appCacheRef.current.sessionAliasMap,
        allowSessionCacheFallback: smsBatchHistory.length === 0
      });
      if (smsAudience === 'session') {
        if (!selectedSession) {
          setSmsPreview({ recipients: [], count: 0, skipped: 0, source: 'local_session', emptyReason: 'Select an attendance session.' });
          setBusyMessage('');
          return;
        }
        const localPreview = await buildSmsSessionPreview(selectedSession);
        setSmsPreview(localPreview);
        setBusyMessage('');
        return;
      }
      const payload = {
        audience: smsAudience,
        recipient_mode: normalizeSmsRecipientMode(smsRecipientMode),
        message_template: smsMessage.trim(),
        statuses: smsStatuses.join(','),
        batch_name: smsBatch,
        session_id: String(selectedSession?.serverSessionId || ''),
        numbers_text: smsCustomNumbers
      };
      const data = await apiJson<{ recipients: any[], count: number, skipped: number }>('/api/sms/preview', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    const normalizedRecipients = Array.isArray(data.recipients) ? data.recipients.map((row) => normalizeSmsPreviewRecipient(row as Partial<SmsPreviewRecipient>)) : [];
      setSmsPreview({
        recipients: normalizedRecipients,
        count: Number(data.count || normalizedRecipients.length) || normalizedRecipients.length,
        skipped: Number(data.skipped || 0) || 0,
        source: 'server_preview'
      });
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Preview failed', 'Could not load SMS preview.');
    }
  }, [apiJson, buildSmsSessionPreview, smsAudience, smsBatch, smsCustomNumbers, smsMessage, smsRecipientMode, smsSessionId, smsStatuses]);

  const sendSmsBatch = useCallback(async () => {
    if (!smsMessage.trim()) {
      Alert.alert('Message empty', 'Please write a message template first.');
      return;
    }
    Alert.alert('Send SMS', 'Are you sure you want to send this SMS to the selected audience?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          setSmsSending(true);
          try {
            const smsSessionCandidatesLocal = buildSmsSessionCandidates({
              batchName: smsBatch,
              history: smsBatchHistory,
              currentSession,
              sessionsByKey: appCacheRef.current.sessionsByKey,
              sessionAliasMap: appCacheRef.current.sessionAliasMap
            });
            const selectedSession = resolveSmsSessionCandidate({
              requestedKey: smsSessionId,
              candidates: smsSessionCandidatesLocal,
              sessionsByKey: appCacheRef.current.sessionsByKey,
              sessionAliasMap: appCacheRef.current.sessionAliasMap,
              allowSessionCacheFallback: smsBatchHistory.length === 0
            });
            if (smsAudience === 'session') {
              const previewData = smsPreview?.source === 'local_session' && Array.isArray(smsPreview.recipients)
                ? smsPreview
                : await buildSmsSessionPreview(selectedSession);
              const recipients = filterSmsPreviewRecipientsByStatusSelection(
                Array.isArray(previewData.recipients) ? previewData.recipients : [],
                smsStatuses,
                smsAudience
              );
              setSmsPreview({
                ...previewData,
                recipients,
                count: recipients.length,
                skipped: recipients.filter((recipient) => !recipient.can_send && !String(recipient.selected_phone || recipient.recipient_phone || recipient.phone || '').trim()).length
              });
              if (!recipients.length) {
                setSmsSending(false);
                Alert.alert('Send SMS', previewData.emptyReason || 'No recipients are available for this session.');
                return;
              }

              let sent = 0;
              let failed = 0;
              for (const recipient of recipients) {
              if (!recipient.can_send && !String(recipient.selected_phone || recipient.recipient_phone || recipient.phone || '').trim()) {
                failed += 1;
                continue;
              }
                try {
                  const result = await sendSmsRecipientViaBackend(recipient as SmsPreviewRecipient);
                  if (result.ok) {
                    sent += 1;
                  } else {
                    failed += 1;
                  }
                } catch {
                  failed += 1;
                }
              }
              setSmsSending(false);
              Alert.alert('SMS Sent', `Sent: ${sent}\nFailed: ${failed}`);
              return;
            }
            const payload = {
              audience: smsAudience,
              recipient_mode: normalizeSmsRecipientMode(smsRecipientMode),
              message_template: smsMessage.trim(),
              statuses: smsStatuses.join(','),
              batch_name: smsBatch,
              session_id: String(selectedSession?.serverSessionId || ''),
              numbers_text: smsCustomNumbers
            };
            const data = await apiJson<{ sent: number, failed: number; results?: any[] }>('/api/sms/send', {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            setSmsSending(false);
            if (data.results) {
              setSmsPreview({
                recipients: Array.isArray(data.results) ? data.results.map((row) => normalizeSmsPreviewRecipient(row as Partial<SmsPreviewRecipient>)) : [],
                count: Number(data.sent || 0) || 0,
                skipped: Number(data.failed || 0) || 0,
                source: 'server_preview'
              });
            }
            Alert.alert('SMS Sent', `Sent: ${data.sent}\nFailed: ${data.failed}`);
          } catch (error) {
            setSmsSending(false);
            Alert.alert('Send failed', 'Could not send SMS.');
          }
        }
      }
    ]);
  }, [apiJson, buildSmsSessionPreview, sendSmsRecipientViaBackend, smsAudience, smsBatch, smsCustomNumbers, smsMessage, smsPreview, smsRecipientMode, smsSessionId, smsStatuses]);

  const createStaffCard = useCallback(async () => {
    if (!staffCardForm.full_name.trim() || !staffCardForm.username.trim() || !staffCardForm.password.trim()) {
      Alert.alert('Missing fields', 'Full name, username, and password are required.');
      return;
    }
    setBusyMessage('Creating staff card...');
    try {
      const payload = await apiJson<{ status: string; staff: CreatedStaffCard }>('/api/staff/cards', { method: 'POST', body: JSON.stringify(staffCardForm) });
      setCreatedStaffCard(payload.staff);
      setStaffCardForm({ full_name: '', username: '', password: '', phone: '', role: 'teacher' });
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Create failed', error instanceof Error ? error.message : 'Could not create staff card.');
    }
  }, [apiJson, staffCardForm]);

  const renameTable = useCallback(async () => {
    if (!renameTableTarget.trim() || !renameTableValue.trim()) {
      Alert.alert('Missing fields', 'Choose a table and enter a new name.');
      return;
    }
    setBusyMessage('Renaming table...');
    try {
      await apiJson(`/api/admin/tables/${encodeURIComponent(renameTableTarget)}`, { method: 'PUT', body: JSON.stringify({ newName: renameTableValue.trim() }) });
      setRenameTableTarget('');
      setRenameTableValue('');
      await loadAdmin();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Rename failed', error instanceof Error ? error.message : 'Could not rename table.');
    }
  }, [apiJson, loadAdmin, renameTableTarget, renameTableValue]);

  const dropTable = useCallback((tableName: string) => {
    Alert.alert('Drop table', `Drop ${tableName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Drop',
        style: 'destructive',
        onPress: async () => {
          setBusyMessage('Dropping table...');
          try {
            await apiJson(`/api/admin/tables/${encodeURIComponent(tableName)}`, { method: 'DELETE' });
            await loadAdmin();
            setBusyMessage('');
          } catch (error) {
            setBusyMessage('');
            Alert.alert('Drop failed', error instanceof Error ? error.message : 'Could not drop table.');
          }
        }
      }
    ]);
  }, [apiJson, loadAdmin]);

  const resetSystem = useCallback(() => {
    Alert.alert('Reset system', 'This will purge all student data. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          setBusyMessage('Resetting system...');
          try {
            await apiJson('/api/admin/system_reset', { method: 'POST' });
      await refreshStaffWorkspace(true);
            await loadAdmin();
            setBusyMessage('');
          } catch (error) {
            setBusyMessage('');
            Alert.alert('Reset failed', error instanceof Error ? error.message : 'Could not reset system.');
          }
        }
      }
    ]);
  }, [apiJson, loadAdmin, refreshStaffWorkspace]);

  const medalForRank = useCallback((rank: number) => {
    if (rank === 1) return '#1';
    if (rank === 2) return '#2';
    if (rank === 3) return '#3';
    return `${rank}.`;
  }, []);

  const prettifyLeadSource = useCallback((source?: string) => {
    const normalized = (source || '').trim().toLowerCase();
    if (!normalized || normalized === 'id_card_permission_request') return 'ID Card Request';
    return normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }, []);

  const updateDraftQuestion = useCallback((index: number, updater: (question: DraftTestQuestion) => DraftTestQuestion) => {
    setDraftQuestions((prev) => prev.map((question, questionIndex) => (
      questionIndex === index ? updater(question) : question
    )));
  }, []);

  const addDraftQuestion = useCallback(() => {
    setDraftQuestions((prev) => [...prev, { question_text: '', options: { A: '', B: '', C: '', D: '' }, correct_option: 'A' }]);
  }, []);

  const removeDraftQuestion = useCallback((index: number) => {
    setDraftQuestions((prev) => prev.length === 1 ? prev : prev.filter((_, questionIndex) => questionIndex !== index));
  }, []);

  const saveTestPaper = useCallback(async () => {
    if (!testDraftTitle.trim() || !testDraftSubject.trim()) {
      Alert.alert('Missing details', 'Test title and subject are required.');
      return;
    }
    setBusyMessage('Saving test paper...');
    try {
      await apiJson('/api/tests/papers', {
        method: 'POST',
        body: JSON.stringify({
          title: testDraftTitle.trim(),
          subject: testDraftSubject.trim(),
          duration_minutes: Number(testDraftDuration) || 30,
          questions: draftQuestions
        })
      });
      setTestDraftTitle('');
      setTestDraftSubject('');
      setTestDraftDuration('30');
      setDraftQuestions([{ question_text: '', options: { A: '', B: '', C: '', D: '' }, correct_option: 'A' }]);
      await loadTestAdmin();
      setBusyMessage('');
      Alert.alert('Saved', 'Test paper created successfully.');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save test paper.');
    }
  }, [apiJson, draftQuestions, loadTestAdmin, testDraftDuration, testDraftSubject, testDraftTitle]);

  const launchSelectedTest = useCallback(async () => {
    if (!testBatch || !selectedPaperId) {
      Alert.alert('Missing selection', 'Choose both a batch and a saved paper.');
      return;
    }
    setBusyMessage('Launching test...');
    try {
      await apiJson('/api/tests/launches', {
        method: 'POST',
        body: JSON.stringify({ batch_name: testBatch, paper_id: Number(selectedPaperId) })
      });
      await loadTestAdmin();
      setBusyMessage('');
      Alert.alert('Live now', 'The test has been launched for the selected batch.');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Launch failed', error instanceof Error ? error.message : 'Could not launch test.');
    }
  }, [apiJson, loadTestAdmin, selectedPaperId, testBatch]);

  const closeTestLaunch = useCallback(async (launchId: number) => {
    setBusyMessage('Closing test...');
    try {
      await apiJson(`/api/tests/launches/${launchId}/close`, { method: 'POST' });
      await loadTestAdmin();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Close failed', error instanceof Error ? error.message : 'Could not close the test.');
    }
  }, [apiJson, loadTestAdmin]);

  const setScoreboardPublished = useCallback(async (launchId: number, published: boolean) => {
    setBusyMessage(published ? 'Publishing scoreboard...' : 'Hiding scoreboard...');
    try {
      await apiJson(`/api/tests/launches/${launchId}/publish-scoreboard`, {
        method: 'POST',
        body: JSON.stringify({ published })
      });
      await loadTestAdmin();
    if (session?.type === 'student') await loadStudentTests(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Could not update scoreboard visibility.');
    }
  }, [apiJson, loadStudentTests, loadTestAdmin, session?.type]);

  const openStudentTest = useCallback(async (launchId: number) => {
    setBusyMessage('Opening test...');
    try {
      const payload = await apiJson<{ status: string } & TestAttemptPayload>(`/api/student/tests/${launchId}`);
      setActiveTestAttempt(payload);
      setTestAnswers({});
      setTestAttemptVisible(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Open failed', error instanceof Error ? error.message : 'Could not open the test.');
    }
  }, [apiJson]);

  const submitStudentTest = useCallback(async () => {
    if (!activeTestAttempt) return;
    setBusyMessage('Submitting test...');
    try {
      await apiJson(`/api/student/tests/${activeTestAttempt.launch.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: testAnswers })
      });
      setTestAttemptVisible(false);
      setActiveTestAttempt(null);
      setTestAnswers({});
      await Promise.all([loadStudentTests(true), selectedScoreboardLaunchId ? loadScoreboard(Number(selectedScoreboardLaunchId), 'student') : Promise.resolve()]);
      setBusyMessage('');
      Alert.alert('Submitted', 'Your test has been graded automatically.');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Submit failed', error instanceof Error ? error.message : 'Could not submit your test.');
    }
  }, [activeTestAttempt, apiJson, loadScoreboard, loadStudentTests, selectedScoreboardLaunchId, testAnswers]);

  const openPastPaper = useCallback(async (launchId: number) => {
    setBusyMessage('Loading past paper...');
    try {
      const payload = await apiJson<{ status: string } & TestAttemptPayload>(`/api/student/tests/${launchId}/past-paper`);
      setPastPaperPayload(payload);
      setPastPaperVisible(true);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Load failed', error instanceof Error ? error.message : 'Could not load the past paper.');
    }
  }, [apiJson]);

  const deferredStudentSearch = useDeferredValue(studentSearch);
  const filteredStudents = useMemo(() => {
    const query = deferredStudentSearch.trim().toLowerCase();
    const pool = studentBatchFilter ? students.filter((student) => batchMatches(student, studentBatchFilter)) : students;
    if (!query) return pool;
    return pool.filter((student) => [student.name, student.student_uid, student.phone, student.batch_name, getStudentBatchList(student).join(' ')].join(' ').toLowerCase().includes(query));
  }, [deferredStudentSearch, studentBatchFilter, students]);
  const studentDirectoryPreview = useMemo(() => filteredStudents, [filteredStudents]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'students') return;
    if (!studentDirectoryCount) return;
    if (studentSearch.trim()) return;
    if (!studentBatchFilter) return;
    if (filteredStudents.length > 0) return;
    setStudentBatchFilter('');
  }, [filteredStudents.length, session?.type, staffTab, studentBatchFilter, studentDirectoryCount, studentSearch]);

  const staffSummary = useMemo(() => ({ totalStudents: studentDirectoryCount, unreadLeads: leads.filter((lead) => lead.is_read === 0).length }), [leads, studentDirectoryCount]);

  const guestTabs: Array<{ key: GuestTab; label: string }> = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'student', label: 'Student' },
    { key: 'staff', label: 'Staff' },
    { key: 'register', label: 'Register' }
  ];

  const studentTabs: Array<{ key: StudentTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'examination', label: 'Exam' },
    { key: 'doubts', label: 'Doubts' }
  ];

  const staffTabs: Array<{ key: StaffTab; label: string }> = [
    { key: 'home', label: 'Home' },
    { key: 'attendance', label: 'Roll Call' },
    { key: 'students', label: 'Students' },
    { key: 'batches', label: 'Batches' },
    { key: 'cards', label: 'Staff Cards' },
    ...(isTestCloneServer ? [{ key: 'fees' as const, label: 'Fees' }] : []),
    { key: 'sms', label: 'SMS Control' },
    { key: 'materials', label: 'Library' },
    { key: 'examination', label: 'Examination' },
    { key: 'notifications', label: 'Inbox' },
    { key: 'reports', label: 'Reports' },
    { key: 'doubts', label: 'Doubts' },
    { key: 'register', label: 'Register Student' },
    ...(isHost ? [{ key: 'admin' as const, label: 'Admin' }] : [])
  ];
  const staffSidebarItems = useMemo<StaffSidebarItem[]>(() => ([
    { key: 'home', label: 'Home' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'students', label: 'Students' },
    { key: 'batches', label: 'Batches' },
    { key: 'cards', label: 'Staff Cards' },
    { key: 'sms', label: 'SMS Control' },
    { key: 'materials', label: 'Library' },
    { key: 'examination', label: 'Examination' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'reports', label: 'Reports' },
    { key: 'doubts', label: 'Doubts' },
    { key: 'register', label: 'Register Student' },
    { key: 'admin', label: 'Admin', requiredRole: 'admin' }
  ].filter((item) => !item.requiredRole || (item.requiredRole === 'admin' ? isHost : true)) as StaffSidebarItem[]), [isHost]);
  const availableStaffTabKeys = useMemo(() => {
    const keys = new Set<StaffTab>(staffSidebarItems.map((item) => item.key as StaffTab));
    if (isTestCloneServer) {
      keys.add('fees');
    }
    return keys;
  }, [isTestCloneServer, staffSidebarItems]);
  const getSafeStaffTab = useCallback((currentTab: StaffTab | null | undefined, fallbackTab: StaffTab = 'home') => {
    const candidate = currentTab && availableStaffTabKeys.has(currentTab) ? currentTab : null;
    if (candidate) return candidate;
    if (fallbackTab && availableStaffTabKeys.has(fallbackTab)) return fallbackTab;
    return staffSidebarItems[0]?.key || 'home';
  }, [availableStaffTabKeys, staffSidebarItems]);
  const setStaffTab = useCallback((nextTab: StaffTab, options?: { resetReason?: 'manual' | 'login' | 'logout' | 'role_change' | 'invalid' | null }) => {
    staffTabResetReasonRef.current = options?.resetReason ?? (nextTab === 'home' ? 'manual' : null);
    if (nextTab !== 'home') {
      lastNonHomeStaffTabRef.current = nextTab;
    }
    setStaffTabState(nextTab);
  }, []);
  const openStaffSection = useCallback((nextTab: StaffTab) => {
    setStaffTab(nextTab, { resetReason: 'manual' });
    setStaffDrawerOpen(false);
  }, [setStaffTab]);
  const staffNotificationTabs: Array<{ key: StaffNotificationSection; label: string }> = [
    { key: 'notices', label: 'Notices' },
    { key: 'absentees', label: 'Absentees' },
    { key: 'leads', label: 'Leads' },
    { key: 'id_requests', label: 'ID Requests' }
  ];
  useEffect(() => {
    if (!session || session.type !== 'staff') {
      staffTabResetReasonRef.current = null;
      return;
    }

    const safeTab = getSafeStaffTab(staffTab, lastNonHomeStaffTabRef.current || 'home');
    if (safeTab !== staffTab) {
      setStaffTab(safeTab, { resetReason: 'role_change' });
      return;
    }

    if (staffTab !== 'home') {
      lastNonHomeStaffTabRef.current = staffTab;
      staffTabResetReasonRef.current = null;
      return;
    }

    const resetReason = staffTabResetReasonRef.current;
    staffTabResetReasonRef.current = null;
    if (resetReason) {
      return;
    }

    const fallbackTab = getSafeStaffTab(lastNonHomeStaffTabRef.current, 'home');
    if (fallbackTab !== 'home') {
      setStaffTab(fallbackTab, { resetReason: 'role_change' });
    }
  }, [getSafeStaffTab, session, setStaffTab, staffTab]);
  const attendanceSessionKey = useMemo(() => getSessionKeyForIdentity(currentSession), [currentSession?.sessionKey, currentSession?.localSessionId, currentSession?.serverSessionId, currentSession?.session_id]);
  const batchRosterRows = useMemo(() => deriveAttendanceConsoleRows({
    batchName: attendanceBatch,
    sessionKey: '',
    sessionMode: 'roster',
    studentsByUid: appCacheRef.current.studentsByUid,
    rosterByBatch: appCacheRef.current.rosterByBatch,
    attendanceMarksBySession: appCacheRef.current.attendanceMarksBySession,
    sessionAliasMap: appCacheRef.current.sessionAliasMap,
    legacyRoster: roster
  }), [attendanceBatch, roster]);
  const currentSessionAttendanceRows = useMemo(() => deriveAttendanceConsoleRows({
    batchName: attendanceBatch,
    sessionKey: attendanceSessionKey,
    sessionMode: 'active',
    studentsByUid: appCacheRef.current.studentsByUid,
    rosterByBatch: appCacheRef.current.rosterByBatch,
    attendanceMarksBySession: appCacheRef.current.attendanceMarksBySession,
    sessionAliasMap: appCacheRef.current.sessionAliasMap,
    legacyRoster: roster
  }), [attendanceBatch, attendanceSessionKey, roster]);
  const closedSessionRows = useMemo(() => deriveAttendanceConsoleRows({
    batchName: attendanceBatch,
    sessionKey: attendanceSessionKey,
    sessionMode: 'closed',
    studentsByUid: appCacheRef.current.studentsByUid,
    rosterByBatch: appCacheRef.current.rosterByBatch,
    attendanceMarksBySession: appCacheRef.current.attendanceMarksBySession,
    sessionAliasMap: appCacheRef.current.sessionAliasMap,
    legacyRoster: roster
  }), [attendanceBatch, attendanceSessionKey, roster]);
  const attendanceRosterData = useMemo(() => {
    if (!currentSession) {
      return batchRosterRows;
    }
    return currentSession.status === 'closed' ? closedSessionRows : currentSessionAttendanceRows;
  }, [batchRosterRows, closedSessionRows, currentSession, currentSessionAttendanceRows]);
  const smsSessionCandidates = useMemo(() => buildSmsSessionCandidates({
    batchName: smsBatch,
    history: smsBatchHistory,
    currentSession,
    sessionsByKey: appCacheRef.current.sessionsByKey,
    sessionAliasMap: appCacheRef.current.sessionAliasMap
  }), [attendanceQueueRevision, attendanceSessionCacheRevision, currentSession?.serverSessionId, currentSession?.sessionKey, currentSession?.status, smsBatch, smsBatchHistory]);
  const smsVisiblePreviewRecipients = useMemo(() => {
    const recipients = Array.isArray(smsPreview?.recipients) ? smsPreview.recipients : [];
    return filterSmsPreviewRecipientsByStatusSelection(recipients, smsStatuses, smsAudience);
  }, [smsAudience, smsPreview?.recipients, smsStatuses]);
  async function buildSmsSessionPreview(selectedSession: SmsSessionCandidate | null): Promise<SmsPreviewState> {
    if (!selectedSession) {
      return { recipients: [], count: 0, skipped: 0, emptyReason: 'Select an attendance session.', source: 'local_session' };
    }

    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const batchName = String(selectedSession.batchId || smsBatch || '').trim();
    const sessionRosterKey = getSmsSessionRosterCacheKey(batchName, selectedSession.serverSessionId || selectedSession.sessionId || 0);
    const cachedRosterEntry = sessionRosterKey ? getCachedResource<{ roster: StudentRow[] }>(sessionRosterKey) : undefined;
    const cachedRosterSnapshot = Array.isArray(cachedRosterEntry?.data?.roster) ? cachedRosterEntry.data.roster : [];
    let rosterSource = cachedRosterSnapshot.length ? cachedRosterSnapshot : rosterSnapshotRef.current.length ? rosterSnapshotRef.current : roster;

    if (selectedSession.serverSessionId && batchName && !cachedRosterSnapshot.length) {
      await loadRoster(selectedSession.serverSessionId, batchName, false, false).catch(() => null);
      const refreshedRosterEntry = sessionRosterKey ? getCachedResource<{ roster: StudentRow[] }>(sessionRosterKey) : undefined;
      const refreshedRosterSnapshot = Array.isArray(refreshedRosterEntry?.data?.roster) ? refreshedRosterEntry.data.roster : [];
      rosterSource = refreshedRosterSnapshot.length ? refreshedRosterSnapshot : (rosterSnapshotRef.current.length ? rosterSnapshotRef.current : roster);
    }

    const preview = buildLocalSmsPreview({
      candidate: selectedSession,
      batchName,
      roster: rosterSource,
      studentsByUid: currentCache.studentsByUid || {},
      rosterByBatch: currentCache.rosterByBatch || {},
      attendanceMarksBySession: currentCache.attendanceMarksBySession || {},
      sessionAliasMap: currentCache.sessionAliasMap || {},
      sessionsByKey: currentCache.sessionsByKey || {},
      currentSessionKey: getSessionKeyForIdentity(currentCache.currentSession || currentSessionRef.current),
      template: smsMessage.trim(),
      recipientMode: smsRecipientMode,
      statuses: smsStatuses
    });
    return preview;
  }
  async function openSmsComposerForRecipient(recipient: SmsPreviewRecipient) {
    const phone = String(recipient.selected_phone || recipient.recipient_phone || recipient.phone || '').trim();
    const message = String(recipient.message || '').trim();
    if (!phone || !message) {
      Alert.alert('No phone number', 'This recipient has no phone number.');
      return;
    }
    const body = encodeURIComponent(message);
    const url = Platform.OS === 'android'
      ? `sms:${encodeURIComponent(phone)}?body=${body}`
      : `sms:${encodeURIComponent(phone)}&body=${body}`;
    await Linking.openURL(url);
  }
  const markSmsPreviewRecipientSent = useCallback((recipient: SmsPreviewRecipient) => {
    const sentAt = new Date().toISOString();
    const targetUid = String(recipient.student_uid || '').trim();
    const targetPhone = String(recipient.selected_phone || recipient.recipient_phone || recipient.phone || '').trim();
    setSmsPreview((prev) => {
      if (!prev || !Array.isArray(prev.recipients)) return prev;
      return {
        ...prev,
        recipients: prev.recipients.map((row) => {
          const rowUid = String(row.student_uid || '').trim();
          const rowPhone = String(row.selected_phone || row.recipient_phone || row.phone || '').trim();
          if (rowUid === targetUid && rowPhone === targetPhone) {
            return {
              ...row,
              sent: true,
              sentAt
            };
          }
          return row;
        })
      };
    });
  }, []);
  async function sendSmsRecipientViaBackend(recipient: SmsPreviewRecipient): Promise<{ ok: boolean; error?: string }> {
  const phone = String(recipient.selected_phone || recipient.recipient_phone || recipient.phone || '').trim();
  const message = String(recipient.message || '').trim();
  if (!phone || !message) {
    return { ok: false, error: 'Missing recipient phone or message.' };
  }
    await apiJson('/api/sms/send', {
      method: 'POST',
      body: JSON.stringify({
        audience: 'custom',
        numbers_text: phone,
        message_template: message
      })
    });
    return { ok: true };
  }
  const renderRosterStudentRow = useCallback(({ item }: { item: StudentRow }) => (
    <StudentCompactRow student={item} onPress={openStudentDetail} />
  ), [openStudentDetail]);
  const rosterStudentUidKeyExtractor = useCallback((item: StudentRow) => item.student_uid, []);
  const refreshAttendanceDisplayRows = useCallback((
    sessionMode: 'roster' | 'active' | 'closed',
    sessionKey?: string,
    batchName?: string,
    sourceRows: StudentRow[] = roster
  ) => {
    const currentCache = normalizeLocalAttendanceCache(appCacheRef.current);
    const nextRows = deriveAttendanceConsoleRows({
      batchName: batchName || attendanceBatch,
      sessionKey: sessionKey || '',
      sessionMode,
      studentsByUid: currentCache.studentsByUid,
      rosterByBatch: currentCache.rosterByBatch,
      attendanceMarksBySession: currentCache.attendanceMarksBySession,
      sessionAliasMap: currentCache.sessionAliasMap,
      legacyRoster: sourceRows
    });
    setAttendanceDisplayRows(nextRows);
    return nextRows;
  }, [attendanceBatch, roster]);

  const buildOfflineAttendanceRosterFallback = useCallback((batchName: string, currentCache: AppCachePayload | LocalAttendanceCache) => {
    const normalizedBatchName = String(batchName || '').trim();
    if (!normalizedBatchName) return [];
    const directoryPool = studentDirectorySnapshotRef.current.length ? studentDirectorySnapshotRef.current : students;
    if (!Array.isArray(directoryPool) || !directoryPool.length) return [];
    const directoryStudentsByUid = buildStudentsByUid(directoryPool, currentCache.studentsByUid || {});
    return deriveAttendanceRosterRows({
      batchName: normalizedBatchName,
      studentsByUid: directoryStudentsByUid,
      rosterByBatch: currentCache.rosterByBatch || {},
      attendanceMarksBySession: currentCache.attendanceMarksBySession || {},
      sessionAliasMap: currentCache.sessionAliasMap || {},
      legacyRoster: directoryPool
    });
  }, [students]);
  const studentNoticeFeed = useMemo(
    () => [...studentNotices, ...studentNotifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [studentNotices, studentNotifications]
  );
  const studentMaterialFeed = useMemo(
    () => [...studentMaterials].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [studentMaterials]
  );
  const renderWelcome = () => (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.welcomeContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor="#15803D" />}
    >
      <View style={styles.welcomeStage}>
        <View style={[styles.heroBranding, { transform: [{ translateY: Number(mobileConfig.welcome_hero_offset_y || 0) }] }]}>
          <Text style={styles.heroTitle}>RMC</Text>
          <Text style={styles.heroSubtitle}>Concept Se Selection Tak</Text>
        </View>
      </View>
    </ScrollView>
  );

  const renderRegister = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <SectionCard title="Join RMC" subtitle="Complete your registration to generate your digital student ID.">
        <View style={styles.photoPanel}>
          {registrationForm.photo ? <Image source={{ uri: registrationForm.photo }} style={styles.photoPreview} /> : <Text style={styles.emptyBody}>Portrait required for ID card.</Text>}
        </View>
        <View style={styles.buttonRow}>
          <PrimaryButton title="Camera" onPress={() => pickRegistrationPhoto('camera')} tone="secondary" />
          <PrimaryButton title="Gallery" onPress={() => pickRegistrationPhoto('library')} tone="secondary" />
        </View>
        <LabeledInput label="Full Name" value={registrationForm.name} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, name: value }))} placeholder="Student name" />
        <LabeledInput label="Phone" value={registrationForm.phone} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, phone: normalizePhoneDigits(value) }))} placeholder="10-digit mobile number" keyboardType="phone-pad" maxLength={10} />
        <LabeledInput label="Parent Phone" value={registrationForm.guardian_phone} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, guardian_phone: normalizePhoneDigits(value) }))} placeholder="10-digit parent number" keyboardType="phone-pad" maxLength={10} />
        <Text style={styles.helper}>Only 10 digits are allowed in both phone fields. Letters, spaces, and symbols are removed automatically.</Text>
        <LabeledInput label="Father Name" value={registrationForm.father_name} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, father_name: value }))} placeholder="Father name" />
        <LabeledInput label="Address" value={registrationForm.address} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, address: value }))} placeholder="Full address" multiline />
        <DropdownSelect
          label="Class / Course"
          placeholder="Select Class..."
          value={registrationForm.student_class}
          options={['11th', '12th', 'Dropper']}
          onChange={(value) => setRegistrationForm((prev) => ({ ...prev, student_class: value }))}
        />
        <MultiSelectDropdown
          label="Select Target Batches"
          placeholder="Choose one or more batches"
          value={registrationForm.current_batches}
          options={registrationBatchOptions.map((batch) => ({ key: batch.name, label: batch.name }))}
          helperText={registrationForm.current_batches.length
            ? `Primary batch: ${registrationForm.current_batches[0]}`
            : 'The batch list stays live and updates when the server changes.'}
          onChange={(value) => setRegistrationForm((prev) => ({ ...prev, current_batches: value }))}
        />
        <Text style={styles.label}>Aspiration</Text>
        <PillTabs items={[{ key: 'JEE', label: 'JEE' }, { key: 'NEET', label: 'NEET' }, { key: 'NDA', label: 'NDA' }]} value={registrationForm.aspiration} onChange={(value) => setRegistrationForm((prev) => ({ ...prev, aspiration: value }))} />
        <PrimaryButton title="Register Student" onPress={submitRegistration} />
      </SectionCard>
    </ScrollView>
  );

  const renderStudentLogin = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <SectionCard title="Student Portal" subtitle="Access your attendance and materials via Trio-Lock.">
        <LabeledInput label="Student UID" value={studentUid} onChangeText={setStudentUid} placeholder="RMC-..." autoCapitalize="characters" />
        <View style={styles.divider}><Text style={styles.dividerText}>or use lock details</Text></View>
        <LabeledInput label="Your Name" value={studentName} onChangeText={setStudentName} placeholder="Full name" />
        <LabeledInput label="Father Name" value={studentFather} onChangeText={setStudentFather} placeholder="Father name" />
        <LabeledInput label="Phone" value={studentPhone} onChangeText={setStudentPhone} placeholder="+91..." keyboardType="phone-pad" />
        <PrimaryButton title="Login Now" onPress={handleStudentLogin} />
        <PrimaryButton title="Scan Student QR" onPress={() => setStudentScannerVisible(true)} tone="secondary" />
      </SectionCard>
    </ScrollView>
  );

  const renderStaffLogin = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <SectionCard title="Admin Login" subtitle="Teachers and host staff workspace.">
        <LabeledInput label="Staff Username" value={staffUsername} onChangeText={setStaffUsername} placeholder="teacher01" autoCapitalize="none" />
        <LabeledInput label="Security Password" value={staffPassword} onChangeText={setStaffPassword} placeholder="********" secureTextEntry />
        <PrimaryButton title="Enter Workspace" onPress={handleStaffLogin} />
        <PrimaryButton title="Scan Staff ID" onPress={() => setStaffScannerVisible(true)} tone="secondary" />
      </SectionCard>
    </ScrollView>
  );

  const renderStudentOverview = () => (
    <>
      {session?.type === 'student' ? (() => {
        const currentStudent = session.student;
        const qrUri = currentStudent.qr_path
          ? makeAbsoluteUrl(baseUrl, currentStudent.qr_path)
          : currentStudent.student_uid
            ? makeAbsoluteUrl(baseUrl, `/qrcodes/qr_${encodeURIComponent(currentStudent.student_uid)}.png`)
            : '';
        return (
          <Pressable onPress={() => setStudentQrExpanded((prev) => !prev)} style={({ pressed }) => [
            styles.studentQrCard,
            pressed && { opacity: 0.95, transform: [{ scale: 0.995 }] }
          ]}>
            <View style={styles.studentQrHeaderRow}>
              <Text style={styles.studentQrHeaderTitle}>YOUR QR PASS</Text>
              <Text style={styles.studentQrHeaderHint}>{studentQrExpanded ? 'Tap to hide' : 'Tap to show'}</Text>
            </View>
            {studentQrExpanded ? (
              <View style={styles.studentQrBody}>
                <View style={styles.studentQrImageShell}>
                  {qrUri ? (
                    <Image source={{ uri: qrUri }} style={styles.studentQrImage} resizeMode="contain" />
                  ) : (
                    <Text style={styles.studentQrFallback}>QR</Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.rowTitle}>{currentStudent.name}</Text>
                  <Text style={styles.rowText}>UID: {currentStudent.student_uid}</Text>
                  <Text style={styles.helper}>Show this QR above the notices when staff needs to verify you quickly.</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.helper}>Tap here to reveal your QR code above the notices.</Text>
            )}
          </Pressable>
        );
      })() : null}

        <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 12, marginLeft: 4 }}>INSTITUTE NOTICES</Text>
      <ScrollView
        style={styles.studentArchiveScroll}
        contentContainerStyle={styles.studentArchiveScrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {studentNoticeFeed.length ? studentNoticeFeed.map((notice) => (
          <View key={`notice-${notice.id}`} style={[styles.listBlock, {
            borderLeftWidth: 5,
            borderLeftColor: '#0D4E35',
            padding: 16,
            backgroundColor: '#FFFFFF',
            borderRadius: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 2,
            gap: 6
          }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.rowTitle, { fontSize: 15, color: '#111827' }]}>{notice.title || 'Notification'}</Text>
              <Text style={{ fontSize: 11, color: '#6B7280', fontWeight: '600' }}>{prettyDate(notice.created_at)}</Text>
            </View>
            <Text style={[styles.rowText, { marginTop: 2, color: '#4B5563', lineHeight: 20 }]} numberOfLines={3}>{notice.content}</Text>
          </View>
        )) : (
          <View style={[styles.listBlock, { padding: 20, alignItems: 'center' }]}>
            <Text style={styles.emptyBody}>No recent notifications available.</Text>
          </View>
        )}
      </ScrollView>

      <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginTop: 18, marginBottom: 12, marginLeft: 4 }}>STUDY MATERIALS</Text>
      <ScrollView
        style={styles.studentArchiveScroll}
        contentContainerStyle={styles.studentArchiveScrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {studentMaterialFeed.length ? studentMaterialFeed.map((material) => (
          <View key={material.id} style={[styles.listBlock, { marginBottom: 10 }]}>
            <Text style={styles.rowTitle}>{material.title}</Text>
            <Text style={styles.rowText}>{material.batch_name || 'GLOBAL'} - {material.access_mode.toUpperCase()} - {prettyDate(material.created_at)}</Text>
            <Text style={styles.helper}>{material.description || 'No description provided.'}</Text>
            <View style={styles.buttonRow}>
              <PrimaryButton title="Open & Save" onPress={() => handleMaterialOpen(material)} tone="secondary" />
            </View>
          </View>
        )) : (
          <View style={[styles.posterPanel, { backgroundColor: '#F3F4F6', borderStyle: 'dashed', borderWidth: 1, borderColor: '#D1D5DB' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>FILES</Text>
            <Text style={styles.posterCopy}>Materials coming soon!</Text>
            <Text style={styles.metaText}>Your subject notes and PPTs will appear here.</Text>
          </View>
        )}
      </ScrollView>

      <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginTop: 18, marginBottom: 12, marginLeft: 4 }}>SAVED ON THIS DEVICE</Text>
      <View style={{ marginBottom: 40 }}>
        {studentDownloadedMaterials.length ? studentDownloadedMaterials.map((item) => (
          <View key={item.material_id} style={[styles.listBlock, { marginBottom: 10 }]}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowText}>{item.batch_name || 'GLOBAL'} - {prettyDate(item.downloaded_at)}</Text>
            <Text style={styles.helper}>Stored locally: {item.file_name}</Text>
            <View style={styles.buttonRow}>
              <PrimaryButton title="Open Saved Copy" onPress={() => openCachedMaterial(item)} tone="secondary" />
            </View>
          </View>
        )) : (
          <View style={[styles.posterPanel, { backgroundColor: '#F3F4F6', borderStyle: 'dashed', borderWidth: 1, borderColor: '#D1D5DB' }]}>
            <Text style={{ fontSize: 24, marginBottom: 8 }}>SAVED</Text>
            <Text style={styles.posterCopy}>Nothing downloaded yet.</Text>
            <Text style={styles.metaText}>Open any material once and it will stay cached inside the app.</Text>
          </View>
        )}
      </View>
    </>
  );

  const renderStudentTests = () => (
    <>
      <SectionCard title="Tests Hub" subtitle="Take tests, review past papers, and track your rank in one place.">
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{studentTests.upcoming.length}</Text><Text style={styles.kpiLabel}>Live/Upcoming</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{studentTests.history.length}</Text><Text style={styles.kpiLabel}>Completed</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{studentTests.scoreboard_tests.length}</Text><Text style={styles.kpiLabel}>Scoreboards</Text></View>
        </View>
      </SectionCard>
      <SectionCard title="Upcoming Tests" subtitle="Join live tests assigned to your batch and submit from your phone.">
        {studentTests.upcoming.length ? studentTests.upcoming.map((test) => (
          <View key={test.launch_id} style={styles.listBlock}>
            <Text style={styles.metaText}>{test.subject} - {test.batch_name}</Text>
            <Text style={styles.rowTitle}>{test.title}</Text>
            <Text style={styles.rowText}>{prettyDate(test.starts_at || undefined)} - {test.duration_minutes} min - {test.question_count} questions</Text>
            <PrimaryButton title="Start Test" onPress={() => openStudentTest(test.launch_id)} />
          </View>
        )) : <Text style={styles.emptyBody}>No upcoming or live tests right now.</Text>}
      </SectionCard>
      <SectionCard title="Past Marks & Papers" subtitle="Review previous scores and open your marked paper.">
        {studentTests.history.length ? studentTests.history.map((test) => (
          <View key={test.launch_id} style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{test.title}</Text>
              <Text style={styles.rowText}>{test.subject} - {test.score ?? 0}/{test.total_questions || test.question_count} - {prettyDate(test.submitted_at || test.closed_at || undefined)}</Text>
            </View>
            <PrimaryButton title="Past Paper" onPress={() => openPastPaper(test.launch_id)} tone="secondary" />
          </View>
        )) : <Text style={styles.emptyBody}>Marks will appear here after you complete a test.</Text>}
      </SectionCard>
      <SectionCard title="Scoreboard" subtitle="Select a completed test to view the ranking board.">
        <PillTabs items={studentTests.scoreboard_tests.map((test) => ({ key: String(test.launch_id), label: test.title }))} value={selectedScoreboardLaunchId} onChange={setSelectedScoreboardLaunchId} />
        {scoreboardPayload?.scoreboard?.length ? scoreboardPayload.scoreboard.slice(0, 10).map((row) => {
          const isSelf = row.student_uid === (session?.type === 'student' ? session.student.student_uid : '');
          return (
            <View key={`${row.student_uid}-${row.rank}`} style={[styles.scoreboardRow, isSelf && styles.scoreboardRowSelf]}>
              <Text style={styles.scoreboardRank}>{medalForRank(row.rank)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{row.student_name}</Text>
                <Text style={styles.rowText}>Rank {row.rank} - {row.batch_name}</Text>
              </View>
              <Text style={styles.scoreboardScore}>{row.score}/{row.total_questions}</Text>
            </View>
          );
        }) : <Text style={styles.emptyBody}>Choose a completed test once the scoreboard is available.</Text>}
        {scoreboardPayload?.your_entry ? <View style={styles.rankBanner}><Text style={styles.metaText}>Your Rank</Text><Text style={styles.rankBannerText}>#{scoreboardPayload.your_entry.rank} with {scoreboardPayload.your_entry.score}/{scoreboardPayload.your_entry.total_questions}</Text></View> : null}
      </SectionCard>
    </>
  );

  const renderStudentDoubts = () => (
    <>
      <SectionCard title="Ask a Doubt" subtitle="Submit a question with an optional photo for teacher review.">
        <LabeledInput label="Your Question" value={newDoubtText} onChangeText={setNewDoubtText} placeholder="Type your doubt here..." multiline />
        <View style={styles.photoPanel}>
          {newDoubtPhoto ? <Image source={{ uri: newDoubtPhoto }} style={styles.photoPreview} /> : <Text style={styles.emptyBody}>Reference photo (optional)</Text>}
        </View>
        <View style={styles.buttonRow}>
          <PrimaryButton title="Camera" onPress={() => pickDoubtPhoto('camera')} tone="secondary" />
          <PrimaryButton title="Gallery" onPress={() => pickDoubtPhoto('library')} tone="secondary" />
        </View>
        <PrimaryButton title="Submit Doubt" onPress={submitDoubt} />
      </SectionCard>
      <SectionCard title="My Doubts" subtitle="Track your submitted doubts and view teacher replies.">
        {studentDoubts.length ? studentDoubts.map((doubt) => (
          <View key={doubt.id} style={styles.listBlock}>
            <Text style={styles.metaText}>{prettyDate(doubt.created_at)} - {doubt.status.toUpperCase()}</Text>
            <Text style={styles.rowTitle}>{doubt.question_text}</Text>
            {doubt.question_image ? (
              <PrimaryButton title="View Question Image" onPress={() => Linking.openURL(makeAbsoluteUrl(baseUrl, doubt.question_image!))} tone="secondary" />
            ) : null}
            {doubt.status === 'solved' ? (
              <View style={[styles.posterPanel, { marginTop: 12 }]}>
                <Text style={styles.metaText}>SOLVED - {prettyDate(doubt.replied_at || '')}</Text>
                {doubt.reply_image ? (
                  <PrimaryButton title="View Solution Image" onPress={() => Linking.openURL(makeAbsoluteUrl(baseUrl, doubt.reply_image!))} tone="secondary" />
                ) : <Text style={styles.posterCopy}>Teacher marked this as solved.</Text>}
              </View>
            ) : (
              <Text style={styles.helper}>Waiting for teacher review...</Text>
            )}
          </View>
        )) : <Text style={styles.emptyBody}>You haven't submitted any doubts yet.</Text>}
      </SectionCard>
    </>
  );

  const renderStudentPortal = (student: StudentProfile) => {
    return (
    <View style={{ flex: 1 }}>
      {studentTab === 'examination' ? (
        <ExamSectionHost role="student" baseUrl={baseUrl} session={session} onExit={() => setStudentTab('overview')} />
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor="#15803D" />}>
        <View style={styles.studentHeaderRow}>
          <View style={styles.studentAvatarBox}>
            <Text style={styles.studentAvatarText}>ST</Text>
          </View>
          <View style={styles.studentInfoCol}>
             <Text style={styles.studentNameHeader}>{student.name}</Text>
             <Text style={styles.studentIdHeader}>ID: {student.student_uid}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => Alert.alert('Logout', 'Are you sure you want to logout?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Logout', style: 'destructive', onPress: handleLogout }
            ])}
            style={{ padding: 8, backgroundColor: '#FEF2F2', borderRadius: 12, borderWidth: 1, borderColor: '#FEE2E2' }}
          >
            <Text style={{ color: '#991B1B', fontSize: 13, fontWeight: '800' }}>Logout</Text>
          </Pressable>
        </View>

        {studentTab === 'overview' && renderStudentOverview()}
        {studentTab === 'doubts' && renderStudentDoubts()}
        </ScrollView>
      )}
      <View style={{ flexDirection: 'row', backgroundColor: '#FFFFFF', paddingBottom: 22, paddingTop: 10, paddingHorizontal: 20, borderTopLeftRadius: 32, borderTopRightRadius: 32, shadowColor: '#0c4e36', shadowOpacity: 0.12, shadowOffset: { width: 0, height: -5 }, shadowRadius: 12, elevation: 20 }}>
        <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onPress={() => setStudentTab('overview')}>
           <View style={{ width: 88, height: 38, borderRadius: 19, backgroundColor: studentTab === 'overview' ? '#0D4E35' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Text allowFontScaling={false} numberOfLines={1} style={{ color: studentTab === 'overview' ? '#FFF' : '#8EA496', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4, textAlign: 'center' }}>HOME</Text>
            </View>
         </Pressable>
         <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onPress={() => setStudentTab('examination')}>
            <View style={{ width: 88, height: 38, borderRadius: 19, backgroundColor: studentTab === 'examination' ? '#0D4E35' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
               <Text allowFontScaling={false} numberOfLines={1} style={{ color: studentTab === 'examination' ? '#FFF' : '#8EA496', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4, textAlign: 'center' }}>EXAM</Text>
            </View>
         </Pressable>
         <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onPress={() => setStudentTab('doubts')}>
            <View style={{ width: 88, height: 38, borderRadius: 19, backgroundColor: studentTab === 'doubts' ? '#0D4E35' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
               <Text allowFontScaling={false} numberOfLines={1} style={{ color: studentTab === 'doubts' ? '#FFF' : '#8EA496', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4, textAlign: 'center' }}>DOUBTS</Text>
            </View>
         </Pressable>
      </View>
    </View>
    );
  };

  const renderStaffHome = () => (
    <>
      <View style={styles.heroBranding}>
        <Pressable delayLongPress={7000} onLongPress={openServerOverride}>
          <Text style={styles.heroTitle}>Command Center</Text>
        </Pressable>
        <Text style={styles.heroSubtitle}>Welcome back, {session?.type === 'staff' ? (session.user.full_name || session.user.username) : 'Staff'}</Text>
        <Pressable
          onPress={() => Alert.alert('Logout', 'Are you sure you want to logout?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Logout', style: 'destructive', onPress: handleLogout }
          ])}
          style={{ alignSelf: 'flex-start', marginTop: 12, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 }}
        >
          <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '800' }}>Logout</Text>
        </Pressable>
      </View>

      {isHost ? (
        <SectionCard title="Server URL" subtitle="Set the backend endpoint for this app install.">
          <LabeledInput
            label="Backend URL"
            value={baseUrlDraft}
            onChangeText={setBaseUrlDraft}
            placeholder={getDefaultServerUrl()}
            keyboardType="url"
            autoCapitalize="none"
          />
          <View style={styles.buttonRow}>
            <PrimaryButton title="Save Server URL" onPress={saveBaseUrl} />
            <PrimaryButton title="Use Default URL" onPress={() => setBaseUrlDraft(getDefaultServerUrl())} tone="secondary" />
          </View>
        </SectionCard>
      ) : null}

      {(mobileUpdatePrompt || mobileFeed.length > 0) ? (
        <SectionCard
          title="Server Alerts"
          subtitle={mobileManifestCheckedAt ? `Last checked ${prettyDate(mobileManifestCheckedAt)}. New notices and materials appear here.` : 'Checking the server for updates and fresh notices.'}
          right={mobileUpdatePrompt ? <View style={styles.badge}><Text style={styles.badgeText}>{mobileUpdatePrompt.update_mode === 'apk' ? 'APK UPDATE' : 'STAFF OTA'}</Text></View> : null}
        >
          {mobileUpdatePrompt ? (
            <View style={styles.listBlock}>
              <Text style={styles.metaText}>APP UPDATE AVAILABLE</Text>
              <Text style={styles.rowTitle}>Version {mobileUpdatePrompt.version}</Text>
              <Text style={styles.rowText}>{mobileUpdatePrompt.release_notes?.[0] || (mobileUpdatePrompt.update_mode === 'apk' ? 'The server has a newer app package. Download the latest APK from the website to keep using the app.' : 'The server has a newer staff OTA bundle. Apply it to refresh the app without reinstalling the APK.')}</Text>
              <View style={styles.buttonRow}>
                <PrimaryButton
                  title={mobileUpdatePrompt.update_mode === 'apk' ? 'Download APK' : 'Apply Update'}
                  onPress={handleMobileUpdateAction}
                />
                {!mobileUpdatePrompt.force_update ? (
                  <PrimaryButton title="Later" onPress={() => setMobileUpdatePrompt(null)} tone="secondary" />
                ) : null}
              </View>
            </View>
          ) : null}
          {mobileFeed.slice(0, mobileConfig.home_feed_limit || DEFAULT_MOBILE_CONFIG.home_feed_limit || 4).map((item) => (
            <View key={item.id} style={styles.listBlock}>
              <Text style={styles.metaText}>
                {item.kind === 'material' ? 'NEW MATERIAL' : item.kind === 'alert' ? 'STUDENT ALERT' : 'NOTICE'}
                {item.target_batch ? ` • ${item.target_batch}` : ''}
              </Text>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowText}>{item.body || 'No details provided.'}</Text>
              <Text style={styles.helper}>{prettyDate(item.created_at)}</Text>
            </View>
          ))}
          {!mobileFeed.length ? <Text style={styles.emptyBody}>No fresh notices or materials were found on the server yet.</Text> : null}
          <View style={styles.buttonRow}>
            <PrimaryButton title="Open Inbox" onPress={() => setStaffTab('notifications')} tone="secondary" />
            <PrimaryButton title="Refresh Alerts" onPress={() => { void scheduleManifestRefresh('manual_refresh', 0, true); }} tone="secondary" />
          </View>
        </SectionCard>
      ) : null}

      {currentSession ? (
        <SectionCard 
          title="Active Session" 
          subtitle="Attendance marking is currently live."
          right={<View style={[styles.badge, { backgroundColor: '#DC2626' }]}><Text style={styles.badgeText}>LIVE</Text></View>}
        >
          <View style={styles.posterPanel}>
            <Text style={styles.posterCopy}>{currentSession.session_name} is active for {currentSession.batch_id}.</Text>
            {currentSession.serverSessionId ? <Text style={styles.metaText}>Session ID: {currentSession.serverSessionId}</Text> : null}
          </View>
          <View style={styles.buttonRow}>
            <PrimaryButton title="Scan Student" onPress={() => setAttendanceScannerVisible(true)} tone="success" />
            <PrimaryButton title="Manual Roll" onPress={() => setStaffTab('attendance')} tone="secondary" />
            <PrimaryButton title="Stop Session" onPress={closeAttendanceSession} tone="danger" />
          </View>
        </SectionCard>
      ) : (
        <SectionCard title="Quick Setup" subtitle="Start a new attendance session to begin verification.">
          <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={attendanceBatch} onChange={setAttendanceBatch} />
          <LabeledInput
            label="Session Name"
            value={attendanceSessionName}
            onChangeText={setAttendanceSessionName}
            placeholder="Dropper Morning 21 April"
          />
          <PrimaryButton title="Start Attendance Session" onPress={startAttendanceSession} disabled={!attendanceBatch || !attendanceSessionName.trim()} />
        </SectionCard>
      )}

      <SectionCard title="Institute Overview" subtitle="High-level performance metrics and system load.">
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{staffSummary.totalStudents}</Text><Text style={styles.kpiLabel}>Students</Text></View>
          <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{batches.length}</Text><Text style={styles.kpiLabel}>Batches</Text></View>
          <View style={styles.kpiBlock}>
            <Text numberOfLines={1} style={[styles.kpiValue, { color: staffSummary.unreadLeads > 0 ? '#15803D' : '#64748B' }]}>{staffSummary.unreadLeads}</Text>
            <Text style={styles.kpiLabel}>New Leads</Text>
          </View>
        </View>
        <View style={styles.kpiRow}>
           <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{systemStats?.db_size ? formatBytes(systemStats.db_size) : 'Loading...'}</Text><Text style={styles.kpiLabel}>Cloud Vault</Text></View>
           <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{systemStats?.sms_balance || '...'}</Text><Text style={styles.kpiLabel}>SMS Credits</Text></View>
        </View>
        <View style={styles.buttonRow}>
          <PrimaryButton title="View Detailed Reports" onPress={() => setStaffTab('reports')} tone="secondary" />
          {isTestCloneServer ? <PrimaryButton title="View Fees" onPress={() => setStaffTab('fees')} tone="secondary" /> : null}
          <PrimaryButton title="Manage SMS" onPress={() => setStaffTab('sms')} tone="secondary" />
        </View>
      </SectionCard>

      <SectionCard title="Data Downloads" subtitle="Open the export center for server data, attendance reports, and batch summaries.">
        <Text style={styles.helper}>The Downloads tab includes the full CSV export plus selected batch reports, so you can pull student data, batches, and session records from one place.</Text>
        <View style={styles.buttonRow}>
          <PrimaryButton title="Open Downloads" onPress={() => setStaffTab('reports')} />
          {isTestCloneServer ? <PrimaryButton title="Open Fees" onPress={() => setStaffTab('fees')} tone="secondary" /> : null}
          <PrimaryButton title="Open Library" onPress={() => setStaffTab('materials')} tone="secondary" />
        </View>
      </SectionCard>

      {batchSummary && (
        <SectionCard title={`${attendanceBatch} Trend`} subtitle="Quick snapshot of the latest batch activity.">
          <View style={styles.kpiRow}>
            <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{batchSummary.strength}</Text><Text style={styles.kpiLabel}>Students</Text></View>
            <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{batchHistory.length}</Text><Text style={styles.kpiLabel}>Past Sessions</Text></View>
          </View>
          {batchHistory[0] && (
            <View style={styles.listBlock}>
              <Text style={styles.metaText}>LAST COMPLETED: {batchHistory[batchHistory.length-1].date}</Text>
              <Text style={styles.rowTitle}>{batchHistory[batchHistory.length-1].session_name}</Text>
            <Text style={styles.rowText}>{batchHistory[batchHistory.length-1].present} Present - {batchHistory[batchHistory.length-1].late} Late</Text>
            </View>
          )}
        </SectionCard>
      )}
    </>
  );

  const renderStaffAttendance = () => {
    const hasActiveAttendanceSession = Boolean(currentSession && currentSession.status !== 'closed');
    return (
      <>
      <SectionCard
        title={hasActiveAttendanceSession ? 'Live Attendance' : 'Batch Roster'}
        subtitle={hasActiveAttendanceSession
          ? `Mark students for ${currentSession?.session_name || 'the current session'}.`
          : `Review the roster for ${attendanceBatch || 'the selected batch'} before starting attendance.`}
        right={hasActiveAttendanceSession ? <View style={[styles.badge, { backgroundColor: '#DC2626' }]}><Text style={styles.badgeText}>LIVE</Text></View> : null}
      >
        <PillTabs
          items={batches.map((batch) => ({ key: batch.name, label: batch.name }))}
          value={attendanceBatch}
          onChange={setAttendanceBatch}
        />
        <LabeledInput
          label="Session Name"
          value={attendanceSessionName}
          onChangeText={setAttendanceSessionName}
          placeholder="Dropper Morning 21 April"
        />
        <View style={styles.buttonRow}>
          <PrimaryButton
            title="Start Session"
            onPress={startAttendanceSession}
            disabled={attendanceSessionActionInFlight || !attendanceBatch || hasActiveAttendanceSession || !attendanceSessionName.trim()}
          />
          <PrimaryButton
            title="Late Mode"
            onPress={setLateMode}
            tone="secondary"
            disabled={attendanceSessionActionInFlight || !hasActiveAttendanceSession || currentSession?.is_late === 1}
          />
          <PrimaryButton
            title="Scan Student"
            onPress={() => setAttendanceScannerVisible(true)}
            tone="success"
            disabled={attendanceSessionActionInFlight || !hasActiveAttendanceSession}
          />
          <PrimaryButton
            title="Close Session"
            onPress={closeAttendanceSession}
            tone="danger"
            disabled={attendanceSessionActionInFlight || !hasActiveAttendanceSession}
          />
        </View>
        <Text style={styles.helper}>
          {hasActiveAttendanceSession
            ? 'Use Scan Student to mark attendance for the current session.'
            : 'Batch roster only. Start Session opens the current attendance session for the selected batch.'}
        </Text>
        <FlatList
          data={attendanceDisplayRows}
          keyExtractor={rosterStudentUidKeyExtractor}
          renderItem={renderRosterStudentRow}
          contentContainerStyle={styles.studentListWrap}
          style={styles.attendanceRosterList}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={<Text style={styles.emptyBody}>No roster data yet.</Text>}
        />
      </SectionCard>
    </>
    );
  };

  const renderStaffStudents = () => (
    <>
      <SectionCard title="Students" subtitle="Search the visible student index and tap a row to load the full profile.">
        <LabeledInput label="Search" value={studentSearch} onChangeText={setStudentSearch} placeholder="Search by name, UID, phone, or batch" />
        <PillTabs items={[{ key: '', label: 'All' }, ...batches.map((batch) => ({ key: batch.name, label: batch.name }))]} value={studentBatchFilter} onChange={setStudentBatchFilter} />
      </SectionCard>
      <SectionCard title="Student Directory" subtitle={`${studentDirectoryCount} records loaded, ${filteredStudents.length} visible. Tap a student to open details.`}>
        <FlatList
          data={studentDirectoryPreview}
          keyExtractor={rosterStudentUidKeyExtractor}
          renderItem={renderRosterStudentRow}
          scrollEnabled={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          removeClippedSubviews
          ListEmptyComponent={studentDirectoryCount > 0 ? <Text style={styles.emptyBody}>No students match the current filter. Clear the batch filter to see the full list.</Text> : <Text style={styles.emptyBody}>No student data loaded yet.</Text>}
        />
      </SectionCard>
    </>
  );
  const renderStaffBatches = () => (
    <>
      <SectionCard title="Create Batch" subtitle="Create or edit batches and keep the catalog fresh.">
        <LabeledInput label="New Batch Name" value={newBatchName} onChangeText={setNewBatchName} placeholder="Morning_11th" />
        <LabeledInput label="Description" value={newBatchDescription} onChangeText={setNewBatchDescription} placeholder="Optional details" multiline />
        <PrimaryButton title="Create Batch" onPress={createBatch} />
      </SectionCard>
      {editingBatchId ? (
        <SectionCard title="Edit Batch" subtitle="Save the selected batch changes.">
          <LabeledInput label="Batch Name" value={editingBatchName} onChangeText={setEditingBatchName} placeholder="Batch name" />
          <LabeledInput label="Description" value={editingBatchDescription} onChangeText={setEditingBatchDescription} placeholder="Description" multiline />
          <View style={styles.buttonRow}>
            <PrimaryButton title="Save Changes" onPress={saveBatchEdit} />
            <PrimaryButton title="Cancel" onPress={() => setEditingBatchId(null)} tone="secondary" />
          </View>
        </SectionCard>
      ) : null}
      <SectionCard title="Batch List" subtitle="Tap edit to bring a batch into the editor above.">
        {batches.map((batch) => (
          <View key={batch.id} style={styles.listBlock}>
            <Text style={styles.rowTitle}>{batch.name}</Text>
            <Text style={styles.rowText}>{batch.description || 'No description yet.'}</Text>
            <Text style={styles.metaText}>{prettyDate(batch.created_at)}</Text>
            <View style={styles.buttonRow}>
              <PrimaryButton title="Edit" onPress={() => { setEditingBatchId(batch.id); setEditingBatchName(batch.name); setEditingBatchDescription(batch.description || ''); }} tone="secondary" />
              <PrimaryButton title="Delete" onPress={() => deleteBatch(batch)} tone="danger" />
            </View>
          </View>
        ))}
      </SectionCard>
      {attendanceBatch && batchSummary ? (
        <SectionCard title={`Attendance Trend - ${attendanceBatch}`} subtitle="Recent closed-session history for the selected batch.">
          {batchHistory.length ? batchHistory.map((entry, index) => (
            <View key={`${entry.session_name}-${index}`} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{entry.session_name}</Text>
                <Text style={styles.rowText}>{entry.date}</Text>
              </View>
              <Text style={styles.rowMeta}>{entry.present} P / {entry.late} L / {entry.total} T</Text>
            </View>
          )) : <Text style={styles.emptyBody}>No closed session history yet.</Text>}
        </SectionCard>
      ) : null}
    </>
  );

  const renderStaffMaterials = () => (
    <>
      <SectionCard title="Add Material" subtitle="Upload a file or attach a web link, then assign it to a batch.">
        <LabeledInput label="Title" value={materialTitle} onChangeText={setMaterialTitle} placeholder="Biology Notes 01" />
        <PillTabs items={[{ key: '', label: 'No batch' }, ...batches.map((batch) => ({ key: String(batch.id), label: batch.name }))]} value={materialBatchId} onChange={setMaterialBatchId} />
        <LabeledInput label="Web Link" value={materialLink} onChangeText={setMaterialLink} placeholder="https://..." keyboardType="url" autoCapitalize="none" />
        <PrimaryButton title={materialUpload ? `Picked: ${materialUpload.name}` : 'Pick File'} onPress={pickMaterialFile} tone="secondary" />
        <LabeledInput label="Description" value={materialDescription} onChangeText={setMaterialDescription} placeholder="Optional description" multiline />
        <PrimaryButton title="Save Material" onPress={saveMaterial} />
      </SectionCard>
      <SectionCard title="Saved Materials" subtitle={`${materials.length} materials available.`}>
        {materials.length ? materials.map((material) => (
          <View key={material.id} style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{material.title}</Text>
            </View>
            <View style={styles.inlineActionColumn}>
              <PrimaryButton title="Open" onPress={() => handleMaterialOpen(material)} tone="secondary" />
              <PrimaryButton title="Delete" onPress={() => deleteMaterial(material.id)} tone="danger" />
            </View>
          </View>
        )) : <Text style={styles.emptyBody}>No materials saved yet.</Text>}
      </SectionCard>
    </>
  );

  const renderStaffNotifications = () => (
    <>
      <SectionCard title="Notifications Hub" subtitle="Manage notices, absentee exports, leads, and ID approvals from one place.">
        <PillTabs items={staffNotificationTabs} value={staffNotificationSection} onChange={(value) => setStaffNotificationSection(value as StaffNotificationSection)} />
      </SectionCard>
      {staffNotificationSection === 'notices' ? (
        <>
          <SectionCard title="Create Notice" subtitle="Publish a notice to one batch or all students.">
            <LabeledInput label="Title" value={noticeTitle} onChangeText={setNoticeTitle} placeholder="Holiday schedule" />
            <PillTabs items={[{ key: 'ALL', label: 'All' }, ...batches.map((batch) => ({ key: batch.name, label: batch.name }))]} value={noticeTarget} onChange={setNoticeTarget} />
            <LabeledInput label="Content" value={noticeContent} onChangeText={setNoticeContent} placeholder="Notice details" multiline />
            <PrimaryButton title="Publish Notice" onPress={createNotice} />
          </SectionCard>
          <SectionCard title="Notice Feed" subtitle="Latest published notices.">
            {notices.length ? notices.map((notice) => (
              <View key={notice.id} style={styles.listBlock}>
                <Text style={styles.rowTitle}>{notice.title}</Text>
                <Text style={styles.rowText}>{notice.content}</Text>
              </View>
            )) : <Text style={styles.emptyBody}>No notices published yet.</Text>}
          </SectionCard>
        </>
      ) : null}
      {staffNotificationSection === 'absentees' ? (
        <SectionCard title="Absentee Report" subtitle="Export an Excel-friendly sheet with a message link already prepared for parents.">
          <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={attendanceBatch} onChange={setAttendanceBatch} />
          <PillTabs items={batchHistory.map((entry) => ({ key: String(entry.session_id || entry.date), label: entry.session_name }))} value={selectedAbsenteeSessionId} onChange={setSelectedAbsenteeSessionId} />
          <PrimaryButton title="Export Absentee Report" onPress={exportAbsenteeCsv} tone="secondary" disabled={!selectedAbsenteeSessionId} />
          {attendanceBatch && batchHistory.length ? (
            <View style={styles.listBlock}>
              <Text style={styles.metaText}>LATEST CLOSED SESSION</Text>
              <Text style={styles.rowTitle}>{batchHistory[batchHistory.length - 1].session_name}</Text>
              <Text style={styles.rowText}>{batchHistory[batchHistory.length - 1].present} Present - {batchHistory[batchHistory.length - 1].late} Late - {batchHistory[batchHistory.length - 1].total} Total</Text>
            </View>
          ) : (
            <Text style={styles.emptyBody}>Choose a batch with closed sessions to export its absentee sheet.</Text>
          )}
        </SectionCard>
      ) : null}
      {staffNotificationSection === 'leads' ? (
        <SectionCard title="Leads" subtitle="Recent student inquiries and registration requests.">
          {leads.length ? leads.map((lead) => (
            <View key={lead.id} style={styles.listBlock}>
              <Text style={styles.metaText}>{prettyDate(lead.created_at)} - {lead.is_read ? 'READ' : 'NEW'}</Text>
              <Text style={styles.rowTitle}>{lead.name}</Text>
              <Text style={styles.rowText}>{lead.phone}</Text>
              {lead.email ? <Text style={styles.helper}>{lead.email}</Text> : null}
              {lead.message ? <Text style={styles.helper}>{lead.message}</Text> : null}
              <View style={styles.buttonRow}>
                <PrimaryButton title="Mark Read" onPress={() => markLeadRead(lead.id)} tone="secondary" disabled={Number(lead.is_read) === 1} />
              </View>
            </View>
          )) : <Text style={styles.emptyBody}>No leads have been received yet.</Text>}
        </SectionCard>
      ) : null}
      {staffNotificationSection === 'id_requests' ? (
        <SectionCard title="ID Requests" subtitle="Pending approval requests for digital ID access.">
          {leads.filter((lead) => Number(lead.id_card_allowed || 0) === 0).length ? leads.filter((lead) => Number(lead.id_card_allowed || 0) === 0).map((lead) => (
            <View key={lead.id} style={styles.listBlock}>
              <Text style={styles.metaText}>{prettyDate(lead.created_at)} - PENDING</Text>
              <Text style={styles.rowTitle}>{lead.name}</Text>
              <Text style={styles.rowText}>{lead.phone}</Text>
              {lead.id_card_allowed_by ? <Text style={styles.helper}>Requested by: {lead.id_card_allowed_by}</Text> : null}
              {lead.id_card_allowed_at ? <Text style={styles.helper}>Requested at: {prettyDate(lead.id_card_allowed_at)}</Text> : null}
              <View style={styles.buttonRow}>
                <PrimaryButton title="Approve ID" onPress={() => setLeadApproval(lead.id, true)} tone="success" />
                <PrimaryButton title="Reject" onPress={() => setLeadApproval(lead.id, false)} tone="danger" />
              </View>
            </View>
          )) : <Text style={styles.emptyBody}>No ID requests are pending right now.</Text>}
        </SectionCard>
      ) : null}
    </>
  );

  const renderStaffFees = () => {
    if (!isTestCloneServer) return null;
    const overduePlans = Array.isArray(feeDashboard?.overdue_plans) ? feeDashboard.overdue_plans : [];
    const recentPlans = Array.isArray(feeDashboard?.recent_plans) ? feeDashboard.recent_plans : [];
    const summaryStudent = feeStudentSummary?.student || null;
    const summaryEntries = Object.entries(feeStudentSummary?.summary || {})
      .filter(([, value]) => value !== null && value !== undefined)
      .slice(0, 6)
      .map(([key, value]) => `${key.replace(/_/g, ' ').toUpperCase()}: ${typeof value === 'number' ? formatMoney(value) : String(value)}`);

    return (
      <>
        <SectionCard
          title="Fees Dashboard"
          subtitle="Live fee collections, overdues, and priority rows from the isolated clone."
          right={feeLoading ? <View style={styles.badge}><Text style={styles.badgeText}>SYNCING</Text></View> : null}
        >
          <View style={styles.kpiRow}>
            <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{formatMoney(feeDashboard?.today_collection)}</Text><Text style={styles.kpiLabel}>Today</Text></View>
            <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{formatMoney(feeDashboard?.month_collection)}</Text><Text style={styles.kpiLabel}>Month</Text></View>
            <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{feeDashboard?.active_plan_count ?? '—'}</Text><Text style={styles.kpiLabel}>Active</Text></View>
          </View>
          <View style={styles.kpiRow}>
            <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{feeDashboard?.overdue_count ?? '—'}</Text><Text style={styles.kpiLabel}>Overdue</Text></View>
            <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{feeDashboard?.upcoming_due_count ?? '—'}</Text><Text style={styles.kpiLabel}>Upcoming</Text></View>
            <View style={styles.kpiBlock}><Text numberOfLines={1} style={styles.kpiValue}>{feePriorityRows.length}</Text><Text style={styles.kpiLabel}>Priority</Text></View>
          </View>
          <View style={styles.buttonRow}>
            <PrimaryButton title="Refresh Fees" onPress={() => { void loadFeeWorkspace(); }} tone="secondary" />
            <PrimaryButton title="Export Fee Reports" onPress={() => { void downloadAndOpen('/api/fees/export/reports.csv', 'fees_reports.csv'); }} />
          </View>
          <View style={styles.buttonRow}>
            <PrimaryButton title="Due List CSV" onPress={() => { void downloadAndOpen('/api/fees/export/due-list.csv', 'fees_due_list.csv'); }} tone="secondary" />
            <PrimaryButton title="Collection Register CSV" onPress={() => { void downloadAndOpen('/api/fees/export/collection-register.csv', 'fees_collection_register.csv'); }} tone="secondary" />
          </View>
        </SectionCard>

        <SectionCard title="Student Fee Lookup" subtitle="Open a student's live fee summary and ledger from the clone.">
          <LabeledInput label="Student UID" value={feeStudentUid} onChangeText={setFeeStudentUid} placeholder="STUDENT_UID" autoCapitalize="none" />
          <View style={styles.buttonRow}>
            <PrimaryButton title="Load Summary" onPress={() => { void loadFeeStudentSummary(); }} disabled={!feeStudentUid.trim()} />
            <PrimaryButton
              title="Open Ledger CSV"
              onPress={() => {
                const uid = feeStudentUid.trim();
                if (!uid) return;
                void downloadAndOpen(`/api/fees/students/${encodeURIComponent(uid)}/ledger.csv`, `${uid.replace(/[^a-zA-Z0-9_-]+/g, '_')}_ledger.csv`);
              }}
              tone="secondary"
              disabled={!feeStudentUid.trim()}
            />
          </View>
          {feeStudentSummary?.student ? (
            <View style={styles.listBlock}>
              <Text style={styles.metaText}>STUDENT</Text>
              <Text style={styles.rowTitle}>{feeStudentSummary.student.name || feeStudentSummary.student.student_uid || 'Unknown student'}</Text>
              <Text style={styles.rowText}>{feeStudentSummary.student.student_uid || '-'} • {feeStudentSummary.student.phone || '-'} • {feeStudentSummary.student.batch_name || '-'}</Text>
            </View>
          ) : <Text style={styles.emptyBody}>Load a student UID to view the live fee snapshot.</Text>}
          {summaryEntries.length ? (
            <View style={styles.listBlock}>
              <Text style={styles.metaText}>SUMMARY</Text>
              <Text style={styles.rowText}>{summaryEntries.join(' • ')}</Text>
            </View>
          ) : null}
          {Array.isArray(feeStudentSummary?.plans) && feeStudentSummary.plans.length ? feeStudentSummary.plans.map((plan, index) => (
            <View key={plan.plan_id || plan.id || index} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{plan.batch_name || plan.student_name || plan.student_uid || 'Fee plan'}</Text>
                <Text style={styles.rowText}>{plan.status || 'unknown'} • {plan.plan_mode || '—'} • Due {plan.next_due_date || plan.due_date || '—'}</Text>
              </View>
              <Text style={styles.rowMeta}>{formatMoney(plan.remaining_balance ?? plan.net_amount ?? plan.amount_paid)}</Text>
            </View>
          )) : null}
        </SectionCard>

        <SectionCard title="Create Fee Plan" subtitle="Use the loaded student record to create a new draft fee plan.">
          <Text style={styles.helper}>
            {summaryStudent?.student_uid
              ? `Selected student: ${summaryStudent.name || summaryStudent.student_uid} (${summaryStudent.student_uid})`
              : 'Load a student summary first, then create a draft plan from that student record.'}
          </Text>
          <LabeledInput label="Student UID" value={feeCreateStudentUid} onChangeText={setFeeCreateStudentUid} placeholder="STUDENT_UID" autoCapitalize="none" />
          <LabeledInput label="Batch Name" value={feeCreateBatchName} onChangeText={setFeeCreateBatchName} placeholder="Batch name" />
          <View style={styles.compactGroup}>
            <Text style={styles.helper}>Plan Mode</Text>
            <PillTabs
              items={[
                { key: 'installment', label: 'Installment' },
                { key: 'one_time', label: 'One Time' }
              ]}
              value={feeCreateMode}
              onChange={(next) => setFeeCreateMode(next as FeeCreatePlanMode)}
            />
          </View>
          <View style={styles.rowGroup}>
            <LabeledInput label="Total Amount" value={feeCreateTotalAmount} onChangeText={setFeeCreateTotalAmount} placeholder="30000" keyboardType="numeric" />
            <LabeledInput label="Discount" value={feeCreateDiscountAmount} onChangeText={setFeeCreateDiscountAmount} placeholder="0" keyboardType="numeric" />
          </View>
          <View style={styles.rowGroup}>
            <LabeledInput label="Start Date" value={feeCreateStartDate} onChangeText={setFeeCreateStartDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            <LabeledInput
              label="Installments"
              value={feeCreateInstallmentCount}
              onChangeText={setFeeCreateInstallmentCount}
              placeholder="3"
              keyboardType="numeric"
              editable={feeCreateMode !== 'one_time'}
            />
          </View>
          <View style={styles.buttonRow}>
            <PrimaryButton
              title={feeCreateSubmitting ? 'Creating...' : 'Create Draft Plan'}
              onPress={() => { void createFeePlanForStudent(); }}
              disabled={feeCreateSubmitting || !feeCreateStudentUid.trim()}
            />
            <PrimaryButton
              title="Use Summary Student"
              onPress={() => {
                const nextUid = String(summaryStudent?.student_uid || '').trim();
                if (!nextUid) return;
                setFeeCreateStudentUid(nextUid);
                setFeeCreateBatchName(String(summaryStudent?.batch_name || '').trim());
              }}
              tone="secondary"
              disabled={!summaryStudent?.student_uid}
            />
          </View>
        </SectionCard>

        <SectionCard title="Collection Priority" subtitle="One actionable row per student, sorted by urgency.">
          {feePriorityRows.length ? feePriorityRows.map((row, index) => (
            <View key={`${row.student_uid || index}-${row.plan_id || index}`} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{row.student_name || row.student_uid || 'Unknown student'}</Text>
                <Text style={styles.rowText}>{row.batch_name || '-'} • {row.priority_label || 'priority'}</Text>
              </View>
              <Text style={styles.rowMeta}>{row.next_due_date || '—'} • {formatMoney(row.amount_due)}</Text>
            </View>
          )) : <Text style={styles.emptyBody}>No priority rows returned yet.</Text>}
        </SectionCard>

        <SectionCard title="Overdue Plans" subtitle="Plans that have crossed their due date.">
          {overduePlans.length ? overduePlans.map((plan, index) => (
            <View key={`${plan.plan_id || plan.id || index}`} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{plan.student_name || plan.student_uid || 'Unknown student'}</Text>
                <Text style={styles.rowText}>{plan.batch_name || '-'} • {plan.status || 'overdue'} • {plan.next_due_date || plan.due_date || '—'}</Text>
              </View>
              <Text style={styles.rowMeta}>{formatMoney(plan.remaining_balance ?? plan.net_amount ?? plan.amount_paid)}</Text>
            </View>
          )) : <Text style={styles.emptyBody}>No overdue plans were returned by the server.</Text>}
        </SectionCard>

        {recentPlans.length ? (
          <SectionCard title="Recent Plans" subtitle="Latest fee plans from the live snapshot.">
            {recentPlans.slice(0, 5).map((plan, index) => (
              <View key={`${plan.plan_id || plan.id || index}`} style={styles.rowCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{plan.student_name || plan.student_uid || 'Unknown student'}</Text>
                  <Text style={styles.rowText}>{plan.batch_name || '-'} • {plan.status || '—'} • {plan.plan_mode || '—'}</Text>
                </View>
                <Text style={styles.rowMeta}>{formatMoney(plan.net_amount ?? plan.remaining_balance ?? plan.amount_paid)}</Text>
              </View>
            ))}
          </SectionCard>
        ) : null}
      </>
    );
  };

  const renderStaffReports = () => (
    <>
      <SectionCard title="Downloads" subtitle="Download the master CSV or a selected batch report.">
        <PillTabs
          items={[{ key: 'ALL', label: 'All Batches' }, ...batches.map((batch) => ({ key: batch.name, label: batch.name }))]}
          value={reportBatch}
          onChange={setReportBatch}
        />
        <View style={styles.buttonRow}>
          <PrimaryButton title="Export Full Data" onPress={() => exportCsv()} />
          <PrimaryButton title="Export Selected Batch" onPress={() => exportCsv(reportBatch === 'ALL' ? undefined : reportBatch)} tone="secondary" disabled={reportBatch === 'ALL'} />
          <PrimaryButton title="Refresh Reports" onPress={() => loadReports(reportBatch, true)} tone="secondary" />
        </View>
      </SectionCard>

      {reportBatch !== 'ALL' ? (
        <SectionCard title={`Batch Report - ${reportBatch}`} subtitle="Attendance percentage and batch session data.">
          {reportLoading && !report ? (
            <Text style={styles.emptyBody}>Loading batch report...</Text>
          ) : report ? (
            <>
              <View style={styles.kpiRow}>
                <View style={styles.kpiBlock}>
                  <Text style={styles.kpiValue}>{Array.isArray(report.students) ? report.students.length : 0}</Text>
                  <Text style={styles.kpiLabel}>Students</Text>
                </View>
                <View style={styles.kpiBlock}>
                  <Text style={styles.kpiValue}>{Array.isArray(report.sessions) ? report.sessions.length : 0}</Text>
                  <Text style={styles.kpiLabel}>Sessions</Text>
                </View>
              </View>
              {Array.isArray(report.sessions) && report.sessions.length ? report.sessions.map((sessionRow) => (
                <View key={sessionRow.id} style={styles.listBlock}>
                  <Text style={styles.rowTitle}>{sessionRow.label}</Text>
                </View>
              )) : <Text style={styles.emptyBody}>No session history available for this batch yet.</Text>}
              {Array.isArray(report.students) && report.students.length ? report.students.slice(0, 20).map((student) => (
                <View key={student.student_uid} style={styles.rowCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{student.name}</Text>
                    <Text style={styles.rowText}>{student.student_uid}</Text>
                  </View>
                  <Text style={styles.rowMeta}>{getStudentBatchList(student).join(', ') || student.current_batch || student.batch_name || '-'}</Text>
                </View>
              )) : null}
            </>
          ) : (
            <Text style={styles.emptyBody}>Open a batch report to see its student list and session history.</Text>
          )}
        </SectionCard>
      ) : null}

      {weeklyAlerts.length ? (
        <SectionCard title="Weekly Attendance Alerts" subtitle="Students below 75% attendance in the last 7 days.">
          {weeklyAlerts.map((alert) => (
            <View key={alert.id} style={styles.listBlock}>
              <Text style={styles.metaText}>{alert.batch_id} - {prettyDate(alert.created_at)}</Text>
              <Text style={styles.rowTitle}>{alert.low_count} students below 75%</Text>
              <Text style={styles.rowText}>{alert.summary}</Text>
            </View>
          ))}
        </SectionCard>
      ) : null}

      <SectionCard title="Special Exports" subtitle="Absentee and test report files are saved locally before opening.">
        <View style={styles.buttonRow}>
          <PrimaryButton title="Export Absentees" onPress={exportAbsenteeCsv} tone="secondary" disabled={!selectedAbsenteeSessionId} />
          <PrimaryButton title="Export Test Report" onPress={exportTestReportCsv} tone="secondary" disabled={!testBatch} />
        </View>
      </SectionCard>
    </>
  );

  const renderStaffTests = () => (
    <>
      <SectionCard title="Test Management" subtitle="Create MCQ papers, launch tests instantly, and publish rankings.">
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{testPapers.length}</Text><Text style={styles.kpiLabel}>Saved Papers</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{testLaunches.length}</Text><Text style={styles.kpiLabel}>Launches</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{testSubmissions.length}</Text><Text style={styles.kpiLabel}>Submissions</Text></View>
        </View>
      </SectionCard>
      <SectionCard title="Make Test Paper" subtitle="Build an MCQ paper with automatic grading keys.">
        <LabeledInput label="Test Title" value={testDraftTitle} onChangeText={setTestDraftTitle} placeholder="Weekly Physics Test" />
        <LabeledInput label="Subject" value={testDraftSubject} onChangeText={setTestDraftSubject} placeholder="Physics" />
        <LabeledInput label="Duration (minutes)" value={testDraftDuration} onChangeText={setTestDraftDuration} placeholder="30" keyboardType="numeric" />
        {draftQuestions.map((question, index) => (
          <View key={index} style={styles.questionCard}>
            <Text style={styles.rowTitle}>Question {index + 1}</Text>
            <LabeledInput label="Question Text" value={question.question_text} onChangeText={(value) => updateDraftQuestion(index, (prev) => ({ ...prev, question_text: value }))} placeholder="Enter the MCQ prompt" multiline />
            {(['A', 'B', 'C', 'D'] as const).map((optionKey) => (
              <LabeledInput
                key={optionKey}
                label={`Option ${optionKey}`}
                value={question.options[optionKey]}
                onChangeText={(value) => updateDraftQuestion(index, (prev) => ({ ...prev, options: { ...prev.options, [optionKey]: value } }))}
                placeholder={`Choice ${optionKey}`}
              />
            ))}
            <PillTabs items={[{ key: 'A', label: 'Correct A' }, { key: 'B', label: 'Correct B' }, { key: 'C', label: 'Correct C' }, { key: 'D', label: 'Correct D' }]} value={question.correct_option} onChange={(value) => updateDraftQuestion(index, (prev) => ({ ...prev, correct_option: value as 'A' | 'B' | 'C' | 'D' }))} />
            <PrimaryButton title="Remove Question" onPress={() => removeDraftQuestion(index)} tone="danger" disabled={draftQuestions.length === 1} />
          </View>
        ))}
        <View style={styles.buttonRow}>
          <PrimaryButton title="Add Question" onPress={addDraftQuestion} tone="secondary" />
          <PrimaryButton title="Save Test Paper" onPress={saveTestPaper} />
        </View>
      </SectionCard>
      <SectionCard title="Launch Test" subtitle="Push a saved paper live to a batch instantly.">
        <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={testBatch} onChange={setTestBatch} />
        <PillTabs items={testPapers.map((paper) => ({ key: String(paper.id), label: paper.title }))} value={selectedPaperId} onChange={setSelectedPaperId} />
        <PrimaryButton title="Start Test" onPress={launchSelectedTest} />
      </SectionCard>
      <SectionCard title="Test Results & Analytics" subtitle="Review live launches, publish the scoreboard, and inspect all submissions.">
        <PillTabs items={testLaunches.map((launch) => ({ key: String(launch.id), label: `${launch.title} - ${launch.batch_name}` }))} value={selectedLaunchId} onChange={setSelectedLaunchId} />
        {testLaunches.length ? testLaunches.map((launch) => (
          <View key={launch.id} style={styles.listBlock}>
            <Text style={styles.metaText}>{launch.subject} - {launch.batch_name} - {launch.status.toUpperCase()}</Text>
            <Text style={styles.rowTitle}>{launch.title}</Text>
            <Text style={styles.rowText}>{launch.submission_count} submissions - {prettyDate(launch.starts_at)}</Text>
            <View style={styles.buttonRow}>
              {launch.status !== 'closed' ? <PrimaryButton title="Close Test" onPress={() => closeTestLaunch(launch.id)} tone="danger" /> : null}
              <PrimaryButton title={Number(launch.scoreboard_published) === 1 ? 'Hide Scoreboard' : 'Publish Scoreboard'} onPress={() => setScoreboardPublished(launch.id, Number(launch.scoreboard_published) !== 1)} tone="secondary" />
            </View>
          </View>
        )) : <Text style={styles.emptyBody}>No tests launched yet.</Text>}
        {scoreboardPayload?.scoreboard?.length ? (
          <View style={styles.questionCard}>
            <Text style={styles.sectionTitle}>Leaderboard - {scoreboardPayload.launch.title}</Text>
            {scoreboardPayload.scoreboard.slice(0, 10).map((row) => (
              <View key={`${row.student_uid}-${row.rank}`} style={styles.scoreboardRow}>
                <Text style={styles.scoreboardRank}>{medalForRank(row.rank)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{row.student_name}</Text>
                  <Text style={styles.rowText}>Rank {row.rank}</Text>
                </View>
                <Text style={styles.scoreboardScore}>{row.score}/{row.total_questions}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.questionCard}>
          <Text style={styles.sectionTitle}>All Submissions</Text>
          {testSubmissions.length ? testSubmissions.map((submission) => (
            <View key={submission.id} style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{submission.student_name}</Text>
                <Text style={styles.rowText}>{submission.title} - {submission.batch_name} - {submission.score}/{submission.total_questions}</Text>
              </View>
              <Text style={styles.rowMeta}>{prettyDate(submission.submitted_at)}</Text>
            </View>
          )) : <Text style={styles.emptyBody}>No submissions yet.</Text>}
        </View>
      </SectionCard>
    </>
  );

  const renderStaffAdmin = () => (
    <>
      <SectionCard title="System Stats" subtitle="Host-only database and table overview." right={<PrimaryButton title="Refresh" onPress={loadAdmin} tone="secondary" />}>
        {systemStats ? (
          <>
            <View style={styles.kpiRow}>
              <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{formatBytes(systemStats.db_size)}</Text><Text style={styles.kpiLabel}>DB size</Text></View>
              <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{Math.round(systemStats.uptime / 60)}m</Text><Text style={styles.kpiLabel}>Uptime</Text></View>
              <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{systemStats.tables.length}</Text><Text style={styles.kpiLabel}>Tables</Text></View>
            </View>
            {systemStats.tables.map((table) => (
              <View key={table.table} style={styles.rowCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{table.table}</Text>
                  <Text style={styles.rowText}>{table.rows} rows</Text>
                </View>
                <PrimaryButton title="Drop" onPress={() => dropTable(table.table)} tone="danger" />
              </View>
            ))}
          </>
        ) : <Text style={styles.emptyBody}>Load system stats to inspect host tables.</Text>}
      </SectionCard>
      <SectionCard title="Rename Custom Table" subtitle="Managed tables like batches are protected by the backend.">
        <PillTabs items={(systemStats?.tables || []).map((table) => ({ key: table.table, label: table.table }))} value={renameTableTarget} onChange={setRenameTableTarget} />
        <LabeledInput label="New Table Name" value={renameTableValue} onChangeText={setRenameTableValue} placeholder="new_table_name" autoCapitalize="none" />
        <PrimaryButton title="Rename Table" onPress={renameTable} />
      </SectionCard>
      <SectionCard title="Staff Card Generator" subtitle="Create teacher and staff QR sign-ins.">
        <LabeledInput label="Full Name" value={staffCardForm.full_name} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, full_name: value }))} placeholder="Teacher name" />
        <LabeledInput label="Username" value={staffCardForm.username} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, username: value }))} placeholder="teacher01" autoCapitalize="none" />
        <LabeledInput label="Password" value={staffCardForm.password} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, password: value }))} placeholder="Temporary password" />
        <LabeledInput label="Phone" value={staffCardForm.phone} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, phone: normalizePhoneDigits(value) }))} placeholder="10-digit phone" keyboardType="phone-pad" maxLength={10} />
        <PillTabs items={[{ key: 'teacher', label: 'Teacher' }, { key: 'staff', label: 'Staff' }]} value={staffCardForm.role} onChange={(value) => setStaffCardForm((prev) => ({ ...prev, role: value as 'teacher' | 'staff' }))} />
        <PrimaryButton title="Create Staff Card" onPress={createStaffCard} />
        {createdStaffCard ? (
          <View style={styles.listBlock}>
            <Text style={styles.rowTitle}>{createdStaffCard.full_name || createdStaffCard.username}</Text>
            <Text style={styles.rowText}>{createdStaffCard.role} - {createdStaffCard.username}</Text>
            {createdStaffCard.scan_url ? <Text style={styles.helper}>{createdStaffCard.scan_url}</Text> : null}
            {createdStaffCard.qr_path ? (
              <View style={[styles.photoPanel, { minHeight: 220, marginTop: 4 }]}>
                <Image
                  source={{ uri: makeAbsoluteUrl(baseUrl, createdStaffCard.qr_path || '') }}
                  style={styles.staffQrPreview}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            {createdStaffCard.qr_path ? <PrimaryButton title="Open QR Image" onPress={() => Linking.openURL(makeAbsoluteUrl(baseUrl, createdStaffCard.qr_path || ''))} tone="secondary" /> : null}
          </View>
        ) : null}
      </SectionCard>
      <SectionCard title="System Reset" subtitle="Danger zone: purge all student data and uploaded assets.">
        <PrimaryButton title="Reset Entire System" onPress={resetSystem} tone="danger" />
      </SectionCard>
    </>
  );

  const renderStaffDoubts = () => (
    <>
      <SectionCard title="Doubt Portal" subtitle="Review and reply to student batches doubts.">
        <PillTabs items={[{ key: '', label: 'All' }, ...batches.map((batch) => ({ key: batch.name, label: batch.name }))]} value={doubtBatchFilter} onChange={setDoubtBatchFilter} />
        {staffDoubts.filter(d => !doubtBatchFilter || d.batch_name === doubtBatchFilter).length ? staffDoubts.filter(d => !doubtBatchFilter || d.batch_name === doubtBatchFilter).map((doubt) => (
          <View key={doubt.id} style={styles.listBlock}>
            <Text style={styles.metaText}>{doubt.student_name} - {doubt.batch_name} - {prettyDate(doubt.created_at)}</Text>
            <Text style={styles.rowTitle}>{doubt.question_text}</Text>
            {doubt.question_image ? (
              <PrimaryButton title="View Question Photo" onPress={() => Linking.openURL(makeAbsoluteUrl(baseUrl, doubt.question_image!))} tone="secondary" />
            ) : null}
            
            <View style={styles.divider} />
            
            {doubt.status === 'solved' ? (
              <View style={styles.posterPanel}>
                <Text style={styles.metaText}>SOLVED</Text>
                {doubt.reply_image ? (
                  <PrimaryButton title="View Reply Photo" onPress={() => Linking.openURL(makeAbsoluteUrl(baseUrl, doubt.reply_image!))} tone="secondary" />
                ) : <Text style={styles.posterCopy}>Marked as solved.</Text>}
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <View style={styles.photoPanel}>
                  {doubtReplyPhoto ? <Image source={{ uri: doubtReplyPhoto }} style={styles.photoPreview} /> : <Text style={styles.emptyBody}>Solution photo (required to solve)</Text>}
                </View>
                <View style={styles.buttonRow}>
                  <PrimaryButton title="Camera" onPress={() => pickReplyPhoto('camera')} tone="secondary" />
                  <PrimaryButton title="Gallery" onPress={() => pickReplyPhoto('library')} tone="secondary" />
                </View>
                <View style={styles.buttonRow}>
                  <PrimaryButton title="Mark Solved" onPress={() => updateDoubtStatus(doubt.id, 'solved')} tone="success" disabled={!doubtReplyPhoto} />
                  <PrimaryButton title="Flag" onPress={() => updateDoubtStatus(doubt.id, 'flagged')} tone="danger" />
                </View>
              </View>
            )}
          </View>
        )) : <Text style={styles.emptyBody}>No doubts found in this category.</Text>}
      </SectionCard>
    </>
  );

  const renderStaffCards = () => (
    <SectionCard title="Staff Card Generator" subtitle="Create teacher and staff QR sign-ins.">
      <LabeledInput label="Full Name" value={staffCardForm.full_name} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, full_name: value }))} placeholder="Teacher name" />
      <LabeledInput label="Username" value={staffCardForm.username} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, username: value }))} placeholder="teacher01" autoCapitalize="none" />
      <LabeledInput label="Password" value={staffCardForm.password} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, password: value }))} placeholder="Temporary password" />
      <LabeledInput label="Phone" value={staffCardForm.phone} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, phone: normalizePhoneDigits(value) }))} placeholder="10-digit phone" keyboardType="phone-pad" maxLength={10} />
      <PillTabs items={[{ key: 'teacher', label: 'Teacher' }, { key: 'staff', label: 'Staff' }]} value={staffCardForm.role} onChange={(value) => setStaffCardForm((prev) => ({ ...prev, role: value as 'teacher' | 'staff' }))} />
      <PrimaryButton title="Create Staff Card" onPress={createStaffCard} />
      {createdStaffCard ? (
        <View style={styles.listBlock}>
          <Text style={styles.rowTitle}>{createdStaffCard.full_name || createdStaffCard.username}</Text>
          <Text style={styles.rowText}>{createdStaffCard.role} - {createdStaffCard.username}</Text>
          {createdStaffCard.scan_url ? <Text style={styles.helper}>{createdStaffCard.scan_url}</Text> : null}
          {createdStaffCard.qr_path ? (
            <View style={[styles.photoPanel, { minHeight: 220, marginTop: 4 }]}>
              <Image
                source={{ uri: makeAbsoluteUrl(baseUrl, createdStaffCard.qr_path || '') }}
                style={styles.staffQrPreview}
                resizeMode="contain"
              />
            </View>
          ) : null}
          {createdStaffCard.qr_path ? <PrimaryButton title="Open QR Image" onPress={() => Linking.openURL(makeAbsoluteUrl(baseUrl, createdStaffCard.qr_path || ''))} tone="secondary" /> : null}
        </View>
      ) : null}
    </SectionCard>
  );

  const renderStaffSms = () => {
    const smsPreviewRecipients = smsVisiblePreviewRecipients;
    const smsPreviewSendableCount = smsPreviewRecipients.filter((recipient) => Boolean(recipient.can_send || String(recipient.selected_phone || recipient.recipient_phone || recipient.phone || '').trim())).length;
    const smsBySessionSendDisabled = smsAudience === 'session' && (!smsPreview || !smsPreviewRecipients.length || smsPreviewSendableCount === 0);
    const smsStatusLabel = (status: string) => (status === 'not_updated' ? 'NOT UPDATED' : status.toUpperCase());
    const smsSelectedSession = smsSessionCandidates.find((candidate) => candidate.key === smsSessionId || candidate.sessionKey === smsSessionId) || null;
    const smsPreviewEmptyReason = smsAudience === 'session'
      && smsPreview
      && Array.isArray(smsPreview.recipients)
      && smsPreview.recipients.length > 0
      && !smsPreviewRecipients.length
      && smsStatuses.length
      ? 'No preview rows match the selected status filter.'
      : (smsPreview?.emptyReason || 'No preview rows found.');
    const smsPreviewSummary = [
      `Batch: ${smsBatch || 'None selected'}`,
      smsAudience === 'session' ? `Session: ${smsSelectedSession?.label || 'Select an attendance session.'}` : null,
      `Filters: ${smsStatuses.length ? smsStatuses.map((status) => smsStatusLabel(status)).join(', ') : 'All rows'}`
    ].filter(Boolean).join(' | ');
    return (
      <>
      <SectionCard 
        title="SMS Center" 
        subtitle="Targeted SMS broadcasting with dynamic placeholders like {name} and {uid}."
        right={systemStats?.sms_balance ? <Text style={styles.badgeText}>Balance: {systemStats.sms_balance}</Text> : null}
      >
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{smsAudience === 'session' ? smsVisiblePreviewRecipients.length : (smsPreview?.count || 0)}</Text><Text style={styles.kpiLabel}>Recipients</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{smsAudience === 'session' ? smsVisiblePreviewRecipients.filter((recipient) => !recipient.can_send && !String(recipient.selected_phone || recipient.recipient_phone || recipient.phone || '').trim()).length : (smsPreview?.skipped || 0)}</Text><Text style={styles.kpiLabel}>Skipped</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{smsSending ? '...' : (smsVisiblePreviewRecipients.length ? 'Ready' : 'Draft')}</Text><Text style={styles.kpiLabel}>Status</Text></View>
        </View>

        <View style={styles.smsAudienceLockCard}>
          <Text style={styles.smsAudienceLockTitle}>SMS audience</Text>
          <Text style={styles.smsAudienceLockText}>This screen now defaults to session SMS only.</Text>
          <Text style={styles.smsAudienceLockValue}>By session</Text>
        </View>

        {smsAudience === 'batch' || smsAudience === 'session' ? (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.helper}>Select Batch</Text>
            <PillTabs items={batches.map(b => ({ key: b.name, label: b.name }))} value={smsBatch} onChange={setSmsBatch} />
          </View>
        ) : null}

        {smsAudience === 'session' ? (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.helper}>Select Attendance Session</Text>
            <PillTabs 
              items={smsSessionCandidates.map(candidate => ({ key: candidate.key, label: candidate.label }))} 
              value={smsSessionId} 
              onChange={setSmsSessionId} 
            />
            {!smsSessionCandidates.length ? <Text style={styles.helper}>Choose a batch first. Session history will appear here once it loads.</Text> : null}
          </View>
        ) : null}

        {smsAudience === 'custom' ? (
          <LabeledInput 
            label="Phone Numbers (Comma separated)" 
            value={smsCustomNumbers} 
            onChangeText={setSmsCustomNumbers} 
            placeholder="9876543210, 8877665544"
            keyboardType="phone-pad"
            multiline
          />
        ) : null}

        <View style={{ marginTop: 12 }}>
          <Text style={styles.helper}>Recipient Phone Mode</Text>
          <PillTabs 
            items={[
              { key: 'student', label: 'Student' },
              { key: 'guardian', label: 'Parent / Guardian' }
            ]} 
            value={smsRecipientMode} 
            onChange={(v) => setSmsRecipientMode(v as any)} 
          />
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={styles.helper}>Filter by Status (for Session mode)</Text>
          <View style={styles.pillRow}>
            {['present', 'late', 'not_updated', 'absent'].map(s => (
              <Pressable 
                key={s} 
                style={[styles.miniPill, smsStatuses.includes(s) && styles.miniPillActive]} 
                onPress={() => setSmsStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
              >
                <Text style={[styles.miniPillText, smsStatuses.includes(s) && styles.miniPillTextActive]}>{smsStatusLabel(s)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <LabeledInput 
          label="Message Template" 
          value={smsMessage} 
          onChangeText={setSmsMessage} 
          placeholder="Hello {{name}}, your attendance is {{status}} today."
          multiline
        />
        <Text style={styles.helper}>Auto-fills from the selections above. Supported placeholders: {'{{name}}, {{uid}}, {{batch}}, {{status}}, {{date}}, {{arrival_time}}, {{session_name}}'}</Text>

        <View style={styles.buttonRow}>
          <PrimaryButton title="Refresh Preview" onPress={previewSms} tone="secondary" />
          <PrimaryButton title="Use Suggested Text" onPress={() => { const next = buildSuggestedSmsTemplate(); smsTemplateRef.current = next; setSmsMessage(next); }} tone="secondary" />
          <PrimaryButton
            title="Send SMS Batch"
            onPress={sendSmsBatch}
            disabled={smsSending || !smsMessage.trim() || smsBySessionSendDisabled}
          />
        </View>
        </SectionCard>

      {smsPreview ? (
        <SectionCard
          title="Preview Listing"
          subtitle={smsPreviewRecipients.length
            ? `Review exactly what will be sent to all ${smsPreviewRecipients.length} recipients.`
            : smsPreviewEmptyReason}
        >
          {!smsPreviewRecipients.length ? (
            <View style={styles.listBlock}>
              <Text style={styles.rowTitle}>{smsPreviewEmptyReason}</Text>
              <Text style={styles.rowText}>{smsPreviewSummary}</Text>
            </View>
          ) : null}
          {smsPreviewRecipients.length ? smsPreviewRecipients.map((r, i) => {
            const displayPhone = r.selected_phone || r.recipient_phone || r.phone || 'No phone number';
            const isSent = Boolean(r.sent);
            return (
              <View key={`${String(r.student_uid || i)}:${String(r.selected_phone || r.phone || i)}`} style={styles.smsPreviewRow}>
                <View style={styles.smsPreviewRowTop}>
                  <View style={styles.smsPreviewRowText}>
                    <Text style={styles.rowTitle}>{r.name} ({displayPhone})</Text>
                    <Text style={styles.smsPreviewStatus}>{String(r.status || '').replace(/_/g, ' ').toUpperCase()}</Text>
                    {isSent ? <Text style={styles.helper}>Sent</Text> : null}
                    {!r.can_send ? <Text style={styles.helper}>No phone number</Text> : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      markSmsPreviewRecipientSent(r as SmsPreviewRecipient);
                      void openSmsComposerForRecipient(r as SmsPreviewRecipient);
                    }}
                    disabled={!r.can_send || isSent}
                    style={({ pressed }) => [
                      styles.smsPreviewSendButton,
                      pressed && styles.smsPreviewSendButtonPressed,
                      (!r.can_send || isSent) && styles.buttonDisabled,
                      isSent && styles.smsPreviewSendButtonSent
                    ]}
                  >
                    <Text style={styles.smsPreviewSendButtonText}>{isSent ? 'Sent' : (r.can_send ? 'Send' : 'No phone number')}</Text>
                  </Pressable>
                </View>
                <Text style={styles.rowText}>{r.message}</Text>
              </View>
            );
          }) : null}
        </SectionCard>
      ) : null}
      </>
    );
  };

  const renderStaffWorkspace = () => {
    const activeStaffLabel = staffSidebarItems.find((item) => item.key === staffTab)?.label
      || staffTabs.find((item) => item.key === staffTab)?.label
      || 'Workspace';
    return (
      <View style={styles.staffShell}>
        <View style={styles.staffShellHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation"
            onPress={() => setStaffDrawerOpen((prev) => !prev)}
            style={({ pressed }) => [styles.staffMenuButton, pressed && styles.staffMenuButtonPressed]}
          >
            <Text style={styles.staffMenuText}>Menu</Text>
          </Pressable>
          <View style={styles.staffShellHeaderBody}>
            <Text numberOfLines={1} style={styles.staffShellTitle}>{activeStaffLabel}</Text>
            <Text numberOfLines={1} style={styles.staffShellSubtitle}>Switch sections from the menu.</Text>
          </View>
        </View>
        <ScrollView
          style={styles.staffShellScroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor="#15803D" />}
        >
          {staffTab === 'home' && renderStaffHome()}
          {staffTab === 'attendance' && renderStaffAttendance()}
          {staffTab === 'students' && renderStaffStudents()}
          {staffTab === 'batches' && renderStaffBatches()}
          {staffTab === 'cards' && renderStaffCards()}
          {staffTab === 'materials' && renderStaffMaterials()}
          {staffTab === 'examination' && (
            <ExamSectionHost role="teacher" baseUrl={baseUrl} session={session} onExit={() => setStaffTab('home')} />
          )}
          {staffTab === 'notifications' && renderStaffNotifications()}
          {isTestCloneServer && staffTab === 'fees' && renderStaffFees()}
          {staffTab === 'reports' && renderStaffReports()}
          {staffTab === 'sms' && renderStaffSms()}
          {staffTab === 'doubts' && renderStaffDoubts()}
          {staffTab === 'register' && renderRegister()}
          {staffTab === 'admin' && isHost && renderStaffAdmin()}
        </ScrollView>
        {staffDrawerOpen ? (
          <View style={styles.staffDrawerLayer} pointerEvents="box-none">
            <Pressable style={styles.staffDrawerBackdrop} onPress={() => setStaffDrawerOpen(false)} />
            <View style={styles.staffDrawerPanel}>
              <Text style={styles.staffDrawerTitle}>Workspace</Text>
              <Text style={styles.staffDrawerSubtitle}>Choose a section.</Text>
              <ScrollView style={styles.staffDrawerScroll} contentContainerStyle={styles.staffDrawerList} showsVerticalScrollIndicator={false}>
                {staffSidebarItems.map((item) => {
                  const active = staffTab === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => openStaffSection(item.key)}
                      style={({ pressed }) => [
                        styles.staffDrawerItem,
                        active && styles.staffDrawerItemActive,
                        pressed && styles.staffDrawerItemPressed
                      ]}
                    >
                      <Text style={[styles.staffDrawerItemText, active && styles.staffDrawerItemTextActive]} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const selectedStudentBatchOptions = batches.map((batch) => ({ key: batch.name, label: batch.name }));
  const registrationBatchOptions = (() => {
    const seen = new Set<string>();
    return [...batches, ...publicBatches].filter((batch) => {
      const name = String(batch?.name || '').trim();
      if (!name) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const resolveLocalOrRemoteUri = useCallback((value: string | null | undefined) => {
    const next = String(value || '').trim();
    if (!next) return '';
    if (/^file:\/\//i.test(next)) return next;
    return makeAbsoluteUrl(baseUrl, next);
  }, [baseUrl]);

  const busyOverlayCopy = useMemo(() => {
    const normalized = String(busyMessage || '').trim().toLowerCase();
    if (normalized.includes('downloading staff update')) {
      return {
        headline: 'Downloading staff update',
        detail: 'The OTA bundle is being fetched from the server. Please keep the app open and stay on a stable connection.',
        hint: 'Large updates can take a bit longer on mobile data or weak Wi-Fi.'
      };
    }
    if (normalized.includes('applying staff update')) {
      return {
        headline: 'Applying update',
        detail: 'The update is ready to install. The app will reload automatically when it finishes.',
        hint: 'Do not close the app.'
      };
    }
    if (normalized.includes('checking for staff update')) {
      return {
        headline: 'Checking for update',
        detail: 'The app is verifying whether a newer staff bundle is available.',
        hint: 'This usually takes only a moment.'
      };
    }
    return {
      headline: busyMessage || 'Working',
      detail: 'Please wait while the app finishes the current task.',
      hint: ''
    };
  }, [busyMessage]);

  if (booting) {
    return (
      <SafeAreaView style={styles.root}>
        <ExpoStatusBar style="light" />
        <View style={styles.bootShell}>
          <ActivityIndicator size="large" color="#15803D" />
          <Text style={styles.bootText}>Loading RMC Mobile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ExpoStatusBar style="light" />
      <StatusBar barStyle="light-content" />
      <Modal visible={Boolean(mobileUpdatePrompt && mobileUpdatePrompt.force_update)} transparent animationType="fade" onRequestClose={() => null}>
        <View style={styles.updateOverlay}>
          <View style={styles.updateCard}>
            <View style={styles.updatePillRow}>
              <Text style={styles.badgeText}>{mobileUpdatePrompt?.update_mode === 'apk' ? 'UPDATE REQUIRED' : 'STAFF OTA UPDATE'}</Text>
            </View>
            <Text style={styles.updateTitle}>
              {mobileUpdatePrompt?.update_mode === 'apk'
                ? 'A newer app package is required before continuing.'
                : 'A newer staff OTA update is required before continuing.'}
            </Text>
            <Text style={styles.updateBody}>
              {mobileUpdatePrompt?.update_mode === 'apk'
                ? (mobileUpdatePrompt?.release_notes?.[0] || 'Please download the latest APK from the website and install it to keep using the app.')
                : (mobileUpdatePrompt?.release_notes?.[0] || 'Tap apply to download and activate the staff OTA update without reinstalling the APK.')}
            </Text>
            <Text style={styles.updateMeta}>Latest: {mobileUpdatePrompt?.version || APP_VERSION}</Text>
            <View style={styles.buttonRow}>
              <PrimaryButton title={mobileUpdatePrompt?.update_mode === 'apk' ? 'Download APK' : 'Apply Update'} onPress={handleMobileUpdateAction} />
            </View>
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {session?.type === 'student' ? renderStudentPortal(session.student) : session?.type === 'staff' ? renderStaffWorkspace() : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={styles.tabContainer}>
              <PillTabs items={guestTabs} value={guestTab} onChange={(value) => setGuestTab(value as GuestTab)} />
            </View>
            {guestTab === 'welcome' && renderWelcome()}
            {guestTab === 'student' && renderStudentLogin()}
            {guestTab === 'staff' && renderStaffLogin()}
            {guestTab === 'register' && renderRegister()}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <ScannerModal visible={staffScannerVisible} title="Scan Staff QR" subtitle="Point the camera at a teacher or staff ID card." onClose={() => setStaffScannerVisible(false)} onScan={handleStaffQrLogin} />
      <ScannerModal visible={studentScannerVisible} title="Scan Student QR" subtitle="Point the camera at the student ID card QR." onClose={() => setStudentScannerVisible(false)} onScan={handleStudentQrLogin} />
      <ScannerModal
          visible={attendanceScannerVisible}
          title="Attendance Scanner"
          subtitle="Scan student cards to mark attendance."
          scanMode="manual-window"
          scanWindowMs={2000}
          scanThrottleMs={2000}
          onClose={() => {
            setAttendanceScannerVisible(false);
            setAttendancePreviewStudent(null);
            setAttendanceScanResult(null);
          }}
          onScan={verifyAttendanceQr}
          preview={attendancePreviewStudent ? (
            <View style={styles.attendanceScanPanel}>
              <Text style={styles.sectionTitle}>Scanned Student</Text>
              <Text style={styles.helper}>
                {attendanceScanResult?.detail || 'Attendance marked'}
              </Text>
              <View style={[
                styles.attendanceScanSummary,
                attendanceScanResult?.alreadyMarked ? styles.scanLateBanner : styles.scanPresentBanner
              ]}>
                <View style={styles.attendanceVerifyThumb}>
                  {attendancePreviewStudent.photo_path || attendancePreviewStudent.photo ? (
                    <Image
                      source={{ uri: resolveLocalOrRemoteUri(attendancePreviewStudent.photo_path || attendancePreviewStudent.photo || '') }}
                      style={styles.attendanceVerifyPhoto}
                    />
                  ) : (
                    <View style={styles.attendanceVerifyPhotoFallback}>
                      <Text style={styles.attendanceVerifyPhotoFallbackText}>
                        {(attendancePreviewStudent.name || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.attendanceVerifyBody}>
                  <Text style={styles.scanBannerTitle}>{attendanceScanResult?.statusLabel || 'Present'}</Text>
                  <Text style={styles.scanBannerText}>
                    {attendanceScanResult?.detail || 'Attendance marked'}
                  </Text>
                  <Text style={styles.attendanceToastMeta}>{attendancePreviewStudent.name || 'Student'}</Text>
                  <Text style={styles.attendanceToastMeta}>{attendancePreviewStudent.student_uid || 'UID-N/A'}</Text>
                  <Text style={styles.attendanceToastMeta}>
                    {attendancePreviewStudent.current_batch || attendancePreviewStudent.batch_name || 'Batch N/A'}
                  </Text>
                </View>
              </View>
            </View>
          ) : undefined}
          previewActionLabel="Scan Next"
          onPreviewAction={() => {
            setAttendancePreviewStudent(null);
            setAttendanceScanResult(null);
          }}
        />

      <DetailModal visible={studentModalVisible} title={selectedStudent?.name || 'Student Detail'} onClose={() => setStudentModalVisible(false)}>
        {selectedStudent ? (
          <>
            {lastScannedStudent && lastScannedStudent.student_uid === selectedStudent.student_uid ? (
              <View style={[
                styles.posterPanel,
                lastScannedStudent.attendance_status === 2 ? styles.scanLateBanner : styles.scanPresentBanner
              ]}>
                <Text style={styles.scanBannerTitle}>
                  {lastScannedStudent.attendance_status === 2 ? 'Late' : 'Present'}
                </Text>
                <Text style={styles.scanBannerText}>
                  Attendance marked
                </Text>
              </View>
            ) : null}
            <DigitalIdCard student={selectedStudent} />
            {session?.type === 'staff' ? (
              <View style={styles.buttonRow}>
                <PrimaryButton title="Edit Student Data" onPress={openStudentEditPage} tone="secondary" />
              </View>
            ) : null}
          </>
        ) : null}
      </DetailModal>

      <DetailModal visible={testAttemptVisible} title={activeTestAttempt?.launch.title || 'Test'} onClose={() => { setTestAttemptVisible(false); setActiveTestAttempt(null); }}>
        {activeTestAttempt ? (
          <>
            <Text style={styles.helper}>Placeholders: {'{name}, {uid}, {batch}, {status}, {date}'}</Text>
            {activeTestAttempt.questions.map((question) => (
              <View key={question.id} style={styles.questionCard}>
                <Text style={styles.rowTitle}>Q{question.order}. {question.question_text}</Text>
                <View style={styles.selectionWrap}>
                  {(['A', 'B', 'C', 'D'] as const).map((optionKey) => {
                    const active = testAnswers[question.id] === optionKey;
                    return (
                      <Pressable key={optionKey} onPress={() => setTestAnswers((prev) => ({ ...prev, [question.id]: optionKey }))} style={[styles.selectionChip, active && styles.selectionChipActive, styles.optionChip]}>
                        <Text style={[styles.selectionChipText, active && styles.selectionChipTextActive]}>{optionKey}. {question.options[optionKey]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <PrimaryButton title="Submit Test" onPress={submitStudentTest} />
          </>
        ) : null}
      </DetailModal>

      <DetailModal visible={pastPaperVisible} title={pastPaperPayload?.launch.title || 'Past Paper'} onClose={() => setPastPaperVisible(false)}>
        {pastPaperPayload ? (
          <>
            <Text style={styles.helper}>{pastPaperPayload.launch.subject}</Text>
            {pastPaperPayload.questions.map((question) => (
              <View key={question.id} style={styles.questionCard}>
                <Text style={styles.rowTitle}>Q{question.order}. {question.question_text}</Text>
                <Text style={styles.rowText}>Your answer: {question.selected_option || 'Not answered'}</Text>
                <Text style={styles.rowText}>Correct answer: {question.correct_option}</Text>
                <Text style={[styles.rowMeta, question.is_correct ? styles.answerGood : styles.answerBad]}>{question.is_correct ? 'Correct' : 'Incorrect'}</Text>
              </View>
            ))}
          </>
        ) : null}
      </DetailModal>

      <DetailModal visible={serverOverrideVisible} title="Emergency Server Override" onClose={() => setServerOverrideVisible(false)}>
        <Text style={styles.helper}>Unlocked via 7-second hold. Change this only for emergency recovery.</Text>
        <LabeledInput
          label="Backend URL"
          value={baseUrlDraft}
          onChangeText={setBaseUrlDraft}
          placeholder={getDefaultServerUrl()}
          keyboardType="url"
          autoCapitalize="none"
        />
        <View style={styles.buttonRow}>
          <PrimaryButton title="Use Default" onPress={() => setBaseUrlDraft(getDefaultServerUrl())} tone="secondary" />
          <PrimaryButton title="Test & Save" onPress={saveBaseUrl} />
        </View>
      </DetailModal>

      <Modal visible={!!documentViewer} animationType="slide" onRequestClose={() => setDocumentViewer(null)}>
        <SafeAreaView style={styles.documentViewerRoot}>
          <View style={styles.documentViewerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.documentViewerTitle} numberOfLines={1}>{documentViewer?.title || 'Document Preview'}</Text>
              <Text style={styles.documentViewerMeta} numberOfLines={1}>{documentViewer?.fileName || ''}</Text>
            </View>
            <PrimaryButton title="Close" onPress={() => setDocumentViewer(null)} tone="secondary" />
          </View>
          <View style={styles.documentViewerBody}>
            {documentViewer ? (
              documentViewer.kind === 'pdf' ? (
                <Pdf
                  source={{ uri: documentViewer.localUri, cache: false }}
                  page={documentViewer.initialPage || 1}
                  style={styles.documentViewerPdf}
                  fitPolicy={2}
                  enablePaging={false}
                  enableDoubleTapZoom
                  onPageChanged={(page) => {
                    if (!documentViewer.memoryKey) return;
                    setPdfReadingPositions((prev) => {
                      if (prev[documentViewer.memoryKey!] === page) return prev;
                      const next = { ...prev, [documentViewer.memoryKey!]: page };
                      void persistAppCache({ pdfReadingPositions: next });
                      return next;
                    });
                  }}
                  onError={(error) => {
                    console.warn('PDF render error:', error);
                    Alert.alert('PDF failed', 'Could not open this PDF inside the app.');
                  }}
                  trustAllCerts
                />
              ) : documentViewer.kind === 'image' ? (
                <ScrollView contentContainerStyle={styles.documentViewerImageWrap} maximumZoomScale={3} minimumZoomScale={1}>
                  <Image source={{ uri: documentViewer.localUri }} style={styles.documentViewerImage} resizeMode="contain" />
                </ScrollView>
              ) : (
                <WebView
                  originWhitelist={['*']}
                  source={{ html: documentViewer.html }}
                  style={styles.documentViewerWebView}
                  javaScriptEnabled
                  domStorageEnabled
                  setSupportMultipleWindows={false}
                  startInLoadingState
                />
              )
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>

      {!!busyMessage ? (
        <View style={styles.busyOverlay}>
          <View style={styles.busyPanel}>
            <View style={styles.busyBadge}>
              <Text style={styles.busyBadgeText}>STAFF OTA</Text>
            </View>
            <ActivityIndicator size="large" color="#15803D" />
            <Text style={styles.busyHeadline}>{busyOverlayCopy.headline}</Text>
            <Text style={styles.busyDetail}>{busyOverlayCopy.detail}</Text>
            {busyOverlayCopy.hint ? <Text style={styles.busyHint}>{busyOverlayCopy.hint}</Text> : null}
            {busyProgress !== null ? (
              <View style={styles.busyProgressTrack}>
                <View style={[styles.busyProgressFill, { width: `${busyProgress}%` }]} />
              </View>
            ) : null}
            {busyProgress !== null ? <Text style={styles.busyProgressText}>{busyProgress}%</Text> : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <MainApp />
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F0F9F0' },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 14, gap: 18, paddingBottom: 80 },
  welcomeContent: { flexGrow: 1, padding: 14, paddingBottom: 80, alignItems: 'center', justifyContent: 'center' },
  welcomeStage: { width: '100%', minHeight: '100%', alignItems: 'center', justifyContent: 'center' },
  offlineBanner: { marginHorizontal: 14, marginTop: 10, marginBottom: 0, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, backgroundColor: '#0F172A', flexDirection: 'row', alignItems: 'flex-start', gap: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 14, elevation: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  offlineDot: { width: 10, height: 10, marginTop: 5, borderRadius: 999, backgroundColor: '#FACC15', shadowColor: '#FACC15', shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 },
  offlineBannerTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' },
  offlineBannerText: { color: 'rgba(255,255,255,0.84)', fontSize: 12, lineHeight: 17, marginTop: 3 },
  attendanceToastMeta: { color: 'rgba(226, 232, 240, 0.9)', fontSize: 11, fontWeight: '700', lineHeight: 16 },
  staffShell: { flex: 1, backgroundColor: '#F0F9F0' },
  staffShellHeader: { minHeight: 68, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5EFE7', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  staffMenuButton: { minHeight: 48, minWidth: 96, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EAF4EB', borderWidth: 1, borderColor: '#D7E6D9' },
  staffMenuButtonPressed: { opacity: 0.88 },
  staffMenuIcon: { color: '#14532D', fontSize: 18, fontWeight: '900', lineHeight: 20 },
  staffMenuText: { color: '#14532D', fontSize: 14, fontWeight: '900', letterSpacing: 0.2 },
  staffShellHeaderBody: { flex: 1, minWidth: 0, gap: 2 },
  staffShellTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  staffShellSubtitle: { color: '#475569', fontSize: 13, fontWeight: '700' },
  staffShellScroll: { flex: 1 },
  tabContainer: { marginHorizontal: 2, marginBottom: 16, marginTop: 18 },
  tabsRow: { gap: 8, paddingVertical: 10, paddingHorizontal: 4 },
  tabChip: { minWidth: 96, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 22, backgroundColor: 'rgba(255, 255, 255, 0.9)', alignItems: 'center' },
  tabChipActive: { backgroundColor: '#166534', shadowColor: '#166534', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
  tabChipText: { color: '#475569', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  tabChipTextActive: { color: '#111827' },
  appVersionBar: { alignItems: 'flex-start', marginBottom: 6 },
  appVersionBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(22, 101, 52, 0.12)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  appVersionText: { color: '#166534', fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  heroBranding: { alignItems: 'center', justifyContent: 'center', marginVertical: 0, gap: 4, width: '100%' },
  heroTitle: { color: '#1E293B', fontSize: 42, fontWeight: '900', letterSpacing: -1.5, textAlign: 'center' },
  heroSubtitle: { color: '#22C55E', fontSize: 15, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2.2, textAlign: 'center' },
  section: { borderRadius: 28, padding: 16, backgroundColor: '#FFFFFF', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 5, borderWidth: 1, borderColor: '#ECF2EC' },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 4 },
  sectionTitle: { color: '#0F172A', fontSize: 24, fontWeight: '900', letterSpacing: -0.6, flexShrink: 1 },
  sectionSubtitle: { color: '#475569', fontSize: 15, lineHeight: 22, marginTop: 4 },
  inputGroup: { gap: 12 },
  label: { color: '#166534', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 4 },
  input: { borderRadius: 16, backgroundColor: '#F8FAF8', color: '#1A2B1D', paddingHorizontal: 18, paddingVertical: 14, fontSize: 15, borderWidth: 1, borderColor: '#E2E8E2' },
  inputMultiline: { minHeight: 140, textAlignVertical: 'top' },
  button: { minHeight: 56, borderRadius: 28, paddingHorizontal: 24, paddingVertical: 14, justifyContent: 'center', alignItems: 'center', shadowColor: '#0c4e36', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 8 },
  buttonPrimary: { backgroundColor: '#15803D' },
  buttonSecondary: { backgroundColor: '#E9F1EA', shadowOpacity: 0, elevation: 0 },
  buttonDanger: { backgroundColor: '#CF5C5C' },
  buttonSuccess: { backgroundColor: '#6B8E69' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#111827', fontSize: 14, fontWeight: '800', letterSpacing: 0.3, textAlign: 'center' },
  buttonTextSecondary: { color: '#1A2B1D' },
  helper: { color: '#3E5041', fontSize: 14, lineHeight: 20 },
  helperText: { color: '#3E5041', fontSize: 14, lineHeight: 20, marginLeft: 4, marginTop: -2 },
  compactGroup: { gap: 10 },
  rowGroup: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  dropdownTrigger: { minHeight: 56, borderRadius: 18, backgroundColor: '#F8FAF8', borderWidth: 1, borderColor: '#E2E8E2', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dropdownTriggerText: { color: '#1A2B1D', fontSize: 15, fontWeight: '700', flex: 1 },
  dropdownTriggerPlaceholder: { color: '#8A9B8F', fontWeight: '600' },
  dropdownChevron: { color: '#166534', fontSize: 16, fontWeight: '900' },
  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.38)', justifyContent: 'center', padding: 20 },
  dropdownSheet: { borderRadius: 28, backgroundColor: '#FFFFFF', padding: 18, gap: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  dropdownSheetTitle: { color: '#1A2B1D', fontSize: 20, fontWeight: '900' },
  dropdownOptions: { gap: 10, paddingBottom: 6 },
  dropdownOption: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#F5F8F5', borderWidth: 1, borderColor: '#E2E8E2' },
  dropdownOptionSelected: { backgroundColor: '#E8F5EC', borderColor: '#18A15B' },
  dropdownOptionText: { color: '#1A2B1D', fontSize: 15, fontWeight: '700' },
  dropdownOptionTextSelected: { color: '#0F6B36', fontWeight: '900' },
  dropdownMultiOption: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dropdownCheckbox: { minWidth: 22, color: '#6B7280', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  dropdownCheckboxSelected: { color: '#0F6B36' },
  dropdownFooter: { gap: 10, paddingTop: 4 },
  batchMultiWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  batchMultiChip: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#F8FAF8', borderWidth: 1, borderColor: '#E2E8E2' },
  batchMultiChipSelected: { backgroundColor: '#0D4E35', borderColor: '#0D4E35' },
  batchMultiChipText: { color: '#6B7280', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  batchMultiChipTextSelected: { color: '#FFFFFF' },
  batchMultiHint: { color: '#3E5041', fontSize: 13, lineHeight: 18, marginLeft: 4 },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpiBlock: { flexGrow: 1, flexBasis: '31%', minWidth: 96, borderRadius: 28, padding: 16, backgroundColor: '#FFFFFF', shadowColor: '#0c4e36', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  kpiValue: { color: '#1A2B1D', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  kpiLabel: { color: '#22C55E', marginTop: 6, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  buttonRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  smsAudienceLockCard: { gap: 6, padding: 14, borderRadius: 22, backgroundColor: '#EEF7EF', borderWidth: 1, borderColor: '#D2E8D7' },
  smsAudienceLockTitle: { color: '#166534', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  smsAudienceLockText: { color: '#334155', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  smsAudienceLockValue: { color: '#0F172A', fontSize: 16, fontWeight: '900' },
  staffDrawerLayer: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 80, elevation: 12 },
  staffDrawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.42)' },
  staffDrawerPanel: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '84%', maxWidth: 320, backgroundColor: '#FFFFFF', paddingTop: 18, paddingHorizontal: 16, paddingBottom: 18, borderRightWidth: 1, borderRightColor: '#DCE8DE', shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 6, height: 0 }, elevation: 18, zIndex: 2 },
  staffDrawerTitle: { color: '#0F172A', fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  staffDrawerSubtitle: { color: '#475569', fontSize: 13, fontWeight: '700', marginTop: 4, marginBottom: 14 },
  staffDrawerScroll: { flex: 1 },
  staffDrawerList: { gap: 10, paddingBottom: 8 },
  staffDrawerItem: { minHeight: 50, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', backgroundColor: '#F7FAF7', borderWidth: 1, borderColor: '#E1EAE2' },
  staffDrawerItemPressed: { opacity: 0.9 },
  staffDrawerItemActive: { backgroundColor: '#E8F5EC', borderColor: '#16A34A' },
  staffDrawerItemText: { color: '#1F2937', fontSize: 15, fontWeight: '800' },
  staffDrawerItemTextActive: { color: '#166534' },
  rowCard: { flexDirection: 'row', gap: 10, alignItems: 'center', borderRadius: 28, padding: 14, backgroundColor: '#FFFFFF', shadowColor: '#0c4e36', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12 },
  rowTitle: { color: '#1A2B1D', fontSize: 18, fontWeight: '800' },
  rowText: { color: '#3E5041', fontSize: 14, lineHeight: 21, marginTop: 4 },
  rowMeta: { color: '#22C55E', fontSize: 14, fontWeight: '900' },
  listBlock: { borderRadius: 28, padding: 14, backgroundColor: '#F8FBF8', gap: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  smsPreviewRow: { borderRadius: 24, padding: 14, backgroundColor: '#F8FBF8', gap: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)' },
  smsPreviewRowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' },
  smsPreviewRowText: { flex: 1, gap: 4, paddingRight: 10 },
  smsPreviewStatus: { color: '#166534', fontSize: 12, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  smsPreviewSendButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9F1EA', borderWidth: 1, borderColor: '#D7E6D9' },
  smsPreviewSendButtonSent: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  smsPreviewSendButtonPressed: { opacity: 0.88 },
  smsPreviewSendButtonText: { color: '#14532D', fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  metaText: { color: '#22C55E', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  emptyPanel: { margin: 20, padding: 40, borderRadius: 48, backgroundColor: 'rgba(255, 255, 255, 0.9)', gap: 18, shadowColor: '#0c4e36', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.15, shadowRadius: 25, elevation: 5, alignItems: 'center' },
  emptyTitle: { color: '#1A2B1D', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  emptyBody: { color: '#3E5041', fontSize: 17, lineHeight: 26, textAlign: 'center' },
  photoPanel: { borderRadius: 32, minHeight: 240, backgroundColor: '#E2EDE3', alignItems: 'center', justifyContent: 'center', padding: 20, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.6)', borderStyle: 'dashed' },
  photoPreview: { width: '100%', height: 260, borderRadius: 28 },
  staffQrPreview: { width: 180, height: 180, borderRadius: 20, backgroundColor: '#FFFFFF' },
  inlineActionColumn: { gap: 12, minWidth: 110 },
  modalRoot: { flex: 1, backgroundColor: '#D1E0D4' },
  modalTop: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, flexDirection: 'row', gap: 16, alignItems: 'center', backgroundColor: 'transparent' },
  modalTitle: { color: '#1A2B1D', fontSize: 30, fontWeight: '900' },
  modalSubtitle: { color: '#3E5041', fontSize: 16, marginTop: 8 },
  modalContent: { padding: 16, gap: 28, paddingBottom: 60 },
  cameraShell: { flex: 1, margin: 24, borderRadius: 56, overflow: 'hidden', backgroundColor: '#000' },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(209, 224, 212, 0.3)' },
  cameraFrame: { width: '70%', aspectRatio: 1, borderRadius: 56, borderWidth: 6, borderColor: '#6A4D3B' },
  cameraText: { marginTop: 40, color: '#111827', fontSize: 18, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: {width: 0, height: 2}, textShadowRadius: 10 },
  scannerManualActionWrap: { position: 'absolute', left: 20, right: 20, bottom: 20, zIndex: 4 },
  posterPanel: { padding: 24, borderRadius: 40, backgroundColor: '#E9F1EA' },
  posterCopy: { color: '#1A2B1D', fontSize: 17, lineHeight: 28, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  dividerText: { flex: 1, textAlign: 'center', color: '#6B8E69', fontSize: 14, fontWeight: '800', textTransform: 'uppercase' },
  bootShell: { flex: 1, backgroundColor: '#D1E0D4', alignItems: 'center', justifyContent: 'center', gap: 24 },
  bootText: { color: '#1A2B1D', fontSize: 22, fontWeight: '900' },
  busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(209, 224, 212, 0.96)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, zIndex: 100 },
  busyPanel: { width: '100%', maxWidth: 360, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: 'rgba(21, 128, 61, 0.12)', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 18, elevation: 8 },
  busyBadge: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#E8F5EC', borderWidth: 1, borderColor: '#CDE9D5' },
  busyBadgeText: { color: '#166534', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  busyHeadline: { color: '#1A2B1D', fontSize: 20, fontWeight: '900', textAlign: 'center', letterSpacing: -0.2 },
  busyDetail: { color: '#3E5041', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  busyHint: { color: '#166534', fontSize: 12, lineHeight: 18, textAlign: 'center', fontWeight: '700' },
  busyProgressTrack: { width: '100%', height: 12, borderRadius: 999, backgroundColor: 'rgba(21, 128, 61, 0.12)', overflow: 'hidden' },
  busyProgressFill: { height: '100%', borderRadius: 999, backgroundColor: '#15803D' },
  busyProgressText: { color: '#15803D', fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  updateOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  updateCard: { width: '100%', maxWidth: 420, borderRadius: 28, padding: 24, gap: 14, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, elevation: 14 },
  updatePillRow: { alignSelf: 'flex-start', backgroundColor: '#FDE68A', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  updateTitle: { color: '#0F172A', fontSize: 24, fontWeight: '900', lineHeight: 31 },
  updateBody: { color: '#334155', fontSize: 15, lineHeight: 22 },
  updateMeta: { color: '#166534', fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  detailPhoto: { width: '100%', height: 320, borderRadius: 32, marginBottom: 24 },
  selectionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  selectionChip: { paddingHorizontal: 22, paddingVertical: 18, borderRadius: 32, backgroundColor: 'rgba(255, 255, 255, 0.85)', borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.4)' },
  selectionChipActive: { backgroundColor: '#6A4D3B' },
  selectionChipText: { color: '#3E5041', fontWeight: '800' },
  selectionChipTextActive: { color: '#111827' },
  optionChip: { width: '100%' },
  questionCard: { gap: 16, padding: 22, borderRadius: 28, backgroundColor: '#F1F6F1', borderWidth: 1, borderColor: 'rgba(106, 77, 59, 0.1)' },
  scoreboardRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12 },
  scoreboardRowSelf: { borderRadius: 24, paddingHorizontal: 16, backgroundColor: 'rgba(107, 142, 105, 0.12)' },
  scoreboardRank: { width: 42, fontSize: 22, fontWeight: '900', color: '#6A4D3B', textAlign: 'center' },
  scoreboardScore: { fontSize: 18, fontWeight: '900', color: '#1A2B1D' },
  rankBanner: { padding: 20, borderRadius: 24, backgroundColor: 'rgba(106, 77, 59, 0.08)', gap: 8 },
  rankBannerText: { color: '#1A2B1D', fontSize: 18, fontWeight: '900' },
  answerGood: { color: '#2C7A4B' },
  answerBad: { color: '#B14545' },

  // ID CARD STYLES
  idCardContainer: { width: '100%', marginVertical: 10, paddingBottom: 4, alignItems: 'center', paddingHorizontal: 4 },
  
  quickActionCard: { width: '31%', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, alignItems: 'center', shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2 },
  quickActionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E4EBE5', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  quickActionText: { color: '#111827', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  studentHeaderRow: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, alignItems: 'center', shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2, marginBottom: 24, marginTop: 10 },
  studentAvatarBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0D4E35', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  studentAvatarText: { color: '#FFF', fontSize: 20 },
  studentInfoCol: { flex: 1 },
  studentNameHeader: { color: '#111827', fontSize: 16, fontWeight: '900' },
  studentIdHeader: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  studentQrCard: { borderRadius: 24, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 18, borderWidth: 1, borderColor: '#E5EFE7', shadowColor: '#0c4e36', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 2, gap: 12 },
  studentQrHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  studentQrHeaderTitle: { color: '#0D4E35', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  studentQrHeaderHint: { color: '#6B7280', fontSize: 11, fontWeight: '700' },
  studentQrBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  studentQrImageShell: { width: 92, height: 92, borderRadius: 18, backgroundColor: '#F3F8F4', borderWidth: 1, borderColor: '#D7E5DA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  studentQrImage: { width: '100%', height: '100%' },
  studentQrFallback: { color: '#0D4E35', fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  studentArchiveScroll: { maxHeight: 470, marginBottom: 4 },
  studentArchiveScrollContent: { paddingRight: 2, paddingBottom: 4, gap: 0 },
  attendanceRosterList: { maxHeight: 420 },
  studentBatchPill: { backgroundColor: '#E4EBE5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  studentBatchText: { color: '#0D4E35', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  badge: { backgroundColor: '#0D4E35', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  studentListWrap: { gap: 10 },
  studentListRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 22, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7EEE7', shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2 },
  studentListAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#0D4E35', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  studentListAvatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.6 },
  studentListBody: { flex: 1, minWidth: 0 },
  studentListName: { color: '#111827', fontSize: 15, fontWeight: '900', lineHeight: 20 },
  studentListUid: { color: '#6B7280', fontSize: 12, fontWeight: '700', marginTop: 2 },
  studentListRight: { alignItems: 'flex-end', gap: 6, maxWidth: '45%', flexShrink: 0 },
  studentListBatchPill: { backgroundColor: '#E4EBE5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, maxWidth: '100%' },
  studentListBatchText: { color: '#0D4E35', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  studentListPhone: { color: '#3E5041', fontSize: 11, fontWeight: '700' },
  attendanceStatePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    attendanceStatePending: { backgroundColor: 'rgba(107, 114, 128, 0.14)' },
    attendanceStatePresent: { backgroundColor: 'rgba(34, 197, 94, 0.14)' },
    attendanceStateLate: { backgroundColor: 'rgba(245, 158, 11, 0.16)' },
    attendanceStateAbsent: { backgroundColor: 'rgba(239, 68, 68, 0.14)' },
    attendanceStateText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' },
    lastScanCard: { marginTop: 12, padding: 14, borderRadius: 20, backgroundColor: '#F4FAF5', borderWidth: 1, borderColor: '#DCE8DF', gap: 4 },
    lastScanTitle: { color: '#0D4E35', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6 },
    lastScanName: { color: '#111827', fontSize: 18, fontWeight: '900' },
    lastScanMeta: { color: '#3E5041', fontSize: 12, fontWeight: '700' },
    lastScanPreviewRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 10 },
    lastScanPreviewCopy: { flex: 1, gap: 4, minWidth: 0 },
    lastScanPhoto: { width: 92, height: 118, borderRadius: 16, backgroundColor: '#E2EDE3', borderWidth: 1, borderColor: '#D4E2D7' },
    lastScanPhotoFallback: { width: 92, height: 118, borderRadius: 16, backgroundColor: '#0D4E35', alignItems: 'center', justifyContent: 'center' },
    lastScanPhotoFallbackText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
    attendanceVerifyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    attendanceVerifyThumb: { width: 64, height: 84, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#D7E3D8', backgroundColor: '#EAF2EB' },
    attendanceVerifyPhoto: { width: '100%', height: '100%' },
    attendanceVerifyPhotoFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D4E35' },
    attendanceVerifyPhotoFallbackText: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
    attendanceVerifyBody: { flex: 1, minWidth: 0, gap: 2 },
    scannerPreviewLayout: { flex: 1, paddingBottom: 12 },
    scannerPreviewCameraShell: { flex: 1.1, marginHorizontal: 16, marginTop: 12, marginBottom: 10, borderRadius: 34 },
    scannerPreviewSheet: {
      flex: 0.92,
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 24,
      backgroundColor: '#F7FBF7',
      borderWidth: 1,
      borderColor: '#D7E3D8',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8
    },
    scannerPreviewSheetContent: { padding: 16, gap: 12, paddingBottom: 18 },
    attendanceScanPanel: { gap: 10 },
    attendanceScanSummary: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 14, borderRadius: 20, borderWidth: 1 },
    scanPresentBanner: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
    scanLateBanner: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' },
    scanBannerTitle: { color: '#111827', fontSize: 18, fontWeight: '900' },
    scanBannerText: { color: '#3E5041', fontSize: 13, fontWeight: '700', marginTop: 4 },
    staffHero: { marginBottom: 24, marginTop: 10 },
  staffHeroTitle: { color: '#111827', fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  staffHeroSub: { color: '#6B7280', fontSize: 13, fontWeight: '600', marginTop: 4 },
  staffKpiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 24 },
  staffKpiCard: { width: '48%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2 },
  staffKpiValue: { color: '#0D4E35', fontSize: 24, fontWeight: '900' },
  staffKpiLabel: { color: '#6B7280', fontSize: 11, fontWeight: '800', marginTop: 4, textTransform: 'uppercase' },

  idCardPro: { width: '100%', maxWidth: 298, height: 438, borderRadius: 12, backgroundColor: '#FFFFFF', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.09, shadowRadius: 10, elevation: 7, position: 'relative', backfaceVisibility: 'hidden', borderWidth: 1, borderColor: '#becada', alignSelf: 'center' },
    idCardWatermark: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: 140,
      height: 140,
      opacity: 0.055,
      zIndex: 0,
      transform: [{ translateX: -70 }, { translateY: -70 }]
    },
  idBrandLogo: { width: 34, height: 34, marginRight: 8 },
  idBrandTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', letterSpacing: 0.6 },
  idBrandTagline: { color: 'rgba(255,255,255,0.82)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  backFieldList: { gap: 12, paddingHorizontal: 14, paddingTop: 10 },
  backFieldFull: { gap: 3 },
  backFieldRow: { flexDirection: 'row', gap: 10 },
  backFieldHalf: { flex: 1, gap: 3 },
  backFieldLabel: { color: '#64748B', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  backFieldValueStrong: { color: '#111827', fontSize: 14, fontWeight: '900' },
  backFieldValue: { color: '#111827', fontSize: 12, fontWeight: '800' },
  backFieldCompact: { color: '#111827', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  idFooterStrip: { marginTop: 'auto', paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backFooterUrl: { color: '#475569', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  idFooterTag: { backgroundColor: '#0b4582', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  backFooterTagText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  idBrandBanner: { backgroundColor: '#0f4f90', padding: 10, alignItems: 'center' },
  idWatermark: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.05, justifyContent: 'center', alignItems: 'center' },
  idWatermarkText: { fontSize: 160, fontWeight: '900', color: '#1e293b' },
  idTopBar: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', borderBottomWidth: 1, borderColor: '#bcc8d7', backgroundColor: '#ffffff' },
  idLogoArea: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  idLogomarkWrapper: { gap: 0, flexShrink: 1 },
  idLogomarkBig: { color: '#0b4582', fontSize: 17, fontWeight: '900', lineHeight: 17 },
  idLogomarkSmall: { color: '#0b4582', fontSize: 6.2, fontWeight: '700', letterSpacing: 1.25, marginTop: 1 },
  idType: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 6 },
  idTypeMain: { color: '#475569', fontSize: 7, fontWeight: '800', textAlign: 'right', letterSpacing: 0.4, lineHeight: 9 },
  idTypeYear: { color: '#0b4582', fontSize: 15, fontWeight: '900' },
  idConcept: { alignItems: 'center', paddingTop: 4, paddingBottom: 4, gap: 1 },
  conceptMainText: { color: '#d13239', fontSize: 20, fontWeight: '900', lineHeight: 20 },
  conceptSubText: { color: '#0b4582', fontSize: 9.5, fontWeight: '800' },
  idBatchBox: { backgroundColor: '#dbe5f0', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 7, marginHorizontal: 14, marginBottom: 8 },
  idBatchText: { color: '#b91c1c', fontSize: 11.5, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  idMiddleGrid: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, marginBottom: 8 },
  middleItem: { flex: 1, borderWidth: 1, borderColor: '#b7c4d5', borderRadius: 6, backgroundColor: '#f8fafc', overflow: 'hidden', height: 90, justifyContent: 'center', alignItems: 'center' },
  idQrImage: { width: 62, height: 62 },
  idPhoto: { width: '100%', height: '100%' },
  idDetails: { alignItems: 'center', paddingHorizontal: 14, gap: 2, paddingBottom: 8, paddingTop: 2 },
  idName: { color: '#172036', fontSize: 17, fontWeight: '900', textTransform: 'uppercase' },
  idUid: { color: '#172036', fontSize: 10, fontWeight: '900' },
  idSecondaryRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  idSecondaryText: { color: '#1f2937', fontSize: 9.5, fontWeight: '800' },
  idParent: { color: '#1f2937', fontSize: 9.5, fontWeight: '800', textAlign: 'center' },
  idAddress: { color: '#334155', fontSize: 9.5, fontWeight: '800', textAlign: 'center' },
  idFooterLink: { color: '#4b5563', fontSize: 9, fontWeight: '900', textAlign: 'center', textDecorationLine: 'underline', marginTop: 4, marginBottom: 8 },
  directoryList: { gap: 10 },
  // MINI PILLS (FOR MULTI SELECT)
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  miniPill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: '#F1F6F1', borderWidth: 1, borderColor: '#E2E8E2' },
  miniPillActive: { backgroundColor: '#15803D', borderColor: '#15803D' },
  miniPillText: { color: '#475569', fontSize: 12, fontWeight: '800' },
  miniPillTextActive: { color: '#111827' },
  documentViewerRoot: { flex: 1, backgroundColor: '#E7F1E8' },
  documentViewerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(15, 23, 42, 0.08)', backgroundColor: '#F7FBF7' },
  documentViewerTitle: { color: '#10221a', fontSize: 18, fontWeight: '900' },
  documentViewerMeta: { color: '#5c6b61', fontSize: 12, marginTop: 2 },
  documentViewerBody: { flex: 1, backgroundColor: '#F5F7F5' },
  documentViewerWebView: { flex: 1, backgroundColor: '#F5F7F5' },
  documentViewerPdf: { flex: 1, width: '100%', backgroundColor: '#F5F7F5' },
  documentViewerImageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: '#F5F7F5' },
  documentViewerImage: { width: '100%', height: '100%', minHeight: 360, backgroundColor: '#F5F7F5' }
});
