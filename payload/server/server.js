const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const qrcode = require('qrcode');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
let SQLiteStoreFactory = null;
let MySQLSessionStoreFactory = null;
try {
    SQLiteStoreFactory = require('connect-sqlite3');
} catch (_error) {
    SQLiteStoreFactory = null;
}
try {
    MySQLSessionStoreFactory = require('express-mysql-session')(session);
} catch (_error) {
    MySQLSessionStoreFactory = null;
}
const bcrypt = require('bcrypt');
const multer = require('multer');
const webpush = require('web-push');
let firebaseAdmin = null;
try {
    firebaseAdmin = require('firebase-admin');
} catch (_error) {
    firebaseAdmin = null;
}
require('dotenv').config();
const { createDb, detectDialect, isSafeIdentifier: isSafeIdentifierShared } = require('./db_adapter');
const tenantRuntime = require('./tenant_runtime');
const burstQueue = require('./burst_queue');
const { convertIfpShareLinkToPdf, isConvertibleIfpShareUrl } = require('./ifpshare_pdf_service');

const { promises: fsp } = fs;
const APP_ROOT_DIR = (fs.existsSync(path.join(__dirname, 'views')) && fs.existsSync(path.join(__dirname, 'public')))
    ? __dirname
    : path.join(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_TIMEOUT = Number(process.env.SESSION_TIMEOUT_MS) || 10 * 60 * 1000;
const DEFAULT_DB_FILE = path.join(__dirname, 'rmc_pro_database.db');
const DEFAULT_SESSION_DB_FILE = path.join(__dirname, 'rmc_sessions.db');
const RMC_DATA_DIR = String(process.env.RMC_DATA_DIR || process.env.DATA_DIR || '').trim();
const RESOLVED_DATA_DIR = RMC_DATA_DIR ? path.resolve(RMC_DATA_DIR) : '';
const DB_FILE = process.env.RMC_DB_FILE
    ? path.resolve(String(process.env.RMC_DB_FILE))
    : RESOLVED_DATA_DIR
        ? path.join(RESOLVED_DATA_DIR, 'rmc_pro_database.db')
        : DEFAULT_DB_FILE;
const SESSION_DB_FILE = process.env.SESSION_DB_FILE
    ? path.resolve(String(process.env.SESSION_DB_FILE))
    : RESOLVED_DATA_DIR
        ? path.join(RESOLVED_DATA_DIR, 'rmc_sessions.db')
        : DEFAULT_SESSION_DB_FILE;
const PUBLIC_DIR = path.join(APP_ROOT_DIR, 'public');
const DEFAULT_UPLOAD_FOLDER = path.join(PUBLIC_DIR, 'uploads');
const DEFAULT_QR_FOLDER = path.join(PUBLIC_DIR, 'qrcodes');
const DEFAULT_STAFF_QR_FOLDER = path.join(PUBLIC_DIR, 'staff_qrcodes');
const DEFAULT_MATERIALS_FOLDER = path.join(PUBLIC_DIR, 'materials');
const UPLOAD_FOLDER = RESOLVED_DATA_DIR ? path.join(RESOLVED_DATA_DIR, 'uploads') : DEFAULT_UPLOAD_FOLDER;
  const DOUBT_UPLOAD_FOLDER = path.join(UPLOAD_FOLDER, 'doubts');
  const DOUBT_REPLY_FOLDER = path.join(UPLOAD_FOLDER, 'replies');
  const ATTENDANCE_EXPORT_FOLDER = path.join(UPLOAD_FOLDER, 'attendance_exports');
  const ABSENTEE_MONITOR_TRIGGER_URL = String(process.env.ABSENTEE_MONITOR_TRIGGER_URL || 'http://127.0.0.1:8765/trigger').trim();
  const ABSENTEE_AUTO_SEND_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.ABSENTEE_AUTO_SEND_ENABLED || 'false').trim().toLowerCase());
  const SMS8_API_URL = String(process.env.SMS8_API_URL || 'https://app.sms8.io/services/send.php').trim();
  const SMS8_API_KEY = String(process.env.SMS8_API_KEY || '').trim();
  const SMS8_DEVICE_IDS_RAW = String(process.env.SMS8_DEVICE_IDS || '').trim();
  const SMS8_USE_RANDOM_DEVICE = ['1', 'true', 'yes', 'on'].includes(String(process.env.SMS8_USE_RANDOM_DEVICE || '1').trim().toLowerCase());
  const SMS8_PRIORITY = String(process.env.SMS8_PRIORITY || '0').trim() || '0';
  const SMS8_MESSAGE_TYPE = String(process.env.SMS8_MESSAGE_TYPE || 'sms').trim() || 'sms';
const QR_FOLDER = RESOLVED_DATA_DIR ? path.join(RESOLVED_DATA_DIR, 'qrcodes') : DEFAULT_QR_FOLDER;
const STAFF_QR_FOLDER = RESOLVED_DATA_DIR ? path.join(RESOLVED_DATA_DIR, 'staff_qrcodes') : DEFAULT_STAFF_QR_FOLDER;
const MATERIALS_FOLDER = RESOLVED_DATA_DIR ? path.join(RESOLVED_DATA_DIR, 'materials') : DEFAULT_MATERIALS_FOLDER;
const MOBILE_MANIFEST_FILE = path.join(PUBLIC_DIR, 'mobile_manifest.json');
const MOBILE_UPDATE_BROADCAST_FILE = path.join(PUBLIC_DIR, 'mobile_update_broadcast.json');
const MOBILE_APP_VERSION = String(process.env.MOBILE_APP_VERSION || '1.0.17').trim() || '1.0.17';
const PUBLIC_MOBILE_APK_URL = 'https://pub-45176c50a4064b7ca3a691ba71c61e97.r2.dev/rmc-mobile.apk?v=1.0.17-20260519';
const MOBILE_APK_URL = String(process.env.MOBILE_APK_URL || PUBLIC_MOBILE_APK_URL).trim() || PUBLIC_MOBILE_APK_URL;
const MOBILE_ALERT_CHANNEL_ID = 'rmc_updates';
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const FIREBASE_SERVICE_ACCOUNT_FILE = path.join(__dirname, 'firebase-service-account.json');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PRIVATE_HOST = String(process.env.PRIVATE_HOST || 'login.riteshmathematics.in').trim().toLowerCase();
const PUBLIC_HOST = String(process.env.PUBLIC_HOST || 'login.riteshmathematics.in').trim().toLowerCase();
const DEFAULT_BASE_URL = process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    (process.env.NODE_ENV === 'production' ? `https://${PRIVATE_HOST}` : (process.env.IP_ADDR ? `http://${process.env.IP_ADDR}:${PORT}` : detectBaseUrl()));
const ENFORCE_PRIVATE_ENTRY = process.env.ENFORCE_PRIVATE_ENTRY === 'true';
const STUDENT_REMEMBER_COOKIE = 'rmc.student';
const STUDENT_REMEMBER_MAX_AGE_MS = Number(process.env.STUDENT_REMEMBER_DAYS || 180) * 24 * 60 * 60 * 1000;
const TRUST_PROXY = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').trim().toLowerCase());
const SESSION_COOKIE_DOMAIN = normalizeText(process.env.SESSION_COOKIE_DOMAIN);
const SESSION_COOKIE_SAMESITE_RAW = normalizeText(process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase();
const SESSION_COOKIE_SAMESITE = ['lax', 'strict', 'none'].includes(SESSION_COOKIE_SAMESITE_RAW)
    ? SESSION_COOKIE_SAMESITE_RAW
    : 'lax';
const SESSION_COOKIE_SECURE = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false' && !process.env.ALLOW_INSECURE_SESSION;
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const CORE_TABLES = new Set([
    'users',
    'master_student_index',
    'batches',
    'attendance_sessions',
    'session_students',
    'attendance_records',
    'materials',
    'notices',
    'notifications',
    'staff_alerts',
    'leads',
    'doubts',
    'push_subscriptions',
    'attendance_weekly_reports',
    'test_papers',
    'test_questions',
    'test_launches',
    'test_submissions'
]);
const DB_DIALECT = detectDialect();
const TEST_SYSTEM_ENABLED = true;

// --- Structured Logging System ---
const logger = {
    server: (...args) => console.log('[SERVER]', ...args),
    auth: (...args) => console.log('[AUTH]', ...args),
    db: (...args) => console.log('[DB]', ...args),
    ws: (...args) => console.log('[WS]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => {
        if (process.env.DEBUG === 'true') {
            console.log('[DEBUG]', ...args);
        }
    }
};
const ALLOW_UNSAFE_DEPLOY_STORAGE = ['1', 'true', 'yes'].includes(String(process.env.ALLOW_UNSAFE_DEPLOY_STORAGE || '').trim().toLowerCase());
const MYSQL_HOST_ENV = normalizeText(process.env.MYSQL_HOST || process.env.DB_HOST);
const MYSQL_USER_ENV = normalizeText(process.env.MYSQL_USER || process.env.DB_USER);
const MYSQL_DB_ENV = normalizeText(process.env.MYSQL_DATABASE || process.env.DB_NAME);
const MYSQL_PASSWORD_ENV = String(process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '');
const MYSQL_PORT_ENV = Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306);
const MYSQL_SSL_ENV = normalizeText(process.env.MYSQL_SSL || '').toLowerCase();
const MYSQL_ENV_READY = Boolean(MYSQL_HOST_ENV && MYSQL_USER_ENV && MYSQL_DB_ENV);
const SQLITE_MIGRATION_SOURCE_FILE = path.resolve(String(process.env.SQLITE_MIGRATION_SOURCE_FILE || DB_FILE));
const SQLITE_MIGRATION_STATE_FILE = path.join(path.dirname(DB_FILE), 'mysql_migration_complete.json');
const SQLITE_MIGRATION_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.SQLITE_MIGRATION_ENABLED || 'true').trim().toLowerCase());
const SESSION_STORE_MODE_RAW = normalizeText(process.env.SESSION_STORE).toLowerCase();
const SESSION_STORE_MODE = SESSION_STORE_MODE_RAW || (MYSQL_ENV_READY || DB_DIALECT === 'mysql' ? 'mysql' : 'sqlite');
let sessionStore = undefined;
let sessionStoreLabel = 'MemoryStore';
let sessionStoreReason = 'fallback-default';

if (SESSION_STORE_MODE === 'sqlite') {
    if (SQLiteStoreFactory) {
        const SQLiteStore = SQLiteStoreFactory(session);
        sessionStore = new SQLiteStore({
            db: path.basename(SESSION_DB_FILE),
            dir: path.dirname(SESSION_DB_FILE),
            concurrentDB: true
        });
        sessionStoreLabel = 'SQLiteStore';
        sessionStoreReason = 'SESSION_STORE=sqlite';
    } else {
        console.warn('connect-sqlite3 unavailable. Falling back to in-memory sessions.');
        sessionStoreReason = 'connect-sqlite3-missing';
    }
} else if (SESSION_STORE_MODE === 'mysql') {
    if (!MySQLSessionStoreFactory) {
        console.warn('express-mysql-session unavailable. Falling back to in-memory sessions.');
        sessionStoreReason = 'express-mysql-session-missing';
    } else {
        if (!MYSQL_ENV_READY) {
            console.warn('MySQL session store config missing (MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE). Falling back to in-memory sessions.');
            sessionStoreReason = 'mysql-env-missing';
        } else {
            sessionStore = new MySQLSessionStoreFactory({
                host: MYSQL_HOST_ENV,
                user: MYSQL_USER_ENV,
                password: MYSQL_PASSWORD_ENV,
                database: MYSQL_DB_ENV,
                port: Number.isFinite(MYSQL_PORT_ENV) ? MYSQL_PORT_ENV : 3306,
                ...(MYSQL_SSL_ENV === 'true' || MYSQL_SSL_ENV === '1' ? { ssl: {} } : {}),
                clearExpired: true,
                checkExpirationInterval: 15 * 60 * 1000,
                expiration: SESSION_TIMEOUT
            });
            sessionStoreLabel = 'MySQLStore';
            sessionStoreReason = SESSION_STORE_MODE_RAW ? 'SESSION_STORE=mysql' : 'auto-mysql';
        }
    }
} else if (SESSION_STORE_MODE === 'memory') {
    sessionStoreReason = 'SESSION_STORE=memory';
} else {
    sessionStoreReason = `unknown-session-store-mode:${SESSION_STORE_MODE}`;
}

if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET not set. Using an ephemeral secret for this run.');
}
console.log(`Session store requested: ${SESSION_STORE_MODE}`);
console.log(`Session store: ${sessionStoreLabel} (${sessionStoreReason})`);

if (process.env.NODE_ENV === 'production') {
    if (path.resolve(DB_FILE) === path.resolve(DEFAULT_DB_FILE)) {
        console.warn('Production is using DB in the deploy folder. Set RMC_DATA_DIR or RMC_DB_FILE to avoid data loss on redeploy.');
    }
    if (path.resolve(SESSION_DB_FILE) === path.resolve(DEFAULT_SESSION_DB_FILE)) {
        console.warn('Production is using session DB in the deploy folder. Set RMC_DATA_DIR or SESSION_DB_FILE to avoid losing sessions on redeploy.');
    }
}

let dbClient = null;
let dbInitPromise = null;
let dbInitError = null;
let dbReadyAt = null;
let dbLastInitAttemptAt = 0;
const DB_INIT_RETRY_COOLDOWN_MS = 5000;
const tenantDbClients = new Map();
const tenantDbInitPromises = new Map();

let serverInstance = null;
const liveStreams = new Set();
const leadStreams = new Set();
const staffLiveStreams = new Set();
const studentUpdatePortalTokens = new Map();
const studentEditSessions = new Map();
const doubtNotificationStreams = new Map();
let dbInitStarted = false;

function getCurrentTenantRecord() {
    return tenantRuntime.getActiveTenant() || tenantRuntime.getDefaultTenantRecord();
}

function getCurrentTenantKey() {
    return tenantRuntime.getActiveTenantKey() || tenantRuntime.DEFAULT_TENANT_KEY;
}

function getCurrentTenantStoragePaths() {
    return tenantRuntime.getTenantStoragePaths(getCurrentTenantRecord());
}

function getDefaultTenantStoragePaths() {
    return tenantRuntime.getTenantStoragePaths(tenantRuntime.getDefaultTenantRecord());
}

function getCurrentTenantDbDialect() {
    const tenant = getCurrentTenantRecord();
    return String(tenant?.db?.dialect || DB_DIALECT || 'mysql').toLowerCase() === 'sqlite' ? 'sqlite' : 'mysql';
}

function getAttendanceExportFolder() {
    return getCurrentTenantStoragePaths().attendanceExportsDir;
}

function getTenantDbCacheKey(tenant = null) {
    return tenantRuntime.normalizeTenantKey(tenant?.tenantKey || getCurrentTenantKey());
}

async function withDbClient(client, handler) {
    const previousClient = dbClient;
    dbClient = client;
    try {
        return await handler();
    } finally {
        dbClient = previousClient;
    }
}

async function createTenantDbClient(tenant = getCurrentTenantRecord()) {
    const tenantKey = getTenantDbCacheKey(tenant);
    if (tenantDbClients.has(tenantKey)) {
        return tenantDbClients.get(tenantKey);
    }
    if (tenantDbInitPromises.has(tenantKey)) {
        return tenantDbInitPromises.get(tenantKey);
    }

    const initPromise = (async () => {
        const dbConfig = tenantRuntime.getTenantDbConfig(tenant);
        const client = await createDb({
            dialect: dbConfig.dialect,
            sqliteFile: dbConfig.sqliteFile,
            mysqlConfig: dbConfig.mysqlConfig,
            defaults: { tenantKey, tenant }
        });

        client.__tenantKey = tenantKey;
        client.__schemaInitialized = false;
        tenantDbClients.set(tenantKey, client);
        if (tenantKey === tenantRuntime.DEFAULT_TENANT_KEY) {
            dbClient = client;
        }
        return client;
    })().finally(() => {
        tenantDbInitPromises.delete(tenantKey);
    });

    tenantDbInitPromises.set(tenantKey, initPromise);
    return initPromise;
}

async function ensureTenantDatabaseInitialized(tenant = getCurrentTenantRecord()) {
    const tenantKey = getTenantDbCacheKey(tenant);
    const client = await createTenantDbClient(tenant);
    if (tenantKey === tenantRuntime.DEFAULT_TENANT_KEY && dbClient !== client) {
        dbClient = client;
    }
    if (!client.__schemaInitialized) {
        if (tenantKey === tenantRuntime.DEFAULT_TENANT_KEY) {
            await ensureDbInitialization();
        } else {
            await withDbClient(client, async () => {
                await initDbMysql();
                await ensureSystemUsers();
                await ensureStorageDirectories(tenant);
            });
        }
        client.__schemaInitialized = true;
    }
    return client;
}

function clearRuntimeSessionState() {
    broadcastMessage({
        type: 'system_reset',
        message: 'System reset completed. Refresh the portal to sync the cleared state.'
    });
    broadcastStaffEvent({
        type: 'system_reset',
        message: 'System reset completed. Refresh the staff portal to sync the cleared state.'
    });
}
const materialUpload = multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => cb(null, (req?.tenantStorage || getCurrentTenantStoragePaths()).materialsDir),
        filename: (_req, file, cb) => {
            const safeName = normalizeText(file.originalname).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'file';
            const ext = path.extname(safeName) || '.dat';
            const base = path.basename(safeName, ext);
            cb(null, `${base}_${Date.now()}${ext}`);
        }
    }),
    limits: { fileSize: 30 * 1024 * 1024 } // 30MB cap
});

const doubtUpload = multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => {
            const isReply = String(req.path || '').includes('/reply/');
            const storage = req?.tenantStorage || getCurrentTenantStoragePaths();
            cb(null, isReply ? storage.doubtRepliesDir : storage.doubtsDir);
        },
        filename: (_req, file, cb) => {
            const safeName = normalizeText(file.originalname).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'doubt';
            const ext = path.extname(safeName) || '.png';
            const base = path.basename(safeName, ext);
            cb(null, `${base}_${Date.now()}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 }
});

function handleMaterialUpload(req, res, next) {
    materialUpload.single('file')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }
        if (error instanceof multer.MulterError) {
            const message = error.code === 'LIMIT_FILE_SIZE'
                ? 'File is too large. 30MB maximum.'
                : error.message;
            res.status(400).json({ status: 'error', error: message });
            return;
        }
        res.status(400).json({ status: 'error', error: error.message || 'Upload failed.' });
    });
}

function handleDoubtUpload(req, res, next) {
    doubtUpload.single('image')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }
        if (error instanceof multer.MulterError) {
            const message = error.code === 'LIMIT_FILE_SIZE'
                ? 'Doubt image is too large. 10MB maximum.'
                : error.message;
            res.status(400).json({ status: 'error', error: message });
            return;
        }
        res.status(400).json({ status: 'error', error: error.message || 'Upload failed.' });
    });
}
let pushEnabled = false;
let activeVapidPublicKey = VAPID_PUBLIC_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails('mailto:support@rmc.in', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushEnabled = true;
} else {
    const generated = webpush.generateVAPIDKeys();
    activeVapidPublicKey = generated.publicKey;
    webpush.setVapidDetails('mailto:support@rmc.in', generated.publicKey, generated.privateKey);
    pushEnabled = true;
    console.warn('VAPID keys missing in environment. Generated ephemeral keys for this run only.');
}

validatePersistentStorageConfig();

function detectBaseUrl() {
    const interfaces = os.networkInterfaces();

    for (const group of Object.values(interfaces)) {
        for (const iface of group || []) {
            if (iface && iface.family === 'IPv4' && !iface.internal) {
                return `http://${iface.address}:${PORT}`;
            }
        }
    }

    return `http://localhost:${PORT}`;
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeApprovalPhone(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) {
        return '';
    }
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeApprovalName(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function validatePersistentStorageConfig() {
    if (process.env.NODE_ENV === 'production' && !RESOLVED_DATA_DIR && !ALLOW_UNSAFE_DEPLOY_STORAGE) {
        throw new Error(
            'Unsafe storage configuration: set RMC_DATA_DIR to a persistent path before deploying in production.'
        );
    }
}

function parseCookies(req) {
    const rawCookie = String(req.headers?.cookie || '');
    if (!rawCookie) {
        return {};
    }

    return rawCookie.split(';').reduce((acc, token) => {
        const index = token.indexOf('=');
        if (index < 0) {
            return acc;
        }
        const key = decodeURIComponent(token.slice(0, index).trim());
        const value = decodeURIComponent(token.slice(index + 1).trim());
        acc[key] = value;
        return acc;
    }, {});
}

function setStudentRememberCookie(res, token) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
        return;
    }

    res.cookie(STUDENT_REMEMBER_COOKIE, normalizedToken, {
        httpOnly: true,
        sameSite: SESSION_COOKIE_SAMESITE,
        secure: SESSION_COOKIE_SECURE,
        maxAge: STUDENT_REMEMBER_MAX_AGE_MS,
        path: '/'
    });
}

function clearStudentRememberCookie(res) {
    res.clearCookie(STUDENT_REMEMBER_COOKIE, {
        httpOnly: true,
        sameSite: SESSION_COOKIE_SAMESITE,
        secure: SESSION_COOKIE_SECURE,
        path: '/'
    });
}

function normalizeBatchName(value) {
    return normalizeText(value).replace(/\s+/g, ' ');
}

function sanitizeUploadFilename(value, fallback = 'file') {
    const normalized = normalizeText(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
    return normalized || fallback;
}

function isExternalUrl(value) {
    return /^https?:\/\//i.test(normalizeText(value));
}

function isAbsoluteFilePath(value) {
    const normalized = normalizeText(value);
    return Boolean(normalized) && path.isAbsolute(normalized);
}

async function fileExists(targetPath) {
    try {
        await fsp.access(targetPath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function copyMaterialIntoStorage(sourcePath) {
    const originalName = sanitizeUploadFilename(path.basename(sourcePath), 'material');
    const ext = path.extname(originalName) || '.dat';
    const base = path.basename(originalName, ext) || 'material';
    const storedName = `${base}_${Date.now()}${ext}`;
    const destinationPath = path.join(getCurrentTenantStoragePaths().materialsDir, storedName);
    await fsp.copyFile(sourcePath, destinationPath);
    return `/materials/${storedName}`;
}

function resolveMaterialDiskPath(rawPath) {
    if (!rawPath || !String(rawPath).startsWith('/materials/')) {
        return '';
    }

    const relativePath = String(rawPath).replace(/^\//, '');
    const preferredPath = path.join(getCurrentTenantStoragePaths().materialsDir, path.basename(relativePath));
    if (fs.existsSync(preferredPath)) {
        return preferredPath;
    }

    const legacyPath = path.join(getDefaultTenantStoragePaths().materialsDir, path.basename(relativePath));
    if (fs.existsSync(legacyPath)) {
        return legacyPath;
    }

    return preferredPath;
}

function resolveStoredAssetDiskPath(rawPath) {
    const assetPath = String(rawPath || '').trim();
    if (!assetPath.startsWith('/')) {
        return '';
    }

    const prefixMap = [
        ['/uploads/', getCurrentTenantStoragePaths().uploadsDir, getDefaultTenantStoragePaths().uploadsDir],
        ['/qrcodes/', getCurrentTenantStoragePaths().qrcodesDir, getDefaultTenantStoragePaths().qrcodesDir],
        ['/staff_qrcodes/', getCurrentTenantStoragePaths().staffQrCodesDir, getDefaultTenantStoragePaths().staffQrCodesDir],
        ['/materials/', getCurrentTenantStoragePaths().materialsDir, getDefaultTenantStoragePaths().materialsDir]
    ];

    for (const [prefix, primaryDir, legacyDir] of prefixMap) {
        if (!assetPath.startsWith(prefix)) {
            continue;
        }

        const fileName = path.basename(assetPath);
        const primaryPath = path.join(primaryDir, fileName);
        if (fs.existsSync(primaryPath)) {
            return primaryPath;
        }

        const legacyPath = path.join(legacyDir, fileName);
        if (fs.existsSync(legacyPath)) {
            return legacyPath;
        }

        return primaryPath;
    }

    return '';
}


function splitBatchNames(value) {
    return [...new Set(
        String(value ?? '')
            .split(',')
            .map((item) => normalizeBatchName(item))
            .filter(Boolean)
    )];
}

function getRequestHost(req) {
    return String(req.headers.host || '')
        .split(':')[0]
        .trim()
        .toLowerCase();
}

function isPrivateHostRequest(req) {
    const host = getRequestHost(req);
    return host === PRIVATE_HOST;
}

function getPrivateBaseUrl(req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    return `${proto}://${PRIVATE_HOST}`;
}

function joinBatchNames(values) {
    return splitBatchNames(Array.isArray(values) ? values.join(',') : values).join(', ');
}

function getStudentSessionBatches(studentSession) {
    if (!studentSession) {
        logger.debug('getStudentSessionBatches: No studentSession provided.');
        return [];
    }

    let batches = [];
    if (Array.isArray(studentSession.batches) && studentSession.batches.length > 0) {
        batches = splitBatchNames(studentSession.batches.join(','));
    } else {
        batches = splitBatchNames(
            studentSession.batches
            || studentSession.current_batch
            || studentSession.batch_name
            || ''
        );
    }
    console.log(`[DEBUG] getStudentSessionBatches for ${studentSession.student_uid}:`, batches);
    return batches;
}

async function getStudentSessionBatchesResolved(studentSession) {
    const sessionBatches = getStudentSessionBatches(studentSession);
    if (sessionBatches.length > 0) {
        return sessionBatches;
    }

    const studentUid = normalizeText(studentSession?.student_uid);
    if (!studentUid) {
        return [];
    }

    const indexRow = await getAsync(
        'SELECT batch_name FROM master_student_index WHERE student_uid = ? LIMIT 1',
        [studentUid]
    );
    return splitBatchNames(indexRow?.batch_name);
}

function sanitizeForTableName(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'general';
}

function getBatchTableName(batchName) {
    return `batch_${sanitizeForTableName(batchName)}_students`;
}

function isSafeIdentifier(identifier) {
    return isSafeIdentifierShared(identifier);
}

function quoteIdentifier(identifier) {
    if (!dbClient) {
        throw new Error('Database not initialized.');
    }
    return dbClient.quoteIdentifier(identifier);
}

async function getActiveDbClient() {
    const tenant = getCurrentTenantRecord();
    if (dbClient && tenantDbClients.get(getTenantDbCacheKey(tenant)) === dbClient) {
        return dbClient;
    }
    return ensureTenantDatabaseInitialized(tenant);
}

async function runAsync(sql, params = []) {
    const client = await getActiveDbClient();
    return client.run(sql, params);
}

async function getAsync(sql, params = []) {
    const client = await getActiveDbClient();
    return client.get(sql, params);
}

async function allAsync(sql, params = []) {
    const client = await getActiveDbClient();
    return client.all(sql, params);
}

function isDatabaseReady() {
    return Boolean(dbClient && (dbClient.__schemaInitialized || dbReadyAt));
}

function getDatabaseStatus() {
    if (isDatabaseReady()) {
        return 'ready';
    }
    if (dbInitError) {
        return 'error';
    }
    if (dbInitPromise || dbInitStarted) {
        return 'starting';
    }
    return 'idle';
}

function ensureDbInitialization() {
    if (isDatabaseReady()) {
        return Promise.resolve(dbClient);
    }
    if (dbInitPromise) {
        return dbInitPromise;
    }
    if (dbInitError && Date.now() - dbLastInitAttemptAt < DB_INIT_RETRY_COOLDOWN_MS) {
        return Promise.reject(dbInitError);
    }

    dbInitStarted = true;
    dbInitError = null;
    dbLastInitAttemptAt = Date.now();
    console.log(`Database initialization started (${DB_DIALECT}).`);

    dbInitPromise = initDb()
        .then(() => {
            dbReadyAt = new Date().toISOString();
            console.log('Database initialization complete.');
            return dbClient;
        })
        .catch((error) => {
            dbInitPromise = null;
            dbInitStarted = false;
            dbInitError = error;
            console.error('Database initialization failed:', error);
            throw error;
        });

    return dbInitPromise;
}

async function waitForDatabaseReady(timeoutMs = 15000) {
    if (isDatabaseReady()) {
        return true;
    }
    if (dbInitError) {
        return false;
    }

    const initPromise = ensureDbInitialization().catch(() => null);
    const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
    });

    await Promise.race([initPromise, timeoutPromise]);
    return isDatabaseReady();
}

async function ensureAttendanceRecordsSchema() {
    if (DB_DIALECT !== 'sqlite') {
        return;
    }
    const exists = await tableExists('attendance_records');
    if (!exists) {
        return;
    }

    const columns = await allAsync('PRAGMA table_info("attendance_records")');
    const foreignKeys = await allAsync('PRAGMA foreign_key_list("attendance_records")');
    const indexes = await allAsync('PRAGMA index_list("attendance_records")');
    const statusColumn = columns.find((column) => column.name === 'status');
    const hasLegacyStudentForeignKey = foreignKeys.some(
        (fk) => fk.from === 'student_uid' && fk.table === 'students'
    );
    const usesLegacyStatusType = Boolean(
        statusColumn && String(statusColumn.type || '').toUpperCase() !== 'INTEGER'
    );
    let hasUniqueSessionStudentKey = false;
    for (const index of indexes) {
        if (!index.unique) {
            continue;
        }
        const indexColumns = await allAsync(`PRAGMA index_info("${index.name}")`);
        const names = indexColumns.map((column) => column.name);
        if (names.length === 2 && names.includes('session_id') && names.includes('student_uid')) {
            hasUniqueSessionStudentKey = true;
            break;
        }
    }

    if (!hasLegacyStudentForeignKey && !usesLegacyStatusType && hasUniqueSessionStudentKey) {
        return;
    }

    console.warn('Migrating legacy attendance_records schema to the current format.');

    await beginTransaction();
    try {
        await runAsync('ALTER TABLE attendance_records RENAME TO attendance_records_legacy');
        await runAsync(`
            CREATE TABLE attendance_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                student_uid TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status INTEGER DEFAULT 1,
                mark_key TEXT,
                local_session_id TEXT,
                client_device_id TEXT,
                UNIQUE(session_id, student_uid),
                FOREIGN KEY(session_id) REFERENCES attendance_sessions(id)
            )
        `);

        await runAsync(`
            INSERT INTO attendance_records (id, session_id, student_uid, timestamp, status, mark_key, local_session_id, client_device_id)
            SELECT
                id,
                session_id,
                student_uid,
                MAX(COALESCE(timestamp, CURRENT_TIMESTAMP)),
                CASE
                    WHEN MAX(CASE WHEN LOWER(CAST(status AS TEXT)) IN ('2', 'late') THEN 2 ELSE 1 END) = 2 THEN 2
                    ELSE 1
                END,
                'server:' || session_id || ':' || student_uid,
                NULL,
                NULL
            FROM attendance_records_legacy
            WHERE session_id IS NOT NULL
              AND student_uid IS NOT NULL
              AND TRIM(student_uid) != ''
              AND EXISTS (
                    SELECT 1
                    FROM attendance_sessions
                    WHERE attendance_sessions.id = attendance_records_legacy.session_id
              )
            GROUP BY session_id, student_uid
        `);

        await runAsync('DROP TABLE attendance_records_legacy');
        await commitTransaction();
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }
}

function buildAttendanceMarkKey(sessionId, studentUid) {
    return `server:${Number(sessionId)}:${normalizeText(studentUid)}`;
}

function normalizeReplayStatus(value) {
    const raw = normalizeText(value).toLowerCase();
    if (raw === 'late' || raw === '2') return 'late';
    if (raw === 'absent' || raw === '0') return 'absent';
    if (raw === 'present' || raw === '1' || raw === '') return 'present';
    return null;
}

function replayStatusToAttendanceCode(value) {
    if (value === 'late') return 2;
    if (value === 'absent') return 0;
    return 1;
}

function attendanceCodeToReplayStatus(value) {
    if (Number(value) === 2) return 'late';
    if (Number(value) === 0) return 'absent';
    return 'present';
}

async function getAttendanceRecordByMarkKey(markKey) {
    const normalizedMarkKey = normalizeText(markKey);
    if (!normalizedMarkKey) {
        return null;
    }
    return getAsync(
        `SELECT * FROM attendance_records
         WHERE mark_key = ?
         LIMIT 1`,
        [normalizedMarkKey]
    );
}

async function getAttendanceRecordBySessionStudent(sessionId, studentUid) {
    return getAsync(
        `SELECT * FROM attendance_records
         WHERE session_id = ? AND student_uid = ?
         LIMIT 1`,
        [Number(sessionId), normalizeText(studentUid)]
    );
}

async function getAttendanceSessionAlias(localSessionId, clientDeviceId) {
    const normalizedLocalSessionId = normalizeText(localSessionId);
    const normalizedClientDeviceId = normalizeText(clientDeviceId);
    if (!normalizedLocalSessionId || !normalizedClientDeviceId) {
        return null;
    }
    return getAsync(
        `SELECT * FROM attendance_session_aliases
         WHERE local_session_id = ? AND client_device_id = ?
         LIMIT 1`,
        [normalizedLocalSessionId, normalizedClientDeviceId]
    );
}

async function upsertAttendanceSessionAlias(payload) {
    const localSessionId = normalizeText(payload?.localSessionId);
    const clientDeviceId = normalizeText(payload?.clientDeviceId);
    if (!localSessionId || !clientDeviceId) {
        throw new Error('local_session_id and client_device_id are required.');
    }

    const values = [
        localSessionId,
        clientDeviceId,
        Number.isFinite(Number(payload?.serverSessionId)) ? Number(payload.serverSessionId) : null,
        normalizeText(payload?.batchId || ''),
        normalizeText(payload?.batchName || ''),
        normalizeText(payload?.sessionName || ''),
        normalizeText(payload?.localCreatedAt || ''),
        normalizeText(payload?.syncedAt || new Date().toISOString())
    ];

    if (DB_DIALECT === 'mysql') {
        await runAsync(
            `
            INSERT INTO attendance_session_aliases (
                local_session_id, client_device_id, server_session_id, batch_id, batch_name, session_name, local_created_at, synced_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
                server_session_id = VALUES(server_session_id),
                batch_id = VALUES(batch_id),
                batch_name = VALUES(batch_name),
                session_name = VALUES(session_name),
                local_created_at = VALUES(local_created_at),
                synced_at = VALUES(synced_at),
                updated_at = CURRENT_TIMESTAMP
            `,
            values
        );
        return getAttendanceSessionAlias(localSessionId, clientDeviceId);
    }

    await runAsync(
        `
        INSERT INTO attendance_session_aliases (
            local_session_id, client_device_id, server_session_id, batch_id, batch_name, session_name, local_created_at, synced_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(local_session_id, client_device_id) DO UPDATE SET
            server_session_id = excluded.server_session_id,
            batch_id = excluded.batch_id,
            batch_name = excluded.batch_name,
            session_name = excluded.session_name,
            local_created_at = excluded.local_created_at,
            synced_at = excluded.synced_at,
            updated_at = CURRENT_TIMESTAMP
        `,
        values
    );
    return getAttendanceSessionAlias(localSessionId, clientDeviceId);
}

async function findReusableActiveAttendanceSession(batchId, sessionName) {
    const normalizedBatchId = normalizeBatchName(batchId);
    const normalizedSessionName = normalizeText(sessionName) || 'Attendance Session';
    if (!normalizedBatchId) {
        return null;
    }
    return getAsync(
        `SELECT * FROM attendance_sessions
         WHERE status = 'active'
           AND batch_id = ?
           AND LOWER(TRIM(COALESCE(session_name, ''))) = LOWER(TRIM(?))
         ORDER BY start_time DESC
         LIMIT 1`,
        [normalizedBatchId, normalizedSessionName]
    );
}

async function insertAttendanceSessionFromBatch(batchName, sessionName, createdBy) {
    const normalizedBatchName = normalizeBatchName(batchName);
    if (!normalizedBatchName) {
        throw new Error('A valid batch is required to start a session.');
    }

    const now = new Date();
    const columnName = `att_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}_${String(now.getMinutes()).padStart(2, '0')}`;
    const batchTableName = await createBatchTable(normalizedBatchName);
    const result = await runAsync(
        `INSERT INTO attendance_sessions (session_name, batch_id, created_by, column_name)
         VALUES (?, ?, ?, ?)`,
        [normalizeText(sessionName) || 'Attendance Session', normalizedBatchName, createdBy || null, columnName]
    );

    await runAsync(
        `INSERT INTO session_students
         (session_id, student_uid, name, phone, father_name, guardian_phone, address, student_class, aspiration, current_batch, photo_path, qr_path, secure_token)
         SELECT ?, student_uid, name, phone, father_name, guardian_phone, address, student_class, aspiration, current_batch, photo_path, qr_path, secure_token
         FROM ${quoteIdentifier(batchTableName)}`,
        [result.lastID]
    );

    return {
        session_id: result.lastID,
        session_name: normalizeText(sessionName) || 'Attendance Session',
        batch_id: normalizedBatchName,
        column_name: columnName,
        batch_table_name: batchTableName
    };
}

async function ensureOfflineReplaySchema() {
    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_session_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            local_session_id TEXT NOT NULL,
            client_device_id TEXT NOT NULL,
            server_session_id INTEGER,
            batch_id TEXT,
            batch_name TEXT,
            session_name TEXT,
            local_created_at TEXT,
            synced_at TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(local_session_id, client_device_id)
        )
    `);
    await runAsync('CREATE INDEX IF NOT EXISTS idx_attendance_session_aliases_server ON attendance_session_aliases(server_session_id)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_attendance_session_aliases_batch ON attendance_session_aliases(batch_id, session_name)');

    await ensureColumn('attendance_records', 'mark_key', DB_DIALECT === 'mysql' ? 'VARCHAR(255)' : 'TEXT');
    await ensureColumn('attendance_records', 'local_session_id', DB_DIALECT === 'mysql' ? 'VARCHAR(255)' : 'TEXT');
    await ensureColumn('attendance_records', 'client_device_id', DB_DIALECT === 'mysql' ? 'VARCHAR(255)' : 'TEXT');

    if (DB_DIALECT === 'sqlite') {
        await runAsync('CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_records_mark_key_unique ON attendance_records(mark_key)');
        await runAsync('CREATE INDEX IF NOT EXISTS idx_attendance_records_local_session ON attendance_records(local_session_id, client_device_id)');
        await runAsync(`
            UPDATE attendance_records
            SET mark_key = 'server:' || session_id || ':' || student_uid
            WHERE mark_key IS NULL OR TRIM(mark_key) = ''
        `);
    } else {
        await createMysqlIndex('CREATE UNIQUE INDEX idx_attendance_records_mark_key_unique ON attendance_records(mark_key)');
        await createMysqlIndex('CREATE INDEX idx_attendance_records_local_session ON attendance_records(local_session_id, client_device_id)');
        await runAsync(`
            UPDATE attendance_records
            SET mark_key = CONCAT('server:', session_id, ':', student_uid)
            WHERE mark_key IS NULL OR TRIM(mark_key) = ''
        `);
    }
}

const tableExistsCache = new Map();

function getTableExistsCacheKey(tableName, tenantKey = getCurrentTenantKey()) {
    return `${tenantRuntime.normalizeTenantKey(tenantKey)}:${normalizeText(tableName)}`;
}

function clearTableExistsCache(tableName, tenantKey = getCurrentTenantKey()) {
    tableExistsCache.delete(getTableExistsCacheKey(tableName, tenantKey));
}

async function tableExists(tableName) {
    const client = await getActiveDbClient();
    if (!client) {
        return false;
    }

    const cacheKey = getTableExistsCacheKey(tableName);
    if (tableExistsCache.has(cacheKey)) {
        return tableExistsCache.get(cacheKey);
    }

    const exists = await client.tableExists(tableName);
    tableExistsCache.set(cacheKey, exists);
    return exists;
}

async function ensureColumn(tableName, columnName, definition) {
    const client = await getActiveDbClient();
    if (!client) {
        throw new Error('Database not initialized.');
    }
    return client.ensureColumn(tableName, columnName, definition);
}

async function ensureMobilePushTokenProviderColumn() {
    clearTableExistsCache('mobile_push_tokens');
    if (!(await tableExists('mobile_push_tokens'))) {
        return;
    }

    const tenantDialect = getCurrentTenantDbDialect();
    const columns = tenantDialect === 'mysql'
        ? await allAsync(
            `SELECT COLUMN_NAME AS name
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ?
               AND TABLE_NAME = 'mobile_push_tokens'`,
            [MYSQL_DB_ENV || '']
        )
        : await allAsync('PRAGMA table_info("mobile_push_tokens")');
    const hasProviderColumn = Array.isArray(columns) && columns.some((column) => normalizeText(column.name) === 'push_provider');
    if (hasProviderColumn) {
        return;
    }

    if (tenantDialect === 'mysql') {
        await runAsync('ALTER TABLE mobile_push_tokens ADD COLUMN push_provider VARCHAR(32) NOT NULL DEFAULT \'expo\' AFTER token');
    } else {
        await runAsync('ALTER TABLE mobile_push_tokens ADD COLUMN push_provider TEXT NOT NULL DEFAULT \'expo\'');
    }
}

function generateLoginToken(name, phone, fatherName) {
    const payload = [
        normalizeText(name).toLowerCase(),
        normalizeText(phone),
        normalizeText(fatherName).toLowerCase()
    ].join('|');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function generateSecureToken() {
    return crypto.randomBytes(16).toString('hex');
}

function generateStudentUpdateToken() {
    return crypto.randomBytes(24).toString('hex');
}

function generateUID(name, aspiration, phone) {
    const cleanName = normalizeText(name).replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 8) || 'STUDENT';
    const cleanAspiration = normalizeText(aspiration).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4) || 'GEN';
    const phoneTail = normalizeText(phone).replace(/\D/g, '').slice(-4).padStart(4, '0');
    return `RMC-${cleanAspiration}-${phoneTail}-${cleanName}`;
}

function pruneExpiredStudentUpdateSessions() {
    const now = Date.now();
    for (const [token, session] of studentUpdatePortalTokens.entries()) {
        if (!session || session.expiresAt <= now) {
            studentUpdatePortalTokens.delete(token);
        }
    }
    for (const [sessionId, session] of studentEditSessions.entries()) {
        if (!session || session.expiresAt <= now) {
            studentEditSessions.delete(sessionId);
        }
    }
}

function createStudentUpdatePortalToken(studentUid, createdBy = null) {
    pruneExpiredStudentUpdateSessions();
    const token = generateStudentUpdateToken();
    const expiresAt = Date.now() + (10 * 60 * 1000);
    studentUpdatePortalTokens.set(token, {
        studentUid: normalizeText(studentUid),
        createdBy: normalizeText(createdBy),
        createdAt: Date.now(),
        expiresAt
    });
    return token;
}

function consumeStudentUpdatePortalToken(token) {
    pruneExpiredStudentUpdateSessions();
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
        return null;
    }
    const session = studentUpdatePortalTokens.get(normalizedToken) || null;
    if (!session) {
        return null;
    }
    studentUpdatePortalTokens.delete(normalizedToken);
    return session;
}

function createStudentEditSession(studentUid, createdBy = null) {
    pruneExpiredStudentUpdateSessions();
    const sessionId = generateStudentUpdateToken();
    const expiresAt = Date.now() + (30 * 60 * 1000);
    studentEditSessions.set(sessionId, {
        sessionId,
        studentUid: normalizeText(studentUid),
        createdBy: normalizeText(createdBy),
        createdAt: Date.now(),
        expiresAt
    });
    return sessionId;
}

function getStudentEditSession(sessionId) {
    pruneExpiredStudentUpdateSessions();
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
        return null;
    }
    return studentEditSessions.get(normalizedSessionId) || null;
}

async function generateUniqueUid(name, aspiration, phone) {
    const baseUid = generateUID(name, aspiration, phone);
    let uid = baseUid;
    let counter = 1;

    while (await getAsync('SELECT student_uid FROM master_student_index WHERE student_uid = ?', [uid])) {
        uid = `${baseUid}-${String(counter).padStart(2, '0')}`;
        counter += 1;
    }

    return uid;
}

function generateReadablePassword(length = 14) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = crypto.randomBytes(length);
    let password = '';

    for (let index = 0; index < length; index += 1) {
        password += alphabet[bytes[index] % alphabet.length];
    }

    return password;
}

function looksLikeBcryptHash(value) {
    return /^\$2[aby]\$\d{2}\$/.test(String(value || ''));
}

async function verifyAndUpgradeUserPassword(user, plainPassword) {
    const storedPassword = String(user?.password || '');
    if (!storedPassword || !plainPassword) {
        return false;
    }

    if (looksLikeBcryptHash(storedPassword)) {
        return bcrypt.compare(plainPassword, storedPassword);
    }

    if (storedPassword !== plainPassword) {
        return false;
    }

    const nextHash = await bcrypt.hash(plainPassword, 10);
    await runAsync('UPDATE users SET password = ? WHERE id = ?', [nextHash, user.id]);
    user.password = nextHash;
    return true;
}

function buildVerifyUrl(token) {
    return `${DEFAULT_BASE_URL.replace(/\/$/, '')}/verify/${encodeURIComponent(token)}`;
}

function buildStaffScanUrl(token) {
    return `${DEFAULT_BASE_URL.replace(/\/$/, '')}/staff/scan/${encodeURIComponent(token)}`;
}

function generateStaffToken() {
    return crypto.randomBytes(16).toString('hex');
}

async function upsertSystemUser({ username, plainPassword, role, fullName }) {
    const existing = await getAsync('SELECT id, staff_token FROM users WHERE username = ?', [username]);
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const staffToken = normalizeText(existing?.staff_token) || generateStaffToken();

    if (existing) {
        await runAsync(
            'UPDATE users SET password = ?, role = ?, full_name = ?, staff_token = ? WHERE id = ?',
            [passwordHash, role, fullName, staffToken, existing.id]
        );
        return { created: false, username, plainPassword };
    }

    await runAsync(
        'INSERT INTO users (username, password, role, full_name, staff_token) VALUES (?, ?, ?, ?, ?)',
        [username, passwordHash, role, fullName, staffToken]
    );
    return { created: true, username, plainPassword };
}

async function ensureSystemUsers() {
    const hostPassword = process.env.RMC_DEFAULT_HOST_PASSWORD || 'admin123';
    const teacherPassword = process.env.RMC_DEFAULT_TEACHER_PASSWORD || 'teacher123';

    const hostResult = await upsertSystemUser({
        username: 'host',
        plainPassword: hostPassword,
        role: 'host',
        fullName: 'Host Admin'
    });
    const teacherResult = await upsertSystemUser({
        username: 'teacher',
        plainPassword: teacherPassword,
        role: 'teacher',
        fullName: 'Default Teacher'
    });

    console.log('System users ensured:');
    console.log(`  ${hostResult.username} / ${hostPassword}${hostResult.created ? ' (created)' : ' (updated)'}`);
    console.log(`  ${teacherResult.username} / ${teacherPassword}${teacherResult.created ? ' (created)' : ' (updated)'}`);
}

function extractToken(rawToken) {
    const trimmed = normalizeText(rawToken);
    if (!trimmed) {
        return '';
    }

    try {
        const parsed = new URL(trimmed);
        return decodeURIComponent(parsed.pathname.split('/').pop() || '');
    } catch (error) {
        const withoutQuery = trimmed.split('?')[0];
        return decodeURIComponent(withoutQuery.split('/').pop() || withoutQuery);
    }
}

function isApiRequest(req) {
    return req.path.startsWith('/api/');
}

function isPrivateEntryPath(pathname) {
    return pathname === '/gateway'
        || pathname === '/login'
        || pathname === '/student/login'
        || pathname === '/register';
}

function sendUnauthorized(req, res, redirectPath, message) {
    if (isApiRequest(req)) {
        res.status(401).json({ status: 'error', error: message });
        return;
    }
    res.redirect(redirectPath);
}

function isTenantSessionMatch(req) {
    const currentTenantKey = tenantRuntime.normalizeTenantKey(req?.tenant?.tenantKey || req?.session?.tenantKey || tenantRuntime.DEFAULT_TENANT_KEY);
    const sessionTenantKey = tenantRuntime.normalizeTenantKey(req?.session?.tenantKey || tenantRuntime.DEFAULT_TENANT_KEY);
    if (sessionTenantKey !== currentTenantKey) {
        return false;
    }
    return true;
}

const isAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        sendUnauthorized(req, res, '/login', 'Authentication required.');
        return;
    }
    if (!isTenantSessionMatch(req)) {
        sendUnauthorized(req, res, '/login', 'Tenant session mismatch. Please sign in again.');
        return;
    }

    const now = Date.now();
    if (req.session.lastActive && now - req.session.lastActive > SESSION_TIMEOUT) {
        req.session.destroy(() => {
            sendUnauthorized(req, res, '/login?timeout=1', 'Session expired.');
        });
        return;
    }

    req.session.lastActive = now;
    next();
};

const isHost = (req, res, next) => {
    if (req.session.user?.role === 'host') {
        next();
        return;
    }

    if (isApiRequest(req)) {
        res.status(403).json({ status: 'error', error: 'Forbidden' });
        return;
    }

    res.status(403).send('Forbidden');
};

const isStudentAuthenticated = (req, res, next) => {
    if (req.session.student) {
        if (!isTenantSessionMatch(req)) {
            sendUnauthorized(req, res, '/student/login', 'Tenant session mismatch. Please sign in again.');
            return;
        }
        next();
        return;
    }

    sendUnauthorized(req, res, '/student/login', 'Student authentication required.');
};

const isPortalAuthenticated = (req, res, next) => {
    if (req.session.user || req.session.student) {
        if (!isTenantSessionMatch(req)) {
            sendUnauthorized(req, res, '/login', 'Tenant session mismatch. Please sign in again.');
            return;
        }
        next();
        return;
    }

    sendUnauthorized(req, res, '/login', 'Authentication required.');
};

const isAuthenticatedStream = (req, res, next) => {
    if (req.session.user) {
        if (!isTenantSessionMatch(req)) {
            res.status(204).end();
            return;
        }
        const now = Date.now();
        if (req.session.lastActive && now - req.session.lastActive > SESSION_TIMEOUT) {
            req.session.destroy(() => {
                res.status(204).end();
            });
            return;
        }

        req.session.lastActive = now;
        next();
        return;
    }

    res.status(204).end();
};

const isPortalAuthenticatedStream = (req, res, next) => {
    if (req.session.user || req.session.student) {
        if (!isTenantSessionMatch(req)) {
            res.status(204).end();
            return;
        }
        next();
        return;
    }

    res.status(204).end();
};

const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

async function beginTransaction() {
    if (!dbClient) {
        throw new Error('Database not initialized.');
    }
    const client = await getActiveDbClient();
    await client.beginTransaction();
}

async function commitTransaction() {
    if (!dbClient) {
        throw new Error('Database not initialized.');
    }
    const client = await getActiveDbClient();
    await client.commit();
}

async function rollbackTransaction() {
    if (!dbClient) {
        return;
    }
    const client = await getActiveDbClient();
    await client.rollback();
}

async function ensureStorageDirectories(tenant = getCurrentTenantRecord()) {
    await tenantRuntime.ensureTenantStorageDirs(tenant);
}

async function getSessionRoster(sessionId, fallbackBatchName = null) {
    const rows = await allAsync(
        `SELECT student_uid, name, phone, father_name, guardian_phone, student_class, aspiration,
                current_batch, photo_path, qr_path, secure_token, created_at
         FROM session_students
         WHERE session_id = ?
         ORDER BY name ASC, student_uid ASC`,
        [sessionId]
    );
    if (rows.length > 0) {
        return rows;
    }

    const batchName = normalizeBatchName(fallbackBatchName);
    if (!batchName) {
        return [];
    }

    const tableName = getBatchTableName(batchName);
    if (!(await tableExists(tableName))) {
        return [];
    }

    return allAsync(
        `SELECT student_uid, name, phone, father_name, guardian_phone, student_class, aspiration,
                current_batch, photo_path, qr_path, secure_token, created_at, ? AS session_id
         FROM ${quoteIdentifier(tableName)}
         ORDER BY name ASC, student_uid ASC`,
        [sessionId]
    );
}

function normalizePushBatchList(value) {
    return Array.from(new Set(splitBatchNames(value).map((batch) => normalizeBatchName(batch)).filter(Boolean)));
}

function normalizeMobilePushProvider(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized === 'fcm' ? 'fcm' : 'expo';
}

function inferMobilePushProvider(row) {
    const explicit = normalizeMobilePushProvider(row?.push_provider || row?.provider || '');
    if (explicit === 'fcm') {
        return 'fcm';
    }
    const token = normalizeText(row?.token || '');
    if (token && !token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
        return 'fcm';
    }
    return 'expo';
}

function getFirebaseAdminClient() {
    if (!firebaseAdmin) {
        return null;
    }
    if (firebaseAdmin.apps && firebaseAdmin.apps.length > 0) {
        return firebaseAdmin;
    }
    if (!fs.existsSync(FIREBASE_SERVICE_ACCOUNT_FILE)) {
        console.warn('[Push] Firebase service account file missing:', FIREBASE_SERVICE_ACCOUNT_FILE);
        return null;
    }
    try {
        const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8'));
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(serviceAccount)
        });
        console.log('[Push] Firebase Admin initialized.');
        return firebaseAdmin;
    } catch (error) {
        console.warn('[Push] Firebase Admin init failed:', error?.message || error);
        return null;
    }
}

function normalizeFirebaseDataPayload(data) {
    const payload = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (value === undefined || value === null) {
            continue;
        }
        payload[String(key)] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return payload;
}

async function upsertMobilePushToken({
    role,
    ownerKey,
    ownerLabel,
    batchNames = [],
    token,
    pushProvider,
    platform,
    deviceName,
    appVersion
}) {
    const normalizedRole = normalizeText(role).toLowerCase();
    const normalizedOwnerKey = normalizeText(ownerKey);
    const normalizedOwnerLabel = normalizeText(ownerLabel);
    const normalizedToken = normalizeText(token);
    const normalizedPushProvider = normalizeMobilePushProvider(pushProvider);
    const normalizedPlatform = normalizeText(platform);
    const normalizedDeviceName = normalizeText(deviceName);
    const normalizedAppVersion = normalizeText(appVersion);
    const batchNamesJson = JSON.stringify(normalizePushBatchList(batchNames));

    if (!normalizedRole || !normalizedOwnerKey || !normalizedToken) {
        throw new Error('Mobile push token, role, and owner key are required.');
    }

    if (normalizedPushProvider === 'fcm') {
        await runAsync(
            'DELETE FROM mobile_push_tokens WHERE role = ? AND owner_key = ? AND platform = ? AND token <> ?',
            [normalizedRole, normalizedOwnerKey, normalizedPlatform, normalizedToken]
        ).catch(() => null);
    }

    if (DB_DIALECT === 'mysql') {
        await runAsync(
            `
            INSERT INTO mobile_push_tokens (
                role, owner_key, owner_label, batch_names_json, token, push_provider, platform, device_name, app_version, last_seen_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, COALESCE((SELECT created_at FROM mobile_push_tokens WHERE token = ?), CURRENT_TIMESTAMP))
            ON DUPLICATE KEY UPDATE
                role = VALUES(role),
                owner_key = VALUES(owner_key),
                owner_label = VALUES(owner_label),
                batch_names_json = VALUES(batch_names_json),
                push_provider = VALUES(push_provider),
                platform = VALUES(platform),
                device_name = VALUES(device_name),
                app_version = VALUES(app_version),
                last_seen_at = CURRENT_TIMESTAMP
            `,
            [normalizedRole, normalizedOwnerKey, normalizedOwnerLabel, batchNamesJson, normalizedToken, normalizedPushProvider, normalizedPlatform, normalizedDeviceName, normalizedAppVersion, normalizedToken]
        );
        return;
    }

    await runAsync(
        `
        INSERT INTO mobile_push_tokens (
            role, owner_key, owner_label, batch_names_json, token, push_provider, platform, device_name, app_version, last_seen_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, COALESCE((SELECT created_at FROM mobile_push_tokens WHERE token = ?), CURRENT_TIMESTAMP))
        ON CONFLICT(token) DO UPDATE SET
            role = excluded.role,
            owner_key = excluded.owner_key,
            owner_label = excluded.owner_label,
            batch_names_json = excluded.batch_names_json,
            push_provider = excluded.push_provider,
            platform = excluded.platform,
            device_name = excluded.device_name,
            app_version = excluded.app_version,
            last_seen_at = CURRENT_TIMESTAMP
        `,
        [normalizedRole, normalizedOwnerKey, normalizedOwnerLabel, batchNamesJson, normalizedToken, normalizedPushProvider, normalizedPlatform, normalizedDeviceName, normalizedAppVersion, normalizedToken]
    );
}

async function listMobilePushTokensByRole(role) {
    const normalizedRole = normalizeText(role).toLowerCase();
    if (!normalizedRole) {
        return [];
    }
    const rows = await allAsync(
        `SELECT id, role, owner_key, owner_label, batch_names_json, token, push_provider, platform, device_name, app_version, last_seen_at, created_at
         FROM mobile_push_tokens
         WHERE role = ?
         ORDER BY last_seen_at DESC, id DESC`,
        [normalizedRole]
    );
    return rows.map((row) => ({
        ...row,
        batch_names: (() => {
            try {
                const parsed = JSON.parse(row.batch_names_json || '[]');
                return Array.isArray(parsed) ? parsed.map((batch) => normalizeBatchName(batch)).filter(Boolean) : [];
            } catch (_error) {
                return [];
            }
        })()
    }));
}

function tokenMatchesTargetBatches(tokenBatchNames, targetBatchNames) {
    const normalizedTargets = normalizePushBatchList(targetBatchNames);
    if (normalizedTargets.length === 0 || normalizedTargets.includes('ALL')) {
        return true;
    }
    const normalizedTokenBatches = normalizePushBatchList(tokenBatchNames);
    return normalizedTokenBatches.some((batch) => normalizedTargets.includes(batch));
}

async function sendExpoPushNotifications(messages) {
    const queue = Array.isArray(messages) ? messages.filter(Boolean) : [];
    if (queue.length === 0) {
        return 0;
    }

    for (let index = 0; index < queue.length; index += 100) {
        const chunk = queue.slice(index, index + 100);
        try {
            const normalizedChunk = chunk.map((message) => ({
                ...message,
                sound: message.sound || 'default',
                priority: message.priority || 'high',
                channelId: message.channelId || 'default'
            }));
            const response = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Accept-encoding': 'gzip, deflate',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(normalizedChunk)
            });
            if (!response.ok) {
                const bodyText = await response.text().catch(() => '');
                console.warn('[Push] Expo send failed:', response.status, bodyText.slice(0, 300));
            }
        } catch (error) {
            console.warn('[Push] Expo send error:', error);
        }
    }

    return queue.length;
}

async function sendFirebasePushNotifications(messages) {
    const queue = Array.isArray(messages) ? messages.filter(Boolean) : [];
    if (queue.length === 0) {
        return 0;
    }

    const admin = getFirebaseAdminClient();
    if (!admin) {
        return 0;
    }

    let successCount = 0;
    for (let index = 0; index < queue.length; index += 500) {
        const chunk = queue.slice(index, index + 500);
        const response = await admin.messaging().sendEachForMulticast({
            tokens: chunk.map((message) => message.token),
            notification: {
                title: normalizeText(chunk[0]?.title) || 'RMC Mobile',
                body: normalizeText(chunk[0]?.body) || ''
            },
            data: normalizeFirebaseDataPayload(chunk[0]?.data || {}),
            android: {
                priority: 'high',
                notification: {
                    channelId: MOBILE_ALERT_CHANNEL_ID,
                    sound: 'default'
                }
            }
        });
        successCount += Number(response?.successCount || 0);
        if (Array.isArray(response?.responses)) {
            response.responses.forEach((item, itemIndex) => {
                if (!item?.success) {
                    const targetToken = chunk[itemIndex]?.token || '';
                    console.warn('[Push] FCM send failed:', targetToken, item?.error?.message || item?.error?.code || 'unknown');
                }
            });
        }
    }

    return successCount;
}

function compareVersionStrings(left, right) {
    const leftParts = normalizeText(left).split('.').map((part) => Number(part) || 0);
    const rightParts = normalizeText(right).split('.').map((part) => Number(part) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

async function readJsonFile(targetPath, fallback = null) {
    try {
        const info = await fsp.stat(targetPath).catch(() => null);
        if (!info || !info.isFile()) {
            return fallback;
        }
        return JSON.parse(await fsp.readFile(targetPath, 'utf8'));
    } catch {
        return fallback;
    }
}

async function writeJsonFile(targetPath, value) {
    await ensureDirectoryExists(path.dirname(targetPath));
    await fsp.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function ensureDirectoryExists(targetDir) {
    if (!targetDir) return;
    await fsp.mkdir(targetDir, { recursive: true });
}

function buildMobileUpdateAnnouncement(appManifest) {
    const updateMode = normalizeText(appManifest?.update_mode || 'none').toLowerCase();
    const version = normalizeText(appManifest?.version || MOBILE_APP_VERSION || '1.0.17') || MOBILE_APP_VERSION || '1.0.17';
    const configVersion = Number(appManifest?.config_version || 0) || 0;
    const title = updateMode === 'apk'
        ? 'App update available'
        : 'App update available';
    const body = updateMode === 'apk'
        ? `Version ${version} is ready. Download the latest APK from the website to keep using the app.`
        : `Version ${version} is ready. Open the app to apply the new UI update.`;
    return {
        signature: [
            version,
            normalizeText(appManifest?.min_version || version || ''),
            updateMode,
            Boolean(appManifest?.force_update) ? '1' : '0',
            String(configVersion)
        ].join('|'),
        title,
        body,
        data: {
            type: 'app_update',
            version,
            min_version: normalizeText(appManifest?.min_version || version || ''),
            update_mode: updateMode,
            force_update: Boolean(appManifest?.force_update),
            config_version: configVersion,
            apk_url: normalizeText(appManifest?.apk_url || MOBILE_APK_URL || PUBLIC_MOBILE_APK_URL) || PUBLIC_MOBILE_APK_URL
        }
    };
}

async function announceMobileUpdateIfNeeded(appManifest) {
    const updateMode = normalizeText(appManifest?.update_mode || 'none').toLowerCase();
    if (!['config', 'apk'].includes(updateMode)) {
        return 0;
    }

    const announcement = buildMobileUpdateAnnouncement(appManifest);
    const previousAnnouncement = await readJsonFile(MOBILE_UPDATE_BROADCAST_FILE, null);
    if (previousAnnouncement?.signature === announcement.signature) {
        return 0;
    }

    const studentCount = await pushMobileNotification({
        role: 'student',
        title: announcement.title,
        body: announcement.body,
        data: announcement.data
    });
    const staffCount = await pushMobileNotification({
        role: 'staff',
        title: announcement.title,
        body: announcement.body,
        data: announcement.data
    });
    const totalSent = Number(studentCount || 0) + Number(staffCount || 0);
    await writeJsonFile(MOBILE_UPDATE_BROADCAST_FILE, {
        ...announcement,
        sent_at: new Date().toISOString(),
        delivered_to: totalSent
    });

    return totalSent;
}

async function getCurrentMobileManifestApp() {
    const manifest = await readJsonFile(MOBILE_MANIFEST_FILE, {}) || {};
    const rawApp = manifest && typeof manifest === 'object' ? (manifest.app || {}) : {};
    const updateModeRaw = normalizeText(rawApp.update_mode || manifest.update_mode || 'none').toLowerCase();
    const updateMode = ['none', 'config', 'apk'].includes(updateModeRaw) ? updateModeRaw : 'none';
    const config = rawApp.config && typeof rawApp.config === 'object' ? rawApp.config : {};
    const releaseNotes = Array.isArray(rawApp.release_notes) ? rawApp.release_notes.map(normalizeText).filter(Boolean).slice(0, 8) : [];
    return {
        version: normalizeText(rawApp.version || manifest.version || MOBILE_APP_VERSION || '1.0.17'),
        min_version: normalizeText(rawApp.min_version || rawApp.version || manifest.min_version || MOBILE_APP_VERSION || '1.0.17'),
        update_mode: updateMode,
        force_update: Boolean(rawApp.force_update ?? manifest.force_update ?? false),
        apk_url: normalizeText(rawApp.apk_url || manifest.apk_url || MOBILE_APK_URL || PUBLIC_MOBILE_APK_URL) || PUBLIC_MOBILE_APK_URL,
        config_version: Number(rawApp.config_version || manifest.config_version || 1) || 1,
        release_notes: releaseNotes,
        config
    };
}

async function pushMobileNotification({ role, title, body, data = {}, batchNames = [], ownerKeys = [] }) {
    const normalizedRole = normalizeText(role).toLowerCase();
    const tokens = normalizedRole === 'all'
        ? await allAsync(
            `SELECT id, role, owner_key, owner_label, batch_names_json, token, push_provider, platform, device_name, app_version, last_seen_at, created_at
             FROM mobile_push_tokens
             ORDER BY last_seen_at DESC, id DESC`
          ).then((rows) => rows.map((row) => ({
              ...row,
              batch_names: (() => {
                  try {
                      const parsed = JSON.parse(row.batch_names_json || '[]');
                      return Array.isArray(parsed) ? parsed.map((item) => normalizeText(item)).filter(Boolean) : [];
                  } catch {
                      return [];
                  }
              })()
          })))
        : await listMobilePushTokensByRole(normalizedRole);
    const normalizedOwnerKeys = Array.isArray(ownerKeys)
        ? ownerKeys.map((key) => normalizeText(key)).filter(Boolean)
        : [];
    const filteredTokens = tokens.filter((tokenRow) => {
        if (normalizedOwnerKeys.length > 0 && !normalizedOwnerKeys.includes(normalizeText(tokenRow.owner_key))) {
            return false;
        }
        if (normalizedRole === 'student') {
            return tokenMatchesTargetBatches(tokenRow.batch_names, batchNames);
        }
        return true;
    });

    if (filteredTokens.length === 0) {
        return 0;
    }

    const expoMessages = [];
    const firebaseMessages = [];
    for (const tokenRow of filteredTokens) {
        const provider = inferMobilePushProvider(tokenRow);
        const message = {
            token: tokenRow.token,
            title: normalizeText(title) || 'RMC Mobile',
            body: normalizeText(body) || '',
            data
        };
        if (provider === 'fcm') {
            firebaseMessages.push(message);
        } else {
            expoMessages.push({
                to: tokenRow.token,
                sound: 'default',
                title: message.title,
                body: message.body,
                data: message.data
            });
        }
    }

    const [expoCount, firebaseSuccessCount] = await Promise.all([
        sendExpoPushNotifications(expoMessages),
        sendFirebasePushNotifications(firebaseMessages)
    ]);
    return Number(expoCount || 0) + Number(firebaseSuccessCount || 0);
}

async function createBatchTable(batchName) {
    const normalizedBatch = normalizeBatchName(batchName);
    if (!normalizedBatch) {
        throw new Error('Batch name is required.');
    }

    const tableName = getBatchTableName(normalizedBatch);
    if (DB_DIALECT === 'mysql') {
        await runAsync(`
            CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
                student_uid VARCHAR(64) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(32) NOT NULL,
                father_name VARCHAR(255),
                guardian_phone VARCHAR(32),
                address TEXT,
                student_class VARCHAR(64),
                aspiration VARCHAR(255),
                current_batch VARCHAR(255) NOT NULL,
                photo_path TEXT,
                qr_path TEXT,
                secure_token VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        `);
    } else {
        await runAsync(`
            CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
                student_uid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                father_name TEXT,
                guardian_phone TEXT,
                address TEXT,
                student_class TEXT,
                aspiration TEXT,
                current_batch TEXT NOT NULL,
                photo_path TEXT,
                qr_path TEXT,
                secure_token TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
    return tableName;
}

async function syncBatchCatalogEntry(batch) {
    if (!batch || !Number.isFinite(Number(batch.id)) || !batch.name) {
        return;
    }

    if (DB_DIALECT === 'mysql') {
        await runAsync(
            `
            INSERT INTO batch_catalog (batch_id, name, description, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 1, COALESCE((SELECT created_at FROM batch_catalog WHERE batch_id = ?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                description = VALUES(description),
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP
            `,
            [batch.id, batch.name, batch.description || '', batch.id]
        );
        return;
    }

    await runAsync(
        `
        INSERT INTO batch_catalog (batch_id, name, description, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 1, COALESCE((SELECT created_at FROM batch_catalog WHERE batch_id = ?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        ON CONFLICT(batch_id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
        `,
        [batch.id, batch.name, batch.description || '', batch.id]
    );
}

async function deactivateBatchCatalogEntry(batchId) {
    if (!Number.isFinite(Number(batchId))) {
        return;
    }

    await runAsync(
        'UPDATE batch_catalog SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE batch_id = ?',
        [batchId]
    );
}

async function syncBatchCatalogFromBatches() {
    const batches = await allAsync('SELECT id, name, description FROM batches ORDER BY created_at DESC');
    const activeIds = batches.map((batch) => Number(batch.id)).filter(Number.isFinite);

    for (const batch of batches) {
        await syncBatchCatalogEntry(batch);
    }

    if (activeIds.length === 0) {
        await runAsync('UPDATE batch_catalog SET is_active = 0, updated_at = CURRENT_TIMESTAMP');
        return;
    }

    const placeholders = activeIds.map(() => '?').join(', ');
    await runAsync(
        `UPDATE batch_catalog
         SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE batch_id NOT IN (${placeholders})`,
        activeIds
    );
}

async function initDb() {
    await ensureStorageDirectories();
    if (!dbClient) {
        dbClient = await createDb(DB_DIALECT === 'sqlite' ? { sqliteFile: DB_FILE } : {});
    }
    if (DB_DIALECT === 'sqlite' && dbClient && !dbClient.__schemaInitialized) {
        dbClient.__schemaInitialized = true;
        dbReadyAt = new Date().toISOString();
    }

    if (DB_DIALECT === 'mysql') {
        await initDbMysql();
        await migrateSqliteDataToMysqlIfNeeded();
        return;
    }
    await runAsync('PRAGMA foreign_keys = ON');

    await runAsync(`
        CREATE TABLE IF NOT EXISTS master_student_index (
            student_uid TEXT PRIMARY KEY,
            batch_name TEXT NOT NULL,
            secure_token TEXT UNIQUE,
            phone TEXT,
            name TEXT,
            father_name TEXT,
            guardian_phone TEXT,
            address TEXT,
            student_class TEXT,
            aspiration TEXT,
            current_batch TEXT,
            attendance_percent INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            photo_path TEXT,
            qr_path TEXT,
            login_token TEXT,
            app_first_login_at DATETIME,
            app_first_login_notified_at DATETIME,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            email TEXT,
            phone TEXT
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_name TEXT,
            batch_id TEXT NOT NULL,
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            end_time DATETIME,
            status TEXT DEFAULT 'active',
            is_late INTEGER DEFAULT 0,
            column_name TEXT,
            created_by INTEGER,
            FOREIGN KEY(created_by) REFERENCES users(id)
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS session_students (
            session_id INTEGER NOT NULL,
            student_uid TEXT NOT NULL,
            name TEXT NOT NULL,
            phone TEXT,
            father_name TEXT,
            guardian_phone TEXT,
            address TEXT,
            student_class TEXT,
            aspiration TEXT,
            current_batch TEXT,
            photo_path TEXT,
            qr_path TEXT,
            secure_token TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(session_id, student_uid),
            FOREIGN KEY(session_id) REFERENCES attendance_sessions(id)
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            student_uid TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            status INTEGER DEFAULT 1,
            mark_key TEXT,
            local_session_id TEXT,
            client_device_id TEXT,
            UNIQUE(session_id, student_uid),
            FOREIGN KEY(session_id) REFERENCES attendance_sessions(id)
        )
    `);
    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_session_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            local_session_id TEXT NOT NULL,
            client_device_id TEXT NOT NULL,
            server_session_id INTEGER,
            batch_id TEXT,
            batch_name TEXT,
            session_name TEXT,
            local_created_at TEXT,
            synced_at TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(local_session_id, client_device_id)
        )
    `);
    await ensureAttendanceRecordsSchema();
    await ensureOfflineReplaySchema();

    await runAsync(`
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS batch_catalog (
            batch_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await runAsync('CREATE INDEX IF NOT EXISTS idx_batch_catalog_active ON batch_catalog(is_active, updated_at)');
    await syncBatchCatalogFromBatches();

    await runAsync(`
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            file_path TEXT NOT NULL,
            batch_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(batch_id) REFERENCES batches(id)
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS notices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            target_batch TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_uid TEXT NOT NULL,
            title TEXT,
            notification_type TEXT,
            content TEXT NOT NULL,
            session_id INTEGER,
            batch_id TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS staff_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            target_roles TEXT,
            metadata_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            message TEXT,
            source TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_read INTEGER DEFAULT 0,
            father_name TEXT,
            guardian_phone TEXT,
            id_card_allowed INTEGER DEFAULT 0,
            id_card_allowed_by TEXT,
            id_card_allowed_at DATETIME
        )
    `);
    await runAsync(`
        CREATE TABLE IF NOT EXISTS doubts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_uid TEXT NOT NULL,
            student_name TEXT,
            batch_name TEXT,
            phone TEXT,
            question_text TEXT,
            question_image TEXT,
            reply_image TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            replied_at DATETIME
        )
    `);
    await runAsync('CREATE INDEX IF NOT EXISTS idx_doubts_student_created ON doubts(student_uid, created_at)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_doubts_status_created ON doubts(status, created_at)');
    await runAsync(`
        CREATE TABLE IF NOT EXISTS id_card_phone_approvals (
            phone TEXT PRIMARY KEY,
            approved_by TEXT,
            approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            student_name TEXT,
            father_name TEXT,
            guardian_phone TEXT
        )
    `);
    await runAsync(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_uid TEXT NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
        await runAsync(`
            CREATE TABLE IF NOT EXISTS mobile_push_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                owner_key TEXT NOT NULL,
                owner_label TEXT,
                batch_names_json TEXT,
                token TEXT NOT NULL UNIQUE,
                push_provider TEXT NOT NULL DEFAULT 'expo',
                platform TEXT,
                device_name TEXT,
                app_version TEXT,
                last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await runAsync('CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_owner ON mobile_push_tokens(role, owner_key)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_seen ON mobile_push_tokens(last_seen_at)');
    await ensureMobilePushTokenProviderColumn();

    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_weekly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL,
            session_id INTEGER,
            window_start DATETIME NOT NULL,
            window_end DATETIME NOT NULL,
            low_count INTEGER NOT NULL DEFAULT 0,
            total_students INTEGER NOT NULL DEFAULT 0,
            summary TEXT NOT NULL,
            report_json TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_papers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL DEFAULT 30,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paper_id INTEGER NOT NULL,
            question_order INTEGER NOT NULL,
            question_text TEXT NOT NULL,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            option_c TEXT NOT NULL,
            option_d TEXT NOT NULL,
            correct_option TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(paper_id) REFERENCES test_papers(id) ON DELETE CASCADE
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_launches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paper_id INTEGER NOT NULL,
            batch_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            scoreboard_published INTEGER NOT NULL DEFAULT 0,
            starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            closes_at DATETIME,
            closed_at DATETIME,
            launched_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(paper_id) REFERENCES test_papers(id) ON DELETE CASCADE,
            FOREIGN KEY(launched_by) REFERENCES users(id)
        )
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            launch_id INTEGER NOT NULL,
            paper_id INTEGER NOT NULL,
            student_uid TEXT NOT NULL,
            student_name TEXT NOT NULL,
            batch_name TEXT NOT NULL,
            answers_json TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            total_questions INTEGER NOT NULL DEFAULT 0,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(launch_id) REFERENCES test_launches(id) ON DELETE CASCADE,
            FOREIGN KEY(paper_id) REFERENCES test_papers(id) ON DELETE CASCADE,
            UNIQUE(launch_id, student_uid)
        )
    `);

    await ensureColumn('master_student_index', 'father_name', 'TEXT');
    await ensureColumn('master_student_index', 'guardian_phone', 'TEXT');
    await ensureColumn('master_student_index', 'address', 'TEXT');
    await ensureColumn('master_student_index', 'student_class', 'TEXT');
    await ensureColumn('master_student_index', 'aspiration', 'TEXT');
    await ensureColumn('master_student_index', 'current_batch', 'TEXT');
    await ensureColumn('master_student_index', 'attendance_percent', 'INTEGER DEFAULT 0');
    await ensureColumn('master_student_index', 'status', "TEXT DEFAULT 'active'");
    await ensureColumn('master_student_index', 'photo_path', 'TEXT');
    await ensureColumn('master_student_index', 'qr_path', 'TEXT');
    await ensureColumn('master_student_index', 'login_token', 'TEXT');
    await ensureColumn('master_student_index', 'app_first_login_at', 'DATETIME');
    await ensureColumn('master_student_index', 'app_first_login_notified_at', 'DATETIME');
    await ensureColumn('users', 'staff_token', 'TEXT');
    await ensureColumn('users', 'full_name', 'TEXT');
    await ensureColumn('leads', 'id_card_allowed', 'INTEGER DEFAULT 0');
    await ensureColumn('leads', 'id_card_allowed_by', 'TEXT');
    await ensureColumn('leads', 'id_card_allowed_at', 'DATETIME');
    await ensureColumn('leads', 'father_name', 'TEXT');
    await ensureColumn('leads', 'guardian_phone', 'TEXT');
    await ensureColumn('doubts', 'student_name', 'TEXT');
    await ensureColumn('doubts', 'batch_name', 'TEXT');
    await ensureColumn('doubts', 'phone', 'TEXT');
    await ensureColumn('id_card_phone_approvals', 'student_name', 'TEXT');
    await ensureColumn('id_card_phone_approvals', 'father_name', 'TEXT');
    await ensureColumn('id_card_phone_approvals', 'guardian_phone', 'TEXT');
    await ensureColumn('notifications', 'title', 'TEXT');
    await ensureColumn('notifications', 'notification_type', 'TEXT');
    await ensureColumn('notifications', 'session_id', 'INTEGER');
    await ensureColumn('notifications', 'batch_id', 'TEXT');
    await ensureColumn('notifications', 'is_read', 'INTEGER DEFAULT 0');

    await runAsync('CREATE INDEX IF NOT EXISTS idx_master_student_index_token ON master_student_index(secure_token)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_master_student_index_login_token ON master_student_index(login_token)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_master_student_index_phone ON master_student_index(phone)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_users_staff_token ON users(staff_token)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_attendance_sessions_batch_status ON attendance_sessions(batch_id, status)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_session_students_session ON session_students(session_id)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_session_students_student ON session_students(student_uid)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON attendance_records(session_id)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_uid)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_id_card_phone_approvals_approved_at ON id_card_phone_approvals(approved_at)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_student ON push_subscriptions(student_uid)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_notifications_student_created ON notifications(student_uid, created_at)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_weekly_reports_batch_created ON attendance_weekly_reports(batch_id, created_at)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_test_questions_paper_order ON test_questions(paper_id, question_order)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_test_launches_batch_status ON test_launches(batch_name, status, starts_at)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_test_submissions_launch_score ON test_submissions(launch_id, score DESC, submitted_at ASC)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_test_submissions_student ON test_submissions(student_uid, submitted_at DESC)');

    const duplicatePhones = await allAsync(
        `SELECT phone
         FROM master_student_index
         WHERE phone IS NOT NULL AND TRIM(phone) != ''
         GROUP BY phone
         HAVING COUNT(*) > 1
         LIMIT 1`
    );
    if (duplicatePhones.length === 0) {
        await runAsync(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_master_student_index_phone_unique
             ON master_student_index(phone)
             WHERE phone IS NOT NULL AND TRIM(phone) != ''`
        );
    } else {
        console.warn('Unique phone index skipped because duplicate phone numbers already exist in master_student_index.');
    }

    await runAsync(`
        UPDATE master_student_index
        SET login_token = secure_token
        WHERE login_token IS NULL OR TRIM(login_token) = ''
    `);

    await ensureSystemUsers();

    const usersWithoutToken = await allAsync(
        `SELECT id
         FROM users
         WHERE staff_token IS NULL OR TRIM(staff_token) = ''`
    );
    for (const row of usersWithoutToken) {
        await runAsync('UPDATE users SET staff_token = ? WHERE id = ?', [generateStaffToken(), row.id]);
    }
}

async function migrateSqliteDataToMysqlIfNeeded() {
    if (DB_DIALECT !== 'mysql' || !SQLITE_MIGRATION_ENABLED) {
        return false;
    }
    if (fs.existsSync(SQLITE_MIGRATION_STATE_FILE)) {
        return false;
    }
    if (!fs.existsSync(SQLITE_MIGRATION_SOURCE_FILE)) {
        logger.db(`SQLite migration source not found at ${SQLITE_MIGRATION_SOURCE_FILE}. Skipping migration.`);
        return false;
    }

    const sourceDb = await createDb({ sqliteFile: SQLITE_MIGRATION_SOURCE_FILE, dialect: 'sqlite' });
    try {
        const tables = await sourceDb.all(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        );
        if (!tables.length) {
            logger.db('SQLite migration source has no user tables. Marking migration complete.');
            await fsp.writeFile(
                SQLITE_MIGRATION_STATE_FILE,
                JSON.stringify({
                    source: SQLITE_MIGRATION_SOURCE_FILE,
                    migratedAt: new Date().toISOString(),
                    tables: 0,
                    rows: 0
                }, null, 2)
            );
            return true;
        }

        logger.db(`Starting SQLite -> MySQL migration from ${SQLITE_MIGRATION_SOURCE_FILE}`);
        await runAsync('SET FOREIGN_KEY_CHECKS = 0');

        const sourceBatchRows = await sourceDb.all('SELECT name FROM batches ORDER BY created_at DESC').catch(() => []);
        for (const batchRow of sourceBatchRows) {
            const batchName = normalizeText(batchRow?.name);
            if (!batchName) {
                continue;
            }
            try {
                await createBatchTable(batchName);
            } catch (error) {
                logger.db(`Batch table prep skipped for ${batchName}: ${String(error?.message || error)}`);
            }
        }

        let migratedTables = 0;
        let migratedRows = 0;

        for (const tableRow of tables) {
            const tableName = normalizeText(tableRow?.name);
            if (!tableName || !isSafeIdentifier(tableName)) {
                continue;
            }

            if (!(await tableExists(tableName))) {
                if (/^batch_.+_students$/.test(tableName)) {
                    await runAsync(`
                        CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
                            student_uid VARCHAR(64) PRIMARY KEY,
                            name VARCHAR(255) NOT NULL,
                            phone VARCHAR(32) NOT NULL,
                            father_name VARCHAR(255),
                            guardian_phone VARCHAR(32),
                            address TEXT,
                            student_class VARCHAR(64),
                            aspiration VARCHAR(255),
                            current_batch VARCHAR(255) NOT NULL,
                            photo_path TEXT,
                            qr_path TEXT,
                            secure_token VARCHAR(64),
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        ) ENGINE=InnoDB
                    `);
                } else {
                    logger.db(`Skipping ${tableName}; destination table is missing and no auto-create rule applies.`);
                    continue;
                }
            }

            const columns = await sourceDb.all(`PRAGMA table_info(${sourceDb.quoteIdentifier(tableName)})`);
            const columnNames = columns
                .map((column) => normalizeText(column?.name))
                .filter((columnName) => columnName && isSafeIdentifier(columnName));

            if (!columnNames.length) {
                continue;
            }

            for (const column of columns) {
                const columnName = normalizeText(column?.name);
                if (!columnName || !isSafeIdentifier(columnName)) {
                    continue;
                }
                await ensureColumn(tableName, columnName, 'TEXT').catch((error) => {
                    logger.db(`Column prep skipped for ${tableName}.${columnName}: ${String(error?.message || error)}`);
                });
            }

            const selectSql = `SELECT ${columnNames.map((columnName) => sourceDb.quoteIdentifier(columnName)).join(', ')} FROM ${sourceDb.quoteIdentifier(tableName)}`;
            const rows = await sourceDb.all(selectSql);
            if (!rows.length) {
                continue;
            }

            await runAsync(`DELETE FROM ${quoteIdentifier(tableName)}`);
            const insertSql = `INSERT INTO ${quoteIdentifier(tableName)} (${columnNames.map((columnName) => quoteIdentifier(columnName)).join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`;
            for (const row of rows) {
                const values = columnNames.map((columnName) => {
                    const value = row[columnName];
                    return value === undefined ? null : value;
                });
                await runAsync(insertSql, values);
            }

            migratedTables += 1;
            migratedRows += rows.length;
            logger.db(`Migrated ${rows.length} rows from ${tableName}`);
        }

        await runAsync('SET FOREIGN_KEY_CHECKS = 1');
        await fsp.writeFile(
            SQLITE_MIGRATION_STATE_FILE,
            JSON.stringify({
                source: SQLITE_MIGRATION_SOURCE_FILE,
                migratedAt: new Date().toISOString(),
                tables: migratedTables,
                rows: migratedRows
            }, null, 2)
        );
        logger.db(`SQLite -> MySQL migration complete. Tables: ${migratedTables}, rows: ${migratedRows}`);
        return true;
    } catch (error) {
        try {
            await runAsync('SET FOREIGN_KEY_CHECKS = 1');
        } catch (_restoreError) {
            // ignore restore errors during failed migration
        }
        throw error;
    } finally {
        await sourceDb.close().catch(() => null);
    }
}

async function createMysqlIndex(sql) {
    try {
        await runAsync(sql);
    } catch (error) {
        const code = String(error?.code || '');
        if (code === 'ER_DUP_KEYNAME' || code === 'ER_DUP_ENTRY') {
            return;
        }
        throw error;
    }
}

async function initDbMysql() {
    await runAsync(`
        CREATE TABLE IF NOT EXISTS master_student_index (
            student_uid VARCHAR(64) PRIMARY KEY,
            batch_name VARCHAR(255) NOT NULL,
            secure_token VARCHAR(64) UNIQUE,
            login_token VARCHAR(64),
            phone VARCHAR(32),
            name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS students (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_uid VARCHAR(64) UNIQUE,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(32) NOT NULL,
            father_name VARCHAR(255),
            guardian_phone VARCHAR(32),
            address TEXT,
            student_class VARCHAR(64),
            aspiration VARCHAR(255),
            current_batch VARCHAR(255),
            photo_path TEXT,
            qr_path TEXT,
            secure_token VARCHAR(64) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(64) UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(32) NOT NULL,
            email VARCHAR(255),
            phone VARCHAR(32),
            staff_token VARCHAR(64),
            full_name VARCHAR(255)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_name VARCHAR(255),
            batch_id VARCHAR(255) NOT NULL,
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            end_time DATETIME,
            status VARCHAR(16) DEFAULT 'active',
            is_late INT DEFAULT 0,
            column_name VARCHAR(255),
            created_by INT,
            INDEX idx_attendance_sessions_batch_status (batch_id, status),
            FOREIGN KEY (created_by) REFERENCES users(id)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS session_students (
            session_id INT NOT NULL,
            student_uid VARCHAR(64) NOT NULL,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(32),
            father_name VARCHAR(255),
            guardian_phone VARCHAR(32),
            address TEXT,
            student_class VARCHAR(64),
            aspiration VARCHAR(255),
            current_batch VARCHAR(255),
            photo_path TEXT,
            qr_path TEXT,
            secure_token VARCHAR(64),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (session_id, student_uid),
            INDEX idx_session_students_session (session_id),
            INDEX idx_session_students_student (student_uid),
            FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_id INT NOT NULL,
            student_uid VARCHAR(64) NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            status INT DEFAULT 1,
            mark_key VARCHAR(255),
            local_session_id VARCHAR(255),
            client_device_id VARCHAR(255),
            UNIQUE KEY uniq_attendance_session_student (session_id, student_uid),
            INDEX idx_attendance_records_session (session_id),
            INDEX idx_attendance_records_student (student_uid),
            FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);
    await ensureOfflineReplaySchema();

    await runAsync(`
        CREATE TABLE IF NOT EXISTS batches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS batch_catalog (
            batch_id INT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            is_active INT NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);
    await createMysqlIndex('CREATE INDEX idx_batch_catalog_active ON batch_catalog(is_active, updated_at)');

    await runAsync(`
        CREATE TABLE IF NOT EXISTS materials (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            file_path TEXT NOT NULL,
            batch_id INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (batch_id) REFERENCES batches(id)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS notices (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            content TEXT,
            target_batch VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_uid VARCHAR(64) NOT NULL,
            title VARCHAR(255),
            notification_type VARCHAR(64),
            content TEXT NOT NULL,
            session_id INT,
            batch_id VARCHAR(255),
            is_read INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_notifications_student_created (student_uid, created_at)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS staff_alerts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            alert_type VARCHAR(64) NOT NULL,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            target_roles VARCHAR(255),
            metadata_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_staff_alerts_created (created_at)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS leads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(32),
            email VARCHAR(255),
            message TEXT,
            source VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_read INT DEFAULT 0,
            id_card_allowed INT DEFAULT 0,
            id_card_allowed_by VARCHAR(255),
            id_card_allowed_at DATETIME,
            father_name VARCHAR(255),
            guardian_phone VARCHAR(32),
            INDEX idx_leads_phone (phone)
        ) ENGINE=InnoDB
    `);
    await runAsync(`
        CREATE TABLE IF NOT EXISTS doubts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_uid VARCHAR(64) NOT NULL,
            student_name VARCHAR(255),
            batch_name VARCHAR(255),
            phone VARCHAR(32),
            question_text TEXT,
            question_image TEXT,
            reply_image TEXT,
            status VARCHAR(32) DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            replied_at DATETIME,
            INDEX idx_doubts_student_created (student_uid, created_at),
            INDEX idx_doubts_status_created (status, created_at)
        ) ENGINE=InnoDB
    `);
    await createMysqlIndex('CREATE INDEX idx_doubts_student_created ON doubts(student_uid, created_at)');
    await createMysqlIndex('CREATE INDEX idx_doubts_status_created ON doubts(status, created_at)');
    await runAsync(`
        CREATE TABLE IF NOT EXISTS id_card_phone_approvals (
            phone VARCHAR(32) PRIMARY KEY,
            approved_by VARCHAR(255),
            approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            student_name VARCHAR(255),
            father_name VARCHAR(255),
            guardian_phone VARCHAR(32),
            INDEX idx_id_card_phone_approvals_approved_at (approved_at)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_uid VARCHAR(64) NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);
    await createMysqlIndex('CREATE UNIQUE INDEX idx_push_subscriptions_endpoint_unique ON push_subscriptions(endpoint(255))');
    await createMysqlIndex('CREATE INDEX idx_push_subscriptions_student ON push_subscriptions(student_uid)');
    await runAsync(`
        CREATE TABLE IF NOT EXISTS mobile_push_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                role VARCHAR(32) NOT NULL,
                owner_key VARCHAR(128) NOT NULL,
                owner_label VARCHAR(255),
                batch_names_json TEXT,
                token VARCHAR(255) NOT NULL,
                push_provider VARCHAR(32) NOT NULL DEFAULT 'expo',
                platform VARCHAR(32),
                device_name VARCHAR(255),
                app_version VARCHAR(32),
                last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_mobile_push_tokens_token (token),
            INDEX idx_mobile_push_tokens_owner (role, owner_key),
            INDEX idx_mobile_push_tokens_seen (last_seen_at)
        ) ENGINE=InnoDB
    `);
    await ensureMobilePushTokenProviderColumn();

    await runAsync(`
        CREATE TABLE IF NOT EXISTS attendance_weekly_reports (
            id INT AUTO_INCREMENT PRIMARY KEY,
            batch_id VARCHAR(255) NOT NULL,
            session_id INT,
            window_start DATETIME NOT NULL,
            window_end DATETIME NOT NULL,
            low_count INT NOT NULL DEFAULT 0,
            total_students INT NOT NULL DEFAULT 0,
            summary TEXT NOT NULL,
            report_json TEXT NOT NULL,
            is_read INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_weekly_reports_batch_created (batch_id, created_at)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_papers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            subject VARCHAR(255) NOT NULL,
            duration_minutes INT NOT NULL DEFAULT 30,
            created_by INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_questions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            paper_id INT NOT NULL,
            question_order INT NOT NULL,
            question_text TEXT NOT NULL,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            option_c TEXT NOT NULL,
            option_d TEXT NOT NULL,
            correct_option VARCHAR(1) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_test_questions_paper_order (paper_id, question_order),
            FOREIGN KEY (paper_id) REFERENCES test_papers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_launches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            paper_id INT NOT NULL,
            batch_name VARCHAR(255) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            scoreboard_published INT NOT NULL DEFAULT 0,
            starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            closes_at DATETIME,
            closed_at DATETIME,
            launched_by INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_test_launches_batch_status (batch_name, status, starts_at),
            FOREIGN KEY (paper_id) REFERENCES test_papers(id) ON DELETE CASCADE,
            FOREIGN KEY (launched_by) REFERENCES users(id)
        ) ENGINE=InnoDB
    `);

    await runAsync(`
        CREATE TABLE IF NOT EXISTS test_submissions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            launch_id INT NOT NULL,
            paper_id INT NOT NULL,
            student_uid VARCHAR(64) NOT NULL,
            student_name VARCHAR(255) NOT NULL,
            batch_name VARCHAR(255) NOT NULL,
            answers_json TEXT NOT NULL,
            score INT NOT NULL DEFAULT 0,
            total_questions INT NOT NULL DEFAULT 0,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_test_submission (launch_id, student_uid),
            INDEX idx_test_submissions_launch_score (launch_id, score, submitted_at),
            INDEX idx_test_submissions_student (student_uid, submitted_at),
            FOREIGN KEY (launch_id) REFERENCES test_launches(id) ON DELETE CASCADE,
            FOREIGN KEY (paper_id) REFERENCES test_papers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);

    await createMysqlIndex('CREATE INDEX idx_master_student_index_token ON master_student_index(secure_token)');
    await createMysqlIndex('CREATE INDEX idx_master_student_index_login_token ON master_student_index(login_token)');
    await createMysqlIndex('CREATE INDEX idx_master_student_index_phone ON master_student_index(phone)');
    await createMysqlIndex('CREATE INDEX idx_users_staff_token ON users(staff_token)');
    await createMysqlIndex('CREATE UNIQUE INDEX idx_master_student_index_phone_unique ON master_student_index(phone)');
    await ensureColumn('doubts', 'student_name', 'VARCHAR(255)');
    await ensureColumn('doubts', 'batch_name', 'VARCHAR(255)');
    await ensureColumn('doubts', 'phone', 'VARCHAR(32)');

    await syncBatchCatalogFromBatches();

    await ensureSystemUsers();

    const usersWithoutToken = await allAsync(
        `SELECT id
         FROM users
         WHERE staff_token IS NULL OR TRIM(staff_token) = ''`
    );
    for (const row of usersWithoutToken) {
        await runAsync('UPDATE users SET staff_token = ? WHERE id = ?', [generateStaffToken(), row.id]);
    }
}

async function resolveBatchName(batchReference) {
    const normalized = normalizeBatchName(batchReference);
    if (!normalized) {
        return null;
    }

    if (/^\d+$/.test(normalized)) {
        const batch = await getAsync('SELECT name FROM batches WHERE id = ?', [Number(normalized)]);
        return batch ? batch.name : null;
    }

    return normalized;
}

async function getSourceStudentRow(studentUid, batchNames) {
    for (const batchName of batchNames) {
        const tableName = getBatchTableName(batchName);
        if (!(await tableExists(tableName))) {
            continue;
        }

        const student = await getAsync(
            `SELECT * FROM ${quoteIdentifier(tableName)} WHERE student_uid = ?`,
            [studentUid]
        );

        if (student) {
            return { batchName, student };
        }
    }

    return null;
}

async function getStudentIndexByUid(studentUid) {
    return getAsync('SELECT * FROM master_student_index WHERE student_uid = ?', [studentUid]);
}

async function hydrateStudent(indexRow, preferredBatch = null) {
    if (!indexRow) {
        return null;
    }

    const batches = splitBatchNames(indexRow.batch_name);
    const prioritized = [];

    if (preferredBatch && batches.includes(preferredBatch)) {
        prioritized.push(preferredBatch);
    }

    prioritized.push(...batches.filter((batchName) => batchName !== preferredBatch));

    for (const batchName of prioritized) {
        const tableName = getBatchTableName(batchName);
        
        // Fast path: check cache first via tableExists
        if (!(await tableExists(tableName))) {
            continue;
        }

        const detail = await getAsync(
            `SELECT * FROM ${quoteIdentifier(tableName)} WHERE student_uid = ?`,
            [indexRow.student_uid]
        );

        if (detail) {
            return {
                ...indexRow,
                ...detail,
                uid: detail.student_uid,
                batch_name: indexRow.batch_name,
                batches,
                system_batches: batches,
                primary_system_batch: batches[0] || null
            };
        }
    }

    return {
        ...indexRow,
        uid: indexRow.student_uid,
        current_batch: preferredBatch || batches[0] || null,
        batches,
        system_batches: batches,
        primary_system_batch: batches[0] || null,
        photo_path: null,
        qr_path: null
    };
}

function summarizeStudentRow(indexRow, preferredBatch = null) {
    if (!indexRow) {
        return null;
    }

    const batches = splitBatchNames(indexRow.batch_name || indexRow.current_batch || '');
    const currentBatch = normalizeText(indexRow.current_batch || preferredBatch || batches[0] || '');

    return {
        id: indexRow.id || null,
        name: indexRow.name || '',
        student_uid: indexRow.student_uid || '',
        uid: indexRow.student_uid || '',
        secure_token: indexRow.secure_token || null,
        phone: indexRow.phone || '',
        father_name: indexRow.father_name || '',
        guardian_phone: indexRow.guardian_phone || '',
        student_class: indexRow.student_class || '',
        aspiration: indexRow.aspiration || '',
        current_batch: currentBatch || null,
        batch_name: indexRow.batch_name || currentBatch || '',
        batches,
        system_batches: batches,
        primary_system_batch: batches[0] || null,
        photo_path: indexRow.photo_path || null,
        qr_path: indexRow.qr_path || null,
        attendance_percent: indexRow.attendance_percent || 0,
        status: indexRow.status || 'active',
        created_at: indexRow.created_at || null
    };
}

function mergeStudentIdentity(indexRow, detailRow, preferredBatch = null) {
    const batches = splitBatchNames(indexRow?.batch_name);
    const detail = detailRow || {};
    return {
        ...(indexRow || {}),
        ...detail,
        uid: detail.student_uid || indexRow?.student_uid || null,
        student_uid: detail.student_uid || indexRow?.student_uid || null,
        batch_name: indexRow?.batch_name || detail.batch_name || '',
        current_batch: detail.current_batch || preferredBatch || batches[0] || null,
        batches,
        system_batches: batches,
        primary_system_batch: batches[0] || null
    };
}

async function fetchAllStudentsDetailed() {
    const rows = await allAsync('SELECT * FROM master_student_index ORDER BY created_at DESC');
    return Promise.all(rows.map((row) => hydrateStudent(row)));
}

async function fetchAllStudentsSummary() {
    const rows = await allAsync('SELECT * FROM master_student_index ORDER BY created_at DESC');
    return rows.map((row) => summarizeStudentRow(row));
}

async function buildStaffBootstrapPayload() {
    const [batches, students, active] = await Promise.all([
        allAsync('SELECT * FROM batches ORDER BY created_at DESC'),
        fetchAllStudentsSummary(),
        getAsync(
            `SELECT * FROM attendance_sessions
             WHERE status = 'active'
             ORDER BY start_time DESC
             LIMIT 1`
        )
    ]);

    const currentSession = active && normalizeBatchName(active.batch_id) ? {
        session_id: active.id,
        session_name: active.session_name,
        batch_id: active.batch_id,
        column_name: active.column_name,
        is_late: active.is_late
    } : null;

    return {
        batches,
        currentSession,
        students
    };
}

async function ensureStudentInBatch(studentUid, batchName) {
    const normalizedBatch = normalizeBatchName(batchName);
    const targetTable = await createBatchTable(normalizedBatch);
    const existing = await getAsync(
        `SELECT student_uid FROM ${quoteIdentifier(targetTable)} WHERE student_uid = ?`,
        [studentUid]
    );

    if (existing) {
        return;
    }

    const indexRow = await getStudentIndexByUid(studentUid);
    if (!indexRow) {
        throw new Error('Student not found.');
    }

    const source = await getSourceStudentRow(studentUid, splitBatchNames(indexRow.batch_name));
    if (!source?.student) {
        throw new Error('Unable to recover student profile data.');
    }

    const student = source.student;
    await runAsync(
        `INSERT OR REPLACE INTO ${quoteIdentifier(targetTable)}
        (student_uid, name, phone, father_name, guardian_phone, address, student_class, aspiration, current_batch, photo_path, qr_path, secure_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            student.student_uid,
            student.name,
            student.phone,
            student.father_name,
            student.guardian_phone,
            student.address,
            student.student_class,
            student.aspiration,
            normalizedBatch,
            student.photo_path,
            student.qr_path,
            student.secure_token
        ]
    );
}

async function removeStudentFromBatch(studentUid, batchName) {
    const normalizedBatch = normalizeBatchName(batchName);
    if (!normalizedBatch) {
        return;
    }

    const tableName = getBatchTableName(normalizedBatch);
    if (!(await tableExists(tableName))) {
        return;
    }

    await runAsync(
        `DELETE FROM ${quoteIdentifier(tableName)} WHERE student_uid = ?`,
        [studentUid]
    );
}

async function upsertStudentIntoBatchTable(batchName, studentRecord) {
    const normalizedBatch = normalizeBatchName(batchName);
    if (!normalizedBatch || !studentRecord?.student_uid) {
        return;
    }

    const tableName = await createBatchTable(normalizedBatch);
    const existing = await getAsync(
        `SELECT student_uid FROM ${quoteIdentifier(tableName)} WHERE student_uid = ?`,
        [studentRecord.student_uid]
    );
    const values = [
        studentRecord.student_uid,
        studentRecord.name,
        studentRecord.phone,
        studentRecord.father_name,
        studentRecord.guardian_phone,
        studentRecord.address,
        studentRecord.student_class,
        studentRecord.aspiration,
        normalizedBatch,
        studentRecord.photo_path,
        studentRecord.qr_path,
        studentRecord.secure_token
    ];

    if (existing) {
        await runAsync(
            `UPDATE ${quoteIdentifier(tableName)}
             SET name = ?,
                 phone = ?,
                 father_name = ?,
                 guardian_phone = ?,
                 address = ?,
                 student_class = ?,
                 aspiration = ?,
                 current_batch = ?,
                 photo_path = ?,
                 qr_path = ?,
                 secure_token = ?
             WHERE student_uid = ?`,
            [
                studentRecord.name,
                studentRecord.phone,
                studentRecord.father_name,
                studentRecord.guardian_phone,
                studentRecord.address,
                studentRecord.student_class,
                studentRecord.aspiration,
                normalizedBatch,
                studentRecord.photo_path,
                studentRecord.qr_path,
                studentRecord.secure_token,
                studentRecord.student_uid
            ]
        );
        return;
    }

    await runAsync(
        `INSERT INTO ${quoteIdentifier(tableName)}
        (student_uid, name, phone, father_name, guardian_phone, address, student_class, aspiration, current_batch, photo_path, qr_path, secure_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values
    );
}

async function findActiveSessionForBatches(batchNames) {
    const normalized = splitBatchNames(batchNames);
    if (normalized.length === 0) {
        return null;
    }

    const placeholders = normalized.map(() => '?').join(', ');
    return getAsync(
        `SELECT * FROM attendance_sessions
         WHERE status = 'active' AND batch_id IN (${placeholders})
         ORDER BY start_time DESC
         LIMIT 1`,
        normalized
    );
}

function isDuplicateAttendanceError(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toUpperCase();
    return (
        code === 'SQLITE_CONSTRAINT'
        || code === 'ER_DUP_ENTRY'
        || message.includes('UNIQUE CONSTRAINT FAILED')
        || message.includes('DUPLICATE ENTRY')
    );
}

async function recordAttendance(sessionRow, studentUid, options = {}) {
    const normalizedUid = normalizeText(studentUid);
    const status = sessionRow.is_late ? 2 : 1;
    const markKey = normalizeText(options.markKey) || buildAttendanceMarkKey(sessionRow.id, normalizedUid);
    const localSessionId = normalizeText(options.localSessionId) || null;
    const clientDeviceId = normalizeText(options.clientDeviceId) || null;

    const existing = await getAsync(
        `SELECT status, timestamp
         FROM attendance_records
         WHERE session_id = ? AND student_uid = ?
         LIMIT 1`,
        [sessionRow.id, normalizedUid]
    );

    if (existing) {
        return {
            inserted: false,
            status: Number(existing.status || 0),
            timestamp: existing.timestamp || null
        };
    }

    try {
        await runAsync(
            `INSERT INTO attendance_records (session_id, student_uid, status, timestamp, mark_key, local_session_id, client_device_id)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
            [sessionRow.id, normalizedUid, status, markKey, localSessionId, clientDeviceId]
        );
    } catch (error) {
        if (!isDuplicateAttendanceError(error)) {
            throw error;
        }
        const row = await getAsync(
            `SELECT status, timestamp
             FROM attendance_records
             WHERE session_id = ? AND student_uid = ?
             LIMIT 1`,
            [sessionRow.id, normalizedUid]
        );
        return {
            inserted: false,
            status: Number(row?.status || 0),
            timestamp: row?.timestamp || null
        };
    }

    broadcastStaffEvent({
        type: 'attendance_marked',
        session_id: sessionRow.id,
        batch_id: sessionRow.batch_id,
        student_uid: normalizedUid,
        status
    });

    return {
        inserted: true,
        status,
        timestamp: null,
        markKey
    };
}

let wss;

function broadcastWs(type, payload) {
    if (!wss) return;
    const message = JSON.stringify({ type, ...payload });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastMessage(payload) {
    // Also broadcast over WebSockets
    broadcastWs(payload.type || 'message', payload);

    if (!liveStreams.size) {
        return;
    }

    const message = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of liveStreams) {
        try {
            res.write(message);
        } catch {
            // Ignore broken streams; they'll be removed on close.
        }
    }
}

function broadcastStaffEvent(payload) {
    if (!payload) return;

    // Also broadcast over WebSockets
    broadcastWs(payload.type || 'staff_event', payload);

    if (!staffLiveStreams.size) {
        return;
    }
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of staffLiveStreams) {
        try {
            res.write(message);
        } catch {
            // Ignore broken streams; they'll be removed on close.
        }
    }
}

function broadcastLeadEvent(payload) {
    if (!payload) return;

    // Also broadcast over WebSockets
    broadcastWs(payload.type || 'lead_event', payload);

    if (!leadStreams.size) {
        return;
    }
    const message = `event: lead\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of leadStreams) {
        try {
            res.write(message);
        } catch {
            // Ignore broken streams; they'll be removed on close.
        }
    }
}

async function sendPushToStudents(studentUids, payload) {
    if (!pushEnabled || !Array.isArray(studentUids) || studentUids.length === 0) {
        return;
    }

    const uniqueUids = [...new Set(studentUids.map((uid) => normalizeText(uid)).filter(Boolean))];
    if (uniqueUids.length === 0) {
        return;
    }

    const placeholders = uniqueUids.map(() => '?').join(', ');
    const subscriptions = await allAsync(
        `SELECT id, endpoint, p256dh, auth
         FROM push_subscriptions
         WHERE student_uid IN (${placeholders})`,
        uniqueUids
    );

    const body = JSON.stringify(payload);
    for (const sub of subscriptions) {
        const subscription = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
        };
        try {
            await webpush.sendNotification(subscription, body, { TTL: 60 });
        } catch (error) {
            const statusCode = Number(error?.statusCode || 0);
            if (statusCode === 404 || statusCode === 410) {
                await runAsync('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]).catch(() => null);
            }
        }
    }
}

function formatSqliteDateTime(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    return value.toISOString().slice(0, 19).replace('T', ' ');
}

function parseDatabaseTimestamp(value) {
    if (!value) {
        return new Date();
    }
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
        return new Date(`${value.replace(' ', 'T')}Z`);
    }
    return new Date(value);
}

function formatDateTimeIST(value) {
    const date = parseDatabaseTimestamp(value);
    if (Number.isNaN(date.getTime())) {
        return new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(date).replace(',', '');
}

function formatDateLabelIST(value) {
    const date = parseDatabaseTimestamp(value);
    if (Number.isNaN(date.getTime())) {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

async function createStudentNotification({ studentUid, title, content, notificationType, sessionId = null, batchId = null }) {
    if (!studentUid || !content) {
        return;
    }

    await runAsync(
        `INSERT INTO notifications (student_uid, title, notification_type, content, session_id, batch_id, is_read)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [
            studentUid,
            title || 'Notification',
            notificationType || 'general',
            content,
            sessionId,
            batchId
        ]
    );
}

async function createStaffAlert({ alertType, title, content, targetRoles = 'teacher,staff', metadata = null }) {
    if (!content) {
        return null;
    }

    const payload = metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : null;
    const result = await runAsync(
        `INSERT INTO staff_alerts (alert_type, title, content, target_roles, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
            alertType || 'general',
            title || 'Alert',
            content,
            targetRoles || 'teacher,staff',
            payload
        ]
    );

    return {
        id: result.lastID,
        alert_type: alertType || 'general',
        title: title || 'Alert',
        content,
        target_roles: targetRoles || 'teacher,staff',
        metadata_json: payload,
        created_at: new Date().toISOString()
    };
}

async function notifyStudentFirstAppLogin(student) {
    if (!student?.student_uid) {
        return false;
    }

    const row = await getAsync(
        `SELECT app_first_login_at, app_first_login_notified_at
         FROM master_student_index
         WHERE student_uid = ?`,
        [student.student_uid]
    );

    if (!row) {
        return false;
    }
    if (row.app_first_login_notified_at) {
        return false;
    }

    if (!row.app_first_login_at) {
        await runAsync(
            `UPDATE master_student_index
             SET app_first_login_at = CURRENT_TIMESTAMP
             WHERE student_uid = ?
               AND app_first_login_at IS NULL`,
            [student.student_uid]
        );
    }

    const batchNames = splitBatchNames(student.batch_name || student.current_batch || '');
    const batchLabel = batchNames.length ? batchNames.join(', ') : (student.current_batch || student.batch_name || 'their batch');
    const title = 'Student opened the app';
    const body = `${student.name || student.student_uid} just logged into the RMC app for the first time${batchLabel ? ` in ${batchLabel}` : ''}.`;

    try {
        const alert = await createStaffAlert({
            alertType: 'student_first_login',
            title,
            content: body,
            targetRoles: 'teacher,staff',
            metadata: {
                student_uid: student.student_uid,
                name: student.name || '',
                batches: batchNames
            }
        });
        broadcastStaffEvent({
            type: 'student_first_login',
            student_uid: student.student_uid,
            name: student.name || '',
            batches: batchNames,
            alert
        });
        await pushMobileNotification({
            role: 'staff',
            title,
            body,
            data: {
                type: 'student_first_login',
                student_uid: student.student_uid,
                batches: batchNames
            }
        });
        await runAsync(
            `UPDATE master_student_index
             SET app_first_login_notified_at = CURRENT_TIMESTAMP
             WHERE student_uid = ?
               AND app_first_login_notified_at IS NULL`,
            [student.student_uid]
        );
        return true;
    } catch (error) {
        console.warn('[FIRST LOGIN] Staff notification failed:', error);
        return false;
    }
}

async function buildWeeklyAttendanceReport(batchNameInput, referenceDate = new Date(), windowDays = 7) {
    const batchName = normalizeBatchName(batchNameInput);
    if (!batchName) {
        return null;
    }

    const windowEnd = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const windowStart = new Date(windowEnd.getTime() - (windowDays * 24 * 60 * 60 * 1000));

    const sessions = (await allAsync(
        `SELECT id, session_name, start_time
         FROM attendance_sessions
         WHERE batch_id = ?
           AND status = 'closed'
         ORDER BY start_time ASC`,
        [batchName]
    )).filter((session) => {
        const startedAt = new Date(session.start_time || 0);
        return !Number.isNaN(startedAt.getTime()) && startedAt >= windowStart && startedAt <= windowEnd;
    });
    const rosterByStudent = new Map();
    for (const session of sessions) {
        const roster = await getSessionRoster(session.id, batchName);
        for (const student of roster) {
            if (!rosterByStudent.has(student.student_uid)) {
                rosterByStudent.set(student.student_uid, student);
            }
        }
    }
    const students = Array.from(rosterByStudent.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    if (sessions.length === 0 || students.length === 0) {
        return {
            batch: batchName,
            window_start: formatSqliteDateTime(windowStart),
            window_end: formatSqliteDateTime(windowEnd),
            sessions: sessions.map((session) => ({
                id: session.id,
                start_time: session.start_time,
                label: `${session.session_name || 'Session'} (${formatDateTimeIST(session.start_time)})`
            })),
            students: students.map((student) => ({
                ...student,
                attendance_percent: 0,
                attendance: {}
            })),
            lowAttendanceStudents: [],
            threshold: 75,
            summary: `No sessions were found in the last ${windowDays} days for ${batchName}.`
        };
    }

    const sessionIds = sessions.map((session) => session.id);
    const placeholders = sessionIds.map(() => '?').join(', ');
    const records = await allAsync(
        `SELECT session_id, student_uid, status
         FROM attendance_records
         WHERE session_id IN (${placeholders})`,
        sessionIds
    );

    const attendanceByStudent = new Map();
    for (const record of records) {
        if (!attendanceByStudent.has(record.student_uid)) {
            attendanceByStudent.set(record.student_uid, new Map());
        }
        attendanceByStudent.get(record.student_uid).set(record.session_id, Number(record.status));
    }

    const normalizedSessions = sessions.map((session) => ({
        id: session.id,
        start_time: session.start_time,
        label: `${session.session_name || 'Session'} (${formatDateTimeIST(session.start_time)})`
    }));

    const enrichedStudents = students.map((student) => {
        const marks = attendanceByStudent.get(student.student_uid) || new Map();
        let presentOrLate = 0;
        const attendance = {};

        for (const session of normalizedSessions) {
            const code = marks.get(session.id) || 0;
            let label = 'Absent';
            if (code === 1) {
                label = 'Present';
                presentOrLate += 1;
            } else if (code === 2) {
                label = 'Late';
                presentOrLate += 1;
            }
            attendance[String(session.id)] = label;
        }

        return {
            ...student,
            attendance_percent: normalizedSessions.length ? Math.round((presentOrLate / normalizedSessions.length) * 100) : 0,
            attendance
        };
    });

    const lowAttendanceStudents = enrichedStudents.filter((student) => student.attendance_percent < 75);

    return {
        batch: batchName,
        window_start: formatSqliteDateTime(windowStart),
        window_end: formatSqliteDateTime(windowEnd),
        sessions: normalizedSessions,
        students: enrichedStudents,
        lowAttendanceStudents,
        threshold: 75,
        summary: `${lowAttendanceStudents.length} students are below 75% attendance in the last ${windowDays} days for ${batchName}.`
    };
}

async function generateAndStoreWeeklyAttendanceReport(sessionRow, sessionId) {
    if (!sessionRow?.batch_id) {
        return null;
    }

    try {
        const weeklyReport = await buildWeeklyAttendanceReport(sessionRow.batch_id, new Date());
        if (!weeklyReport || weeklyReport.lowAttendanceStudents.length === 0) {
            return weeklyReport;
        }

        const reportResult = await runAsync(
            `INSERT INTO attendance_weekly_reports
             (batch_id, session_id, window_start, window_end, low_count, total_students, summary, report_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                weeklyReport.batch,
                sessionId,
                weeklyReport.window_start,
                weeklyReport.window_end,
                weeklyReport.lowAttendanceStudents.length,
                weeklyReport.students.length,
                weeklyReport.summary,
                JSON.stringify(weeklyReport)
            ]
        );

        broadcastMessage({
            type: 'attendance_weekly_report',
            report_id: reportResult.lastID,
            batch: weeklyReport.batch,
            low_count: weeklyReport.lowAttendanceStudents.length,
            summary: weeklyReport.summary
        });

        return weeklyReport;
    } catch (error) {
        console.error('Weekly attendance report generation failed after session close:', error);
        return null;
    }
}

function queueWeeklyAttendanceReportGeneration(sessionRow, sessionId) {
    const tenantKey = getCurrentTenantKey();
    void burstQueue.enqueueBurstJob({
        tenantKey,
        type: 'weekly_attendance_report',
        payload: {
            sessionRow: {
                batch_id: sessionRow?.batch_id || null
            },
            sessionId
        },
        metadata: {
            source: 'attendance-session-close'
        }
    }).catch((error) => {
        console.warn('[BURST] Failed to queue weekly attendance report:', error?.message || error);
    });
}

burstQueue.registerBurstJobHandler('weekly_attendance_report', async (job) => {
    const sessionRow = job?.payload?.sessionRow || null;
    const sessionId = job?.payload?.sessionId || null;
    return generateAndStoreWeeklyAttendanceReport(sessionRow, sessionId);
});

async function getTargetStudentUids(targetBatch) {
    const normalizedTarget = normalizeBatchName(targetBatch);
    if (normalizedTarget === 'ALL') {
        const rows = await allAsync('SELECT student_uid FROM master_student_index');
        return rows.map((row) => row.student_uid);
    }

    const rows = await allAsync('SELECT student_uid, batch_name FROM master_student_index');
    return rows
        .filter((row) => splitBatchNames(row.batch_name).includes(normalizedTarget))
        .map((row) => row.student_uid);
}

async function notifyStudentsByBatch({
    targetBatch,
    title,
    content,
    notificationType = 'general',
    pushTitle = '',
    pushBody = '',
    pushTag = '',
    url = '/student/portal'
}) {
    const resolvedTarget = normalizeBatchName(targetBatch) || targetBatch || 'ALL';
    const targetStudentUids = await getTargetStudentUids(resolvedTarget);
    for (const studentUid of targetStudentUids) {
        await createStudentNotification({
            studentUid,
            title,
            content,
            notificationType,
            batchId: resolvedTarget
        });
    }

    if (targetStudentUids.length > 0 && (pushTitle || pushBody)) {
        await sendPushToStudents(targetStudentUids, {
            title: pushTitle || title || 'RMC Update',
            body: pushBody || content || 'You have a new update.',
            tag: pushTag || `${notificationType}-${Date.now()}`,
            url
        });
    }

    return targetStudentUids;
}

async function countStudentsForBatch(batchName) {
    const normalizedBatch = normalizeBatchName(batchName);
    if (!normalizedBatch) {
        return 0;
    }

    const rows = await allAsync('SELECT batch_name FROM master_student_index');
    return rows.reduce((count, row) => {
        return count + (splitBatchNames(row.batch_name).includes(normalizedBatch) ? 1 : 0);
    }, 0);
}

function normalizeOptionKey(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    return ['A', 'B', 'C', 'D'].includes(normalized) ? normalized : '';
}

function safeParseJson(value, fallback) {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function mapQuestionRow(row, options = {}) {
    const includeCorrect = Boolean(options.includeCorrect);
    return {
        id: row.id,
        order: row.question_order,
        question_text: row.question_text,
        options: {
            A: row.option_a,
            B: row.option_b,
            C: row.option_c,
            D: row.option_d
        },
        ...(includeCorrect ? { correct_option: row.correct_option } : {})
    };
}

async function getTestPaperById(paperId) {
    return getAsync(
        `SELECT p.*,
                COUNT(q.id) AS question_count
         FROM test_papers p
         LEFT JOIN test_questions q ON q.paper_id = p.id
         WHERE p.id = ?
         GROUP BY p.id`,
        [paperId]
    );
}

async function getTestLaunchById(launchId) {
    return getAsync(
        `SELECT l.*,
                p.title AS paper_title,
                p.subject,
                p.duration_minutes,
                COUNT(q.id) AS question_count
         FROM test_launches l
         JOIN test_papers p ON p.id = l.paper_id
         LEFT JOIN test_questions q ON q.paper_id = p.id
         WHERE l.id = ?
         GROUP BY l.id`,
        [launchId]
    );
}

async function getTestQuestionsForPaper(paperId, options = {}) {
    const rows = await allAsync(
        `SELECT id, paper_id, question_order, question_text, option_a, option_b, option_c, option_d, correct_option
         FROM test_questions
         WHERE paper_id = ?
         ORDER BY question_order ASC, id ASC`,
        [paperId]
    );
    return rows.map((row) => mapQuestionRow(row, options));
}

function calculateTestScore(questions, answers) {
    let score = 0;
    for (const question of questions) {
        const selected = normalizeOptionKey(answers?.[question.id]);
        if (selected && selected === normalizeOptionKey(question.correct_option)) {
            score += 1;
        }
    }
    return score;
}

async function getStudentSubmission(launchId, studentUid) {
    return getAsync(
        `SELECT *
         FROM test_submissions
         WHERE launch_id = ? AND student_uid = ?
         LIMIT 1`,
        [launchId, studentUid]
    );
}

async function buildTestScoreboard(launchId) {
    const rows = await allAsync(
        `SELECT student_uid, student_name, batch_name, score, total_questions, submitted_at
         FROM test_submissions
         WHERE launch_id = ?
         ORDER BY score DESC, submitted_at ASC, student_name COLLATE NOCASE ASC`,
        [launchId]
    );

    return rows.map((row, index) => ({
        rank: index + 1,
        student_uid: row.student_uid,
        student_name: row.student_name,
        batch_name: row.batch_name,
        score: row.score,
        total_questions: row.total_questions,
        submitted_at: row.submitted_at
    }));
}

function buildSmsLink(phone, message) {
    const normalizedPhone = String(phone ?? '').replace(/[^\d+]/g, '');
    if (!normalizedPhone) {
        return '';
    }

    const encodedMessage = encodeURIComponent(String(message ?? ''));
    return `sms:${normalizedPhone}?body=${encodedMessage}`;
}

function parseSms8DeviceIds() {
    if (!SMS8_DEVICE_IDS_RAW) {
        return [];
    }

    try {
        const decoded = JSON.parse(SMS8_DEVICE_IDS_RAW);
        if (Array.isArray(decoded)) {
            return decoded.map((item) => String(item ?? '').trim()).filter(Boolean);
        }
        if (typeof decoded === 'string' && decoded.trim()) {
            return decoded.split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean);
        }
    } catch {
        // Fall through to plain parsing.
    }

    return SMS8_DEVICE_IDS_RAW.split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean);
}

function buildSms8Number(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) {
        return '';
    }
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function buildSms8Params(number, message) {
    const params = new URLSearchParams({
        key: SMS8_API_KEY,
        number: buildSms8Number(number),
        message: String(message ?? ''),
        type: SMS8_MESSAGE_TYPE,
        prioritize: SMS8_PRIORITY
    });

    const deviceIds = parseSms8DeviceIds();
    if (deviceIds.length > 0) {
        params.set('devices', deviceIds[0].split('|')[0].trim());
        params.set('useRandomDevice', SMS8_USE_RANDOM_DEVICE ? '1' : '0');
        params.set('option', '0');
    }

    return params;
}

async function sendSms8Message(number, message) {
    if (!SMS8_API_KEY) {
        const error = new Error('SMS8 API key is missing.');
        error.statusCode = 400;
        throw error;
    }

    const params = buildSms8Params(number, message);
    const url = `${SMS8_API_URL}?${params.toString()}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            Referer: 'https://app.sms8.io/',
            Origin: 'https://app.sms8.io'
        }
    });
    const body = await response.text();
    return {
        status: response.status,
        body
    };
}

function renderSmsTemplate(template, context) {
    const base = String(template ?? '').trim();
    if (!base) {
        return '';
    }
    return base.replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (_match, key) => {
        const value = context[key];
        return value === null || value === undefined ? '' : String(value);
    });
}

async function getAbsenteeExportData(sessionId) {
    const normalizedSessionId = Number(sessionId);
    if (!Number.isFinite(normalizedSessionId)) {
        const error = new Error('Valid session id is required.');
        error.statusCode = 400;
        throw error;
    }

    const sessionRow = await getAsync(
        `SELECT id, batch_id, session_name, start_time, end_time, status
         FROM attendance_sessions
         WHERE id = ?`,
        [normalizedSessionId]
    );
    if (!sessionRow) {
        const error = new Error('Attendance session not found.');
        error.statusCode = 404;
        throw error;
    }

    const roster = await getSessionRoster(sessionRow.id, sessionRow.batch_id);
    const presentRows = await allAsync(
        `SELECT student_uid
         FROM attendance_records
         WHERE session_id = ?`,
        [sessionRow.id]
    );
    const presentSet = new Set(presentRows.map((row) => normalizeText(row.student_uid)));
    const absentees = roster
        .filter((student) => !presentSet.has(normalizeText(student.student_uid)))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    const sessionLabel = sessionRow.session_name || 'Attendance Session';
    const sessionDate = formatDateTimeIST(sessionRow.start_time || Date.now());

    return {
        session: {
            id: sessionRow.id,
            batch_id: sessionRow.batch_id,
            session_name: sessionLabel,
            start_time: sessionRow.start_time,
            end_time: sessionRow.end_time,
            status: sessionRow.status,
            label: `${sessionLabel} (${sessionDate})`
        },
        absentees: absentees.map((student) => {
            const message = `Your child was absent on ${sessionDate} in batch ${sessionRow.batch_id} during ${sessionLabel}. Please contact RMC if this was marked incorrectly.`;
            return {
                ...student,
                message,
                sms_link: buildSmsLink(student.guardian_phone || student.phone, message)
            };
        })
    };
}

function buildAttendanceSmsMessage({
    name,
    batch,
    className,
    sessionName,
    sessionDate,
    status,
    arrivalTime
}) {
    const safeName = String(name || 'Student').trim();
    const safeBatch = String(batch || '').trim();
    const safeClass = String(className || '').trim();
    const safeSession = String(sessionName || '').trim();
    const safeDate = String(sessionDate || '').trim();
    const safeStatus = String(status || '').trim();
    const safeArrival = String(arrivalTime || '').trim();

    if (safeStatus.toLowerCase() === 'late') {
        return `Hello ${safeName}, you arrived late for ${safeSession || 'class'} in batch ${safeBatch || '-'}` +
            `${safeDate ? ` on ${safeDate}` : ''}. Class: ${safeClass || '-'}. Arrival time: ${safeArrival || 'N/A'}.`;
    }

    if (safeStatus.toLowerCase() === 'present') {
        return `Hello ${safeName}, this is a batch update for ${safeSession || 'your class'} in batch ${safeBatch || '-'}` +
            `${safeDate ? ` on ${safeDate}` : ''}. Class: ${safeClass || '-'}.`;
    }

    if (safeStatus.toLowerCase() === 'batch update' || safeStatus.toLowerCase() === 'broadcast') {
        return `Hello ${safeName}, this is an update for batch ${safeBatch || '-'}` +
            `${safeSession ? ` regarding ${safeSession}` : ''}. Class: ${safeClass || '-'}.`;
    }

    return `Hello ${safeName}, you were absent for ${safeSession || 'class'} in batch ${safeBatch || '-'}` +
        `${safeDate ? ` on ${safeDate}` : ''}. Class: ${safeClass || '-'}.`;
}

function pickSmsRecipientPhone(student, recipientMode = 'guardian') {
    const mode = String(recipientMode || 'guardian').trim().toLowerCase();
    if (mode === 'student') {
        return normalizeApprovalPhone(student?.phone || '');
    }

    return normalizeApprovalPhone(
        student?.guardian_phone ||
        student?.father_phone ||
        student?.parent_phone ||
        student?.phone ||
        ''
    );
}

function buildRecipientPreview(student, recipientPhone, message, extra = {}) {
    return {
        student_uid: student?.student_uid || '',
        name: student?.name || '',
        batch_name: student?.batch_name || student?.batch || extra.batch_name || '',
        class_name: student?.student_class || student?.class_name || '',
        recipient_phone: recipientPhone || '',
        message,
        status: extra.status || '',
        arrival_time: extra.arrival_time || '',
        session_id: extra.session_id || null,
        session_name: extra.session_name || '',
        sms_link: buildSmsLink(recipientPhone, message)
    };
}

function normalizeRecipientList(recipients) {
    const seen = new Set();
    const list = [];
    for (const recipient of recipients || []) {
        const phone = normalizeApprovalPhone(recipient?.recipient_phone || recipient?.phone || '');
        if (!phone || seen.has(phone)) {
            continue;
        }
        seen.add(phone);
        list.push({
            ...recipient,
            recipient_phone: phone
        });
    }
    return list;
}

async function buildSmsAudienceFromSession(sessionId, statusFilter, recipientMode) {
    const normalizedSessionId = Number(sessionId);
    if (!Number.isFinite(normalizedSessionId)) {
        const error = new Error('Valid session id is required.');
        error.statusCode = 400;
        throw error;
    }

    const sessionRow = await getAsync(
        `SELECT id, batch_id, session_name, start_time, status
         FROM attendance_sessions
         WHERE id = ?`,
        [normalizedSessionId]
    );
    if (!sessionRow) {
        const error = new Error('Session not found.');
        error.statusCode = 404;
        throw error;
    }

    const roster = await getSessionRoster(sessionRow.id, sessionRow.batch_id);
    const attendanceRows = await allAsync(
        `SELECT student_uid, status, timestamp
         FROM attendance_records
         WHERE session_id = ?`,
        [sessionRow.id]
    );
    const attendanceByUid = new Map(
        attendanceRows.map((row) => [
            normalizeText(row.student_uid),
            {
                status: Number(row.status || 0),
                timestamp: row.timestamp || null
            }
        ])
    );

    const filters = new Set(
        String(statusFilter || 'absent,late')
            .split(',')
            .map((item) => normalizeText(item).toLowerCase())
            .filter(Boolean)
    );
    if (filters.size === 0) {
        filters.add('absent');
        filters.add('late');
    }

    const sessionDate = formatDateLabelIST(sessionRow.start_time || Date.now());

    const recipients = [];
    for (const student of roster) {
        const attendance = attendanceByUid.get(normalizeText(student.student_uid)) || { status: 0, timestamp: null };
        const status = Number(attendance.status || 0);
        const label = status === 1 ? 'Present' : (status === 2 ? 'Late' : 'Absent');
        const include =
            filters.has('all') ||
            (status === 0 && filters.has('absent')) ||
            (status === 2 && filters.has('late')) ||
            (status === 1 && filters.has('present'));

        if (!include) {
            continue;
        }

        const recipientPhone = pickSmsRecipientPhone(student, recipientMode);
        const message = buildAttendanceSmsMessage({
            name: student.name || 'Student',
            batch: student.batch_name || sessionRow.batch_id,
            className: student.student_class || student.class_name || '',
            sessionName: sessionRow.session_name || 'attendance session',
            sessionDate,
            status: label,
            arrivalTime: attendance.timestamp || ''
        });

        recipients.push(buildRecipientPreview(student, recipientPhone, message, {
            status: label,
            arrival_time: attendance.timestamp || '',
            session_id: sessionRow.id,
            session_name: sessionRow.session_name || ''
        }));
    }

    return {
        source: 'session',
        title: `${sessionRow.batch_id} - ${sessionRow.session_name || 'Session'}`,
        session: sessionRow,
        recipients: normalizeRecipientList(recipients),
        skipped: recipients.filter((item) => !item.recipient_phone).length
    };
}

async function buildSmsAudienceFromBatch(batchNameInput, recipientMode) {
    const batchName = await resolveBatchName(batchNameInput);
    if (!batchName) {
        const error = new Error('Valid batch name is required.');
        error.statusCode = 400;
        throw error;
    }

    const report = await getBatchReportData(batchName);
    const recipients = (report.students || []).map((student) => {
        const recipientPhone = pickSmsRecipientPhone(student, recipientMode);
        const message = buildAttendanceSmsMessage({
            name: student.name || 'Student',
            batch: batchName,
            className: student.student_class || student.class_name || '',
            sessionName: '',
            sessionDate: '',
            status: 'Batch Update',
            arrivalTime: ''
        });
        return buildRecipientPreview(student, recipientPhone, message, {
            status: 'Batch Update'
        });
    });

    return {
        source: 'batch',
        title: batchName,
        recipients: normalizeRecipientList(recipients),
        skipped: recipients.filter((item) => !item.recipient_phone).length
    };
}

async function buildSmsAudienceAllStudents(recipientMode) {
    const students = await fetchAllStudentsDetailed();
    const recipients = students.map((student) => {
        const recipientPhone = pickSmsRecipientPhone(student, recipientMode);
        const message = buildAttendanceSmsMessage({
            name: student.name || 'Student',
            batch: student.batch_name || '',
            className: student.student_class || student.class_name || '',
            sessionName: '',
            sessionDate: '',
            status: 'Broadcast',
            arrivalTime: ''
        });
        return buildRecipientPreview(student, recipientPhone, message, {
            status: 'Broadcast'
        });
    });

    return {
        source: 'all',
        title: 'All Students',
        recipients: normalizeRecipientList(recipients),
        skipped: recipients.filter((item) => !item.recipient_phone).length
    };
}

async function buildSmsAudienceCustom(numbersText, messageTemplate) {
    const rawNumbers = String(numbersText || '')
        .split(/[\n,;]+/)
        .map((value) => normalizeApprovalPhone(value))
        .filter(Boolean);
    const unique = [...new Set(rawNumbers)];
    const recipients = unique.map((phone) => ({
        student_uid: '',
        name: '',
        batch_name: '',
        class_name: '',
        recipient_phone: phone,
        message: String(messageTemplate || ''),
        status: 'Custom',
        arrival_time: '',
        session_id: null,
        session_name: '',
        sms_link: buildSmsLink(phone, String(messageTemplate || ''))
    }));
    return {
        source: 'custom',
        title: 'Custom Numbers',
        recipients,
        skipped: 0
    };
}

function canStudentAccessBatch(studentSession, batchName) {
    const batches = getStudentSessionBatches(studentSession);
    return batches.includes(normalizeBatchName(batchName));
}

async function buildStudentTestDashboard(studentSession) {
    const studentUid = normalizeText(studentSession?.student_uid);
    const studentBatches = getStudentSessionBatches(studentSession);
    if (!studentUid || studentBatches.length === 0) {
        return {
            upcoming: [],
            history: [],
            scoreboard_tests: []
        };
    }

    const placeholders = studentBatches.map(() => '?').join(', ');
    const rows = await allAsync(
        `SELECT l.id,
                l.paper_id,
                l.batch_name,
                l.status,
                l.scoreboard_published,
                l.starts_at,
                l.closes_at,
                l.closed_at,
                p.title,
                p.subject,
                p.duration_minutes,
                COUNT(q.id) AS question_count,
                s.score,
                s.total_questions,
                s.submitted_at
         FROM test_launches l
         JOIN test_papers p ON p.id = l.paper_id
         LEFT JOIN test_questions q ON q.paper_id = p.id
         LEFT JOIN test_submissions s
           ON s.launch_id = l.id
          AND s.student_uid = ?
         WHERE l.batch_name IN (${placeholders})
         GROUP BY l.id
         ORDER BY COALESCE(l.starts_at, l.created_at) DESC, l.id DESC`,
        [studentUid, ...studentBatches]
    );

    const upcoming = [];
    const history = [];
    const scoreboardTests = [];

    for (const row of rows) {
        const entry = {
            launch_id: row.id,
            paper_id: row.paper_id,
            batch_name: row.batch_name,
            title: row.title,
            subject: row.subject,
            duration_minutes: row.duration_minutes,
            question_count: Number(row.question_count || 0),
            status: row.status,
            starts_at: row.starts_at,
            closes_at: row.closes_at,
            closed_at: row.closed_at,
            submitted: Boolean(row.submitted_at),
            submitted_at: row.submitted_at || null,
            score: row.score,
            total_questions: row.total_questions,
            scoreboard_published: Number(row.scoreboard_published || 0) === 1
        };

        if ((row.status === 'active' || row.status === 'scheduled') && !row.submitted_at) {
            upcoming.push(entry);
        }

        if (row.submitted_at) {
            history.push(entry);
        }

        if (Number(row.scoreboard_published || 0) === 1) {
            scoreboardTests.push({
                launch_id: row.id,
                title: row.title,
                subject: row.subject,
                batch_name: row.batch_name,
                scoreboard_published: Number(row.scoreboard_published || 0) === 1,
                closed_at: row.closed_at,
                submitted: Boolean(row.submitted_at)
            });
        }
    }

    return {
        upcoming,
        history,
        scoreboard_tests: scoreboardTests
    };
}

async function isPhoneApprovedForIdCard(source = {}) {
    const requestedSignature = getIdApprovalSignature(source);
    if (!requestedSignature.phone) {
        return false;
    }

    const approvedLeadRow = await getAsync(
        `SELECT id, phone, father_name, guardian_phone
         FROM leads
         WHERE phone = ?
           AND id_card_allowed = 1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [requestedSignature.phone]
    );
    if (approvedLeadRow && canReuseApprovalForRequest(approvedLeadRow, requestedSignature)) {
        return true;
    }

    const row = await getAsync(
        `SELECT phone, father_name, guardian_phone
         FROM id_card_phone_approvals
         WHERE phone = ?
         LIMIT 1`,
        [requestedSignature.phone]
    );

    return canReuseApprovalForRequest(row, requestedSignature);
}

async function revokePhoneIdCardApproval(phone) {
    const normalizedPhone = normalizeText(phone);
    if (!normalizedPhone) {
        return;
    }

    await runAsync(
        `DELETE FROM id_card_phone_approvals
         WHERE phone = ?`,
        [normalizedPhone]
    );

    await runAsync(
        `UPDATE leads
         SET id_card_allowed = 0,
             id_card_allowed_by = NULL,
             id_card_allowed_at = NULL
         WHERE phone = ?`,
        [normalizedPhone]
    );
}

function normalizeIdApprovalField(value) {
    return normalizeText(value || '');
}

function getIdApprovalSignature(source = {}) {
    return {
        phone: normalizeApprovalPhone(source.phone),
        student_name: normalizeApprovalName(source.name || source.student_name),
        father_name: normalizeApprovalName(source.father_name),
        guardian_phone: normalizeApprovalPhone(source.guardian_phone)
    };
}

function doesApprovalSignatureMatch(approvalRow = {}, requestedSignature = {}) {
    const approval = approvalRow || {};
    const request = requestedSignature || {};
    const approvalPhone = normalizeIdApprovalField(approval.phone);
    const requestPhone = normalizeIdApprovalField(request.phone);
    if (!approvalPhone || !requestPhone || approvalPhone !== requestPhone) {
        return false;
    }

    const approvalFather = normalizeApprovalName(approval.father_name);
    const approvalGuardian = normalizeApprovalPhone(approval.guardian_phone);
    const requestFather = normalizeApprovalName(request.father_name);
    const requestGuardian = normalizeApprovalPhone(request.guardian_phone);

    if (!approvalFather && !approvalGuardian) {
        return true;
    }

    if (approvalFather && approvalFather !== requestFather) {
        return false;
    }

    if (approvalGuardian && approvalGuardian !== requestGuardian) {
        return false;
    }

    return true;
}

function canReuseApprovalForRequest(approvalRow = {}, requestedSignature = {}) {
    const approval = approvalRow || {};
    const request = requestedSignature || {};
    const requestedFather = normalizeApprovalName(request.father_name);
    const requestedGuardian = normalizeApprovalPhone(request.guardian_phone);
    if (!requestedFather && !requestedGuardian) {
        return Boolean(approval.phone);
    }
    return doesApprovalSignatureMatch(approval, request);
}

async function grantPhoneIdCardApproval(lead, approvedBy) {
    const normalizedPhone = normalizeText(lead?.phone);
    const normalizedApprovedBy = normalizeText(approvedBy) || 'staff';
    if (!normalizedPhone) {
        return;
    }

    const leadId = Number(lead?.id);
    const normalizedStudentName = normalizeText(lead?.name);
    const normalizedFatherName = normalizeText(lead?.father_name);
    const normalizedGuardianPhone = normalizeText(lead?.guardian_phone);

    if (DB_DIALECT === 'mysql') {
        await runAsync(
            `INSERT INTO id_card_phone_approvals (phone, approved_by, approved_at, student_name, father_name, guardian_phone)
             VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 approved_by = VALUES(approved_by),
                 approved_at = CURRENT_TIMESTAMP,
                 student_name = VALUES(student_name),
                 father_name = VALUES(father_name),
                 guardian_phone = VALUES(guardian_phone)`,
            [normalizedPhone, normalizedApprovedBy, normalizedStudentName, normalizedFatherName, normalizedGuardianPhone]
        );
    } else {
        await runAsync(
            `INSERT INTO id_card_phone_approvals (phone, approved_by, approved_at, student_name, father_name, guardian_phone)
             VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
             ON CONFLICT(phone) DO UPDATE SET
                 approved_by = excluded.approved_by,
                 approved_at = CURRENT_TIMESTAMP,
                 student_name = excluded.student_name,
                 father_name = excluded.father_name,
                 guardian_phone = excluded.guardian_phone`,
            [normalizedPhone, normalizedApprovedBy, normalizedStudentName, normalizedFatherName, normalizedGuardianPhone]
        );
    }

    await runAsync(
        `UPDATE leads
         SET id_card_allowed = 1,
             id_card_allowed_by = ?,
             id_card_allowed_at = CURRENT_TIMESTAMP
         WHERE ${Number.isFinite(leadId) ? 'id = ?' : 'phone = ?'}
           ${Number.isFinite(leadId) ? '' : 'AND (father_name IS NULL OR father_name = ? OR father_name = \'\') AND (guardian_phone IS NULL OR guardian_phone = ? OR guardian_phone = \'\')'}`,
        Number.isFinite(leadId)
            ? [normalizedApprovedBy, leadId]
            : [normalizedApprovedBy, normalizedPhone, normalizedFatherName, normalizedGuardianPhone]
    );
}

function getIdCardRequestExpiryCutoff() {
    return new Date(Date.now() - (2 * 24 * 60 * 60 * 1000))
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
}

async function purgeExpiredIdCardRequests() {
    await runAsync(
        `DELETE FROM leads
         WHERE source = 'id_card_permission_request'
           AND created_at < ?`,
        [getIdCardRequestExpiryCutoff()]
    );
}

async function verifyStudentToken(rawToken) {
    const token = extractToken(rawToken);
    if (!token) {
        return null;
    }

    const indexRow = await getAsync(
        'SELECT * FROM master_student_index WHERE secure_token = ?',
        [token]
    );

    if (!indexRow) {
        return null;
    }

    const batchNames = splitBatchNames(indexRow.batch_name);
    const activeSession = await findActiveSessionForBatches(batchNames);
    const preferredBatch = activeSession?.batch_id || batchNames[0] || null;

    if (preferredBatch) {
        await ensureStudentInBatch(indexRow.student_uid, preferredBatch);
    }

    const student = await hydrateStudent(indexRow, preferredBatch);
    if (!student) {
        return null;
    }

    if (activeSession) {
        await recordAttendance(activeSession, student.student_uid);
    }

    return student;
}

async function verifyStudentForSession(rawToken, requestedSessionId, requestedBatchName) {
    const token = extractToken(rawToken);
    if (!token) {
        return { ok: false, statusCode: 400, error: 'Missing token.' };
    }

    const sessionId = Number(requestedSessionId);
    if (!Number.isFinite(sessionId)) {
        return { ok: false, statusCode: 400, error: 'A valid active session is required.' };
    }

    const sessionRow = await getAsync(
        `SELECT * FROM attendance_sessions
         WHERE id = ? AND status = 'active'
         LIMIT 1`,
        [sessionId]
    );

    if (!sessionRow) {
        return { ok: false, statusCode: 404, error: 'The selected attendance session is no longer active.' };
    }

    const expectedBatch = normalizeBatchName(requestedBatchName) || normalizeBatchName(sessionRow.batch_id);
    if (expectedBatch && normalizeBatchName(sessionRow.batch_id) !== expectedBatch) {
        return { ok: false, statusCode: 409, error: 'Scanner batch and active session batch do not match.' };
    }

    const indexRow = await getAsync(
        'SELECT * FROM master_student_index WHERE secure_token = ?',
        [token]
    );

    if (!indexRow) {
        return { ok: false, statusCode: 404, error: 'Token not found or expired.' };
    }

    const snapshotStudent = await getAsync(
        `SELECT *
         FROM session_students
         WHERE session_id = ? AND student_uid = ?`,
        [sessionRow.id, indexRow.student_uid]
    );
    const batchNames = splitBatchNames(indexRow.batch_name);
    if (!snapshotStudent && !batchNames.includes(normalizeBatchName(sessionRow.batch_id))) {
        return {
            ok: false,
            statusCode: 403,
            error: `${indexRow.name || 'This student'} is not assigned to ${sessionRow.batch_id}.`
        };
    }

    if (!snapshotStudent) {
        await ensureStudentInBatch(indexRow.student_uid, sessionRow.batch_id);
    }

    const student = snapshotStudent
        ? mergeStudentIdentity(indexRow, snapshotStudent, sessionRow.batch_id)
        : await hydrateStudent(indexRow, sessionRow.batch_id);
    if (!student) {
        return { ok: false, statusCode: 404, error: 'Student profile data is missing.' };
    }

    const attendance = await recordAttendance(sessionRow, student.student_uid);
    return {
        ok: true,
        student,
        session: sessionRow,
        alreadyMarked: !attendance.inserted,
        attendanceStatus: attendance.status
    };
}

async function getStudentByTokenForPortal(rawToken) {
    const token = extractToken(rawToken);
    if (!token) {
        return null;
    }

    const indexRow = await getAsync(
        'SELECT * FROM master_student_index WHERE secure_token = ?',
        [token]
    );
    if (!indexRow) {
        return null;
    }

    const student = await hydrateStudent(indexRow);
    if (!student) {
        return null;
    }

    return {
        ...student,
        batches: splitBatchNames(indexRow.batch_name)
    };
}

async function getStudentSessionByRememberToken(rawToken) {
    const token = extractToken(rawToken);
    if (!token) {
        return null;
    }
    if (!isDatabaseReady()) {
        return null;
    }

    const indexRow = await getAsync(
        `SELECT *
         FROM master_student_index
         WHERE login_token = ? OR secure_token = ?
         LIMIT 1`,
        [token, token]
    );
    if (!indexRow) {
        return null;
    }

    const student = await hydrateStudent(indexRow);
    if (!student) {
        return null;
    }

    return {
        ...student,
        batches: splitBatchNames(indexRow.batch_name)
    };
}

async function listMaterials() {
    const rows = await allAsync(`
        SELECT m.*, b.name AS batch_name
        FROM materials m
        LEFT JOIN batches b ON m.batch_id = b.id
        ORDER BY m.created_at DESC
    `);
    return Promise.all(rows.map(enrichMaterialRecord));
}

async function resolveMaterialBatchId(batchReference) {
    const ref = normalizeText(batchReference);
    if (!ref) {
        return null;
    }

    // Prefer numeric id when present.
    const numeric = Number(ref);
    if (Number.isFinite(numeric) && numeric > 0) {
        const byId = await getAsync('SELECT id, name FROM batches WHERE id = ?', [numeric]);
        return byId ? Number(byId.id) : null;
    }

    // Fallback to batch name for compatibility with older clients.
    const name = await resolveBatchName(ref);
    if (!name) {
        return null;
    }
    const byName = await getAsync('SELECT id, name FROM batches WHERE name = ?', [name]);
    return byName ? Number(byName.id) : null;
}

async function enrichMaterialRecord(material) {
    const rawPath = normalizeText(material?.file_path);
    let accessMode = 'missing';
    let downloadPath = '';

    if (rawPath.startsWith('/materials/')) {
        const diskPath = resolveMaterialDiskPath(rawPath);
        if (await fileExists(diskPath)) {
            accessMode = 'download';
            downloadPath = `/api/materials/${material.id}/download`;
        }
    } else if (isAbsoluteFilePath(rawPath)) {
        if (await fileExists(rawPath)) {
            accessMode = 'download';
            downloadPath = `/api/materials/${material.id}/download`;
        }
    } else if (isExternalUrl(rawPath)) {
        accessMode = 'view';
    }

    return {
        ...material,
        file_path: rawPath,
        access_mode: accessMode,
        download_path: downloadPath
    };
}

async function updateMasterBatchReferences(oldName, newName) {
    const affectedRows = await allAsync(
        'SELECT student_uid, batch_name FROM master_student_index WHERE batch_name LIKE ?',
        [`%${oldName}%`]
    );

    for (const row of affectedRows) {
        const updated = splitBatchNames(row.batch_name).map((batchName) => (
            batchName === oldName ? newName : batchName
        ));
        await runAsync(
            'UPDATE master_student_index SET batch_name = ? WHERE student_uid = ?',
            [joinBatchNames(updated), row.student_uid]
        );
    }
}

async function removeBatchFromMasterIndex(batchName) {
    const affectedRows = await allAsync(
        'SELECT student_uid, batch_name FROM master_student_index WHERE batch_name LIKE ?',
        [`%${batchName}%`]
    );

    for (const row of affectedRows) {
        const remaining = splitBatchNames(row.batch_name).filter((name) => name !== batchName);
        if (remaining.length === 0) {
            await runAsync('DELETE FROM master_student_index WHERE student_uid = ?', [row.student_uid]);
        } else {
            await runAsync(
                'UPDATE master_student_index SET batch_name = ? WHERE student_uid = ?',
                [joinBatchNames(remaining), row.student_uid]
            );
        }
    }
}

async function safelyDeleteFile(filePath) {
    if (!filePath) {
        return;
    }

    try {
        await fsp.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`File cleanup skipped for ${filePath}: ${error.message}`);
        }
    }
}

function escapeCsv(value) {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) {
        return text;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function columnNumberToName(columnNumber) {
    let n = Number(columnNumber) || 1;
    let name = '';
    while (n > 0) {
        const remainder = (n - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        n = Math.floor((n - 1) / 26);
    }
    return name || 'A';
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dateToDosParts(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = ((date.getHours() & 0x1f) << 11)
        | ((date.getMinutes() & 0x3f) << 5)
        | Math.floor(date.getSeconds() / 2);
    const dosDate = (((year - 1980) & 0x7f) << 9)
        | ((date.getMonth() + 1) << 5)
        | (date.getDate() & 0x1f);
    return { dosTime, dosDate };
}

function buildXlsxSheetXml(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const maxColumns = safeRows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 1);
    const lastColumn = columnNumberToName(maxColumns);
    const lastRow = Math.max(safeRows.length, 1);
    const xmlRows = safeRows.length
        ? safeRows.map((row, rowIndex) => {
            const cells = (Array.isArray(row) ? row : []).map((cell, cellIndex) => {
                const ref = `${columnNumberToName(cellIndex + 1)}${rowIndex + 1}`;
                if (cell && typeof cell === 'object' && cell.type === 'number') {
                    return `<c r="${ref}"><v>${Number(cell.value) || 0}</v></c>`;
                }
                const value = cell && typeof cell === 'object' ? cell.value : cell;
                return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
            }).join('');
            return `<row r="${rowIndex + 1}">${cells}</row>`;
        }).join('')
        : '<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve"></t></is></c></row>';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumn}${lastRow}" />
  <sheetData>${xmlRows}</sheetData>
</worksheet>`;
}

function buildXlsxWorkbookXml(sheetNames) {
    const sheets = (sheetNames || []).map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

function buildXlsxWorkbookRelsXml(sheetCount) {
    const relationships = Array.from({ length: sheetCount }, (_unused, index) => (
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildXlsxRootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildXlsxContentTypesXml(sheetCount) {
    const overrides = Array.from({ length: sheetCount }, (_unused, index) => (
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${overrides}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function buildXlsxStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font>
      <sz val="11"/><color rgb="FF1A2B1D"/><name val="Calibri"/><family val="2"/>
    </font>
  </fonts>
  <fills count="1">
    <fill><patternFill patternType="none"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
</styleSheet>`;
}

function buildStoredZip(entries) {
    const files = Array.isArray(entries) ? entries : [];
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of files) {
        const nameBuffer = Buffer.from(String(entry.name || '').replace(/\\/g, '/'), 'utf8');
        const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
        const { dosTime, dosDate } = dateToDosParts(entry.date instanceof Date ? entry.date : new Date());
        const crc = crc32(dataBuffer);
        const size = dataBuffer.length;

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(size, 18);
        localHeader.writeUInt32LE(size, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuffer, dataBuffer);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(dosTime, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(size, 20);
        centralHeader.writeUInt32LE(size, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuffer);
        offset += localHeader.length + nameBuffer.length + dataBuffer.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(files.length, 8);
    endRecord.writeUInt16LE(files.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(offset, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

async function writeAttendanceWorkbookExport(session, absentees, lateStudents) {
    const sessionLabel = String(session?.session_name || 'Attendance Session').trim();
    const batchLabel = String(session?.batch_id || 'Batch').trim();
    const fileName = 'latest_attendance_export.xlsx';
    const filePath = path.join(getAttendanceExportFolder(), fileName);
    const roster = await getSessionRoster(session?.id, session?.batch_id);
    const presentRows = await allAsync(
        `SELECT student_uid, timestamp, status
         FROM attendance_records
         WHERE session_id = ?`,
        [session?.id]
    );
    const attendanceMap = new Map();
    for (const row of presentRows) {
        attendanceMap.set(normalizeText(row.student_uid), {
            timestamp: row.timestamp || '',
            status: Number(row.status) === 2 ? 'Late' : 'Present'
        });
    }
    const lateCount = Array.isArray(lateStudents) ? lateStudents.length : 0;
    const absentCount = Array.isArray(absentees) ? absentees.length : 0;

    const sheetRows = [
        ['RMC Attendance Follow-up Export'],
        ['Session ID', session?.id || '-'],
        ['Batch', batchLabel],
        ['Session Name', sessionLabel],
        ['Status', session?.status || '-'],
        ['Started At', session?.start_time || '-'],
        ['Ended At', session?.end_time || '-'],
        ['Late Count', lateCount],
        ['Absent Count', absentCount],
        ['Generated At', new Date().toISOString()],
        [],
        ['S No', 'UID', 'Name', 'Batch', 'Class', 'Student Phone', 'Father Name', 'Guardian Phone', 'Status', 'Arrival Time', 'Session Date', 'Automated Message', 'SMS Link']
    ];

    const sessionDate = formatDateTimeIST(session?.start_time || Date.now());

    const followUpStudents = roster.filter((student) => {
        const record = attendanceMap.get(normalizeText(student.student_uid));
        return !record || record.status === 'Late';
    });

    followUpStudents.forEach((student, index) => {
        const record = attendanceMap.get(normalizeText(student.student_uid));
        const isLate = Boolean(record && record.status === 'Late');
        const statusLabel = isLate ? 'Late' : 'Absent';
        const arrivalTime = isLate && record.timestamp ? formatDateTimeIST(record.timestamp) : '';
        const message = isLate
            ? `Hello ${student.name || 'Student'}, you arrived late for ${sessionLabel} in batch ${batchLabel} on ${sessionDate}. Class: ${student.student_class || '-'}. Arrival time: ${arrivalTime || 'N/A'}.`
            : `Hello ${student.name || 'Student'}, your ward was absent for ${sessionLabel} in batch ${batchLabel} on ${sessionDate}. Class: ${student.student_class || '-'}.`;

        sheetRows.push([
            index + 1,
            student.student_uid || '-',
            student.name || '-',
            student.current_batch || batchLabel,
            student.student_class || '-',
            student.phone || '-',
            student.father_name || '-',
            student.guardian_phone || '-',
            statusLabel,
            arrivalTime || '-',
            sessionDate,
            message,
            buildSmsLink(student.guardian_phone || student.phone, message)
        ]);
    });

    const zipBuffer = buildStoredZip([
        { name: '[Content_Types].xml', data: buildXlsxContentTypesXml(1) },
        { name: '_rels/.rels', data: buildXlsxRootRelsXml() },
        { name: 'xl/workbook.xml', data: buildXlsxWorkbookXml(['Attendance Follow-up']) },
        { name: 'xl/_rels/workbook.xml.rels', data: buildXlsxWorkbookRelsXml(1) },
        { name: 'xl/styles.xml', data: buildXlsxStylesXml() },
        { name: 'xl/worksheets/sheet1.xml', data: buildXlsxSheetXml(sheetRows) }
    ]);

    await fsp.writeFile(filePath, zipBuffer);
    const manifest = {
        file_name: fileName,
        file_path: filePath,
        session_id: session?.id || null,
        session_label: sessionLabel,
        batch_label: batchLabel,
        generated_at: new Date().toISOString()
    };
  await fsp.writeFile(path.join(getAttendanceExportFolder(), 'latest.json'), JSON.stringify(manifest, null, 2));
  return {
      fileName,
      filePath,
      sessionLabel,
      batchLabel
  };
}

function triggerAbsenteeMonitor(payload) {
    if (!ABSENTEE_MONITOR_TRIGGER_URL) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        try {
            const url = new URL(ABSENTEE_MONITOR_TRIGGER_URL);
            const body = JSON.stringify({
                ...payload,
                triggered_at: new Date().toISOString()
            });
            const transport = url.protocol === 'https:' ? https : http;
            const request = transport.request(
                {
                    method: 'POST',
                    hostname: url.hostname,
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    path: `${url.pathname}${url.search}`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                        'User-Agent': 'RMC-Server/1.0'
                    }
                },
                (response) => {
                    response.resume();
                    response.on('end', () => resolve(true));
                }
            );
            request.on('error', () => resolve(false));
            request.write(body);
            request.end();
        } catch (_error) {
            resolve(false);
        }
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function closeSessionById(sessionId) {
    const sessionRow = await getAsync('SELECT * FROM attendance_sessions WHERE id = ?', [sessionId]);
    if (!sessionRow) {
        const error = new Error('Session not found.');
        error.statusCode = 404;
        throw error;
    }

    if (sessionRow.status !== 'active') {
        return { session: sessionRow, absenteesCount: 0 };
    }
    const roster = await getSessionRoster(sessionId, sessionRow.batch_id);
    const presentRows = await allAsync(
        'SELECT student_uid, status FROM attendance_records WHERE session_id = ?',
        [sessionId]
    );
    const presentSet = new Set(presentRows.map((row) => row.student_uid));
    const lateSet = new Set(presentRows.filter((row) => Number(row.status) === 2).map((row) => row.student_uid));
    const lateStudents = roster.filter((student) => lateSet.has(student.student_uid));
    const absentees = roster.filter((student) => !presentSet.has(student.student_uid));

    await beginTransaction();
    try {
        await runAsync(
            `UPDATE attendance_sessions
             SET status = 'closed', end_time = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [sessionId]
        );

        for (const lateStudent of lateStudents) {
            const title = 'Late Attendance Notice';
            const content = `${lateStudent.name}, you were marked late for ${sessionRow.session_name || 'the session'} in ${sessionRow.batch_id}.`;
            await createStudentNotification({
                studentUid: lateStudent.student_uid,
                title,
                content,
                notificationType: 'late',
                sessionId,
                batchId: sessionRow.batch_id
            });
        }

        for (const absentee of absentees) {
            const title = 'Absence Notice';
            const content = `${absentee.name}, you were absent for ${sessionRow.session_name || 'the session'} in ${sessionRow.batch_id}.`;
            await createStudentNotification({
                studentUid: absentee.student_uid,
                title,
                content,
                notificationType: 'absent',
                sessionId,
                batchId: sessionRow.batch_id
            });
        }

        await commitTransaction();
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }

    for (const lateStudent of lateStudents) {
        const title = 'Late Attendance Notice';
        const content = `${lateStudent.name}, you were marked late for ${sessionRow.session_name || 'the session'} in ${sessionRow.batch_id}.`;
        broadcastMessage({
            type: 'attendance_notice',
            target: lateStudent.student_uid,
            title,
            content,
            noticeType: 'late'
        });
    }

    for (const absentee of absentees) {
        const title = 'Absence Notice';
        const content = `${absentee.name}, you were absent for ${sessionRow.session_name || 'the session'} in ${sessionRow.batch_id}.`;
        broadcastMessage({
            type: 'absence_alert',
            target: absentee.student_uid,
            title,
            content
        });
    }

    if (lateStudents.length > 0) {
        await sendPushToStudents(
            lateStudents.map((student) => student.student_uid),
            {
                title: 'Late Attendance Notice',
                body: `You were marked late for ${sessionRow.session_name || 'the session'} in ${sessionRow.batch_id}.`,
                url: '/student/portal',
                tag: `attendance-late-${sessionRow.id}`
            }
        );
    }

    if (absentees.length > 0) {
        await sendPushToStudents(
            absentees.map((student) => student.student_uid),
            {
                title: 'Absence Notice',
                body: `You were marked absent for ${sessionRow.session_name || 'the session'} in ${sessionRow.batch_id}.`,
                url: '/student/portal',
                tag: `attendance-absent-${sessionRow.id}`
            }
        );
    }

    let absenteeExport = null;
    try {
        absenteeExport = await writeAttendanceWorkbookExport(sessionRow, absentees, lateStudents);
    } catch (exportError) {
        console.error('[ATTENDANCE_EXPORT] Failed to write workbook export:', exportError);
    }

    broadcastStaffEvent({
        type: 'session_closed',
        session_id: sessionId,
        batch_id: sessionRow.batch_id,
        absentees_count: absentees.length,
        late_count: lateStudents.length,
        export_file: absenteeExport?.fileName || null
    });

    if (ABSENTEE_AUTO_SEND_ENABLED) {
        void triggerAbsenteeMonitor({
            session_id: sessionId,
            batch_id: sessionRow.batch_id,
            session_label: absenteeExport?.sessionLabel || sessionRow.session_name || '',
            batch_label: absenteeExport?.batchLabel || sessionRow.batch_id || '',
            export_file: absenteeExport?.fileName || null
        }).catch(() => null);
    }

    queueWeeklyAttendanceReportGeneration(sessionRow, sessionId);

    return {
        session: {
            ...sessionRow,
            status: 'closed'
        },
        absenteesCount: absentees.length,
        lateCount: lateStudents.length,
        weeklyReport: null,
        absenteeExport
    };
}

async function getBatchReportData(batchNameInput) {
    const batchName = await resolveBatchName(batchNameInput);
    if (!batchName) {
        return {
            batch: '',
            sessions: [],
            students: []
        };
    }

    const sessions = await allAsync(
        `SELECT id, session_name, start_time
         FROM attendance_sessions
         WHERE batch_id = ?
           AND status = 'closed'
         ORDER BY start_time ASC`,
        [batchName]
    );
    const currentStudents = await getBatchStudentsForReport(batchName);
    const rosterByStudent = new Map();
    
    // Add all current students who are currently assigned to this batch
    for (const student of currentStudents) {
        rosterByStudent.set(student.student_uid, student);
    }

    // Add any students who were part of historical sessions but may no longer be in the primary batch list
    for (const session of sessions) {
        const roster = await getSessionRoster(session.id, batchName);
        for (const student of roster) {
            if (!rosterByStudent.has(student.student_uid)) {
                rosterByStudent.set(student.student_uid, student);
            }
        }
    }

    let students = Array.from(rosterByStudent.values());
    students = students.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    if (sessions.length === 0 || students.length === 0) {
        return {
            batch: batchName,
            sessions: sessions.map((session) => ({
                id: session.id,
                start_time: session.start_time,
                label: `${session.session_name || 'Session'} (${formatDateTimeIST(session.start_time)})`
            })),
            students: students.map((student) => ({
                ...student,
                attendance_percent: 0,
                attendance: {}
            }))
        };
    }

    const sessionIds = sessions.map((session) => session.id);
    const placeholders = sessionIds.map(() => '?').join(', ');
    const records = await allAsync(
        `SELECT session_id, student_uid, status
         FROM attendance_records
         WHERE session_id IN (${placeholders})`,
        sessionIds
    );

    const attendanceByStudent = new Map();
    for (const record of records) {
        if (!attendanceByStudent.has(record.student_uid)) {
            attendanceByStudent.set(record.student_uid, new Map());
        }
        attendanceByStudent.get(record.student_uid).set(record.session_id, Number(record.status));
    }

    const normalizedSessions = sessions.map((session) => ({
        id: session.id,
        start_time: session.start_time,
        label: `${session.session_name || 'Session'} (${formatDateTimeIST(session.start_time)})`
    }));

    const enrichedStudents = students.map((student) => {
        const marks = attendanceByStudent.get(student.student_uid) || new Map();
        let presentOrLate = 0;
        const attendance = {};

        for (const session of normalizedSessions) {
            const code = marks.get(session.id) || 0;
            let label = 'Absent';
            if (code === 1) {
                label = 'Present';
                presentOrLate += 1;
            } else if (code === 2) {
                label = 'Late';
                presentOrLate += 1;
            }
            attendance[String(session.id)] = label;
        }

        return {
            ...student,
            attendance_percent: normalizedSessions.length ? Math.round((presentOrLate / normalizedSessions.length) * 100) : 0,
            attendance
        };
    });

    return {
        batch: batchName,
        sessions: normalizedSessions,
        students: enrichedStudents
    };
}

async function getBatchStudentsForExport(batchNameInput) {
    const batchName = normalizeBatchName(batchNameInput);
    if (!batchName) {
        return [];
    }

    const tableName = getBatchTableName(batchName);
    if (!(await tableExists(tableName))) {
        return [];
    }

    return allAsync(
        `SELECT student_uid, name, current_batch
         FROM ${quoteIdentifier(tableName)}
         ORDER BY name ASC, student_uid ASC`
    ).then((rows) => rows.map((row) => ({
        ...row,
        current_batch: row.current_batch || batchName,
        system_batches: [batchName],
        primary_system_batch: batchName
    })));
}

async function getBatchStudentsForReport(batchNameInput) {
    const batchName = normalizeBatchName(batchNameInput);
    if (!batchName) {
        return [];
    }

    const tableName = getBatchTableName(batchName);
    if (!(await tableExists(tableName))) {
        const rows = await allAsync('SELECT * FROM master_student_index ORDER BY created_at DESC');
        const matching = [];
        for (const row of rows) {
            if (splitBatchNames(row.batch_name).includes(batchName)) {
                const student = await hydrateStudent(row, batchName);
                if (student) {
                    student.current_batch = batchName;
                    student.system_batches = [batchName];
                    student.primary_system_batch = batchName;
                    matching.push(student);
                }
            }
        }
        return matching;
    }

    const rows = await allAsync(
        `SELECT *
         FROM ${quoteIdentifier(tableName)}
         ORDER BY name ASC, student_uid ASC`
    );
    if (rows.length > 0) {
        return rows.map((row) => ({
            ...row,
            current_batch: row.current_batch || batchName,
            system_batches: [batchName],
            primary_system_batch: batchName
        }));
    }

    const masterRows = await allAsync('SELECT * FROM master_student_index ORDER BY created_at DESC');
    const matching = [];
    for (const row of masterRows) {
        if (splitBatchNames(row.batch_name).includes(batchName)) {
            const student = await hydrateStudent(row, batchName);
            if (student) {
                student.current_batch = batchName;
                student.system_batches = [batchName];
                student.primary_system_batch = batchName;
                matching.push(student);
            }
        }
    }
    return matching;
}

async function getBatchTestReportData(batchNameInput) {
    const batchName = await resolveBatchName(batchNameInput);
    if (!batchName) {
        const error = new Error('Batch not found.');
        error.statusCode = 404;
        throw error;
    }

    const students = await getBatchStudentsForExport(batchName);
    const launches = await allAsync(
        `SELECT l.id,
                l.batch_name,
                l.starts_at,
                l.created_at,
                p.title AS paper_title
         FROM test_launches l
         JOIN test_papers p ON p.id = l.paper_id
         WHERE l.batch_name = ?
         ORDER BY COALESCE(l.starts_at, l.created_at) ASC, l.id ASC`,
        [batchName]
    );

    const submissions = launches.length
        ? await allAsync(
            `SELECT launch_id, student_uid, score, total_questions
             FROM test_submissions
             WHERE launch_id IN (${launches.map(() => '?').join(', ')})`,
            launches.map((launch) => launch.id)
        )
        : [];

    const submissionMap = new Map();
    for (const row of submissions) {
        submissionMap.set(`${row.launch_id}:${row.student_uid}`, row);
    }

    const normalizedLaunches = launches.map((launch) => {
        const dateValue = launch.starts_at || launch.created_at;
        const dateLabel = formatDateLabelIST(dateValue || Date.now());
        return {
            ...launch,
            column_label: `${launch.paper_title}_${dateLabel}`.replace(/[^\w.-]+/g, '_')
        };
    });

    const rows = students.map((student) => {
        const scores = {};
        for (const launch of normalizedLaunches) {
            const submission = submissionMap.get(`${launch.id}:${student.student_uid}`);
            scores[launch.column_label] = submission ? `${submission.score}/${submission.total_questions}` : 'Not Attempted';
        }

        return {
            student_uid: student.student_uid,
            name: student.name,
            scores
        };
    });

    return {
        batch: batchName,
        tests: normalizedLaunches,
        students: rows
    };
}

function normalizeDoubtRow(row = {}) {
    return {
        ...row,
        student_uid: row.student_uid || '',
        student_name: row.student_name || row.current_name || row.name || '',
        batch_name: row.batch_name || row.current_batch || row.current_batch_name || row.batch_id || '',
        phone: row.phone || row.student_phone || '',
        question_text: row.question_text || '',
        question_image: row.question_image || '',
        reply_image: row.reply_image || '',
        status: row.status || 'pending',
        created_at: row.created_at || null,
        replied_at: row.replied_at || null
    };
}

function getDoubtStreamSet(studentUid) {
    const key = normalizeText(studentUid);
    if (!key) {
        return null;
    }

    if (!doubtNotificationStreams.has(key)) {
        doubtNotificationStreams.set(key, new Set());
    }
    return doubtNotificationStreams.get(key);
}

function broadcastDoubtEvent(studentUid, payload) {
    const streamSet = getDoubtStreamSet(studentUid);
    if (!streamSet || streamSet.size === 0) {
        return;
    }

    const message = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of streamSet) {
        try {
            res.write(message);
        } catch {
            // Ignore broken sockets; they will drop on close.
        }
    }
}

async function getDoubtContext(studentUid) {
    const indexRow = await getStudentIndexByUid(studentUid);
    if (!indexRow) {
        return null;
    }

    const student = await hydrateStudent(indexRow);
    if (!student) {
        return null;
    }

    return student;
}

if (TRUST_PROXY) {
    app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(cors({
    origin(origin, callback) {
        if (!origin) {
            callback(null, true);
            return;
        }

        if (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
    name: 'rmc.sid',
    secret: SESSION_SECRET,
    ...(sessionStore ? { store: sessionStore } : {}),
    proxy: TRUST_PROXY,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: SESSION_COOKIE_SAMESITE,
        secure: SESSION_COOKIE_SECURE,
        ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
        maxAge: SESSION_TIMEOUT
    }
}));

app.use(tenantRuntime.tenantMiddleware());

function createTenantStaticMiddleware(getDirectory) {
    return asyncHandler(async (req, res, next) => {
        const rawPath = String(req.path || '').replace(/^\/+/, '');
        if (!rawPath) {
            next();
            return;
        }

        const directory = getDirectory();
        const baseDir = path.resolve(directory);
        const targetPath = path.resolve(baseDir, rawPath);
        if (!targetPath.startsWith(baseDir)) {
            res.status(403).send('Forbidden');
            return;
        }

        const exists = await fsp.stat(targetPath).then((stat) => stat.isFile()).catch(() => false);
        if (!exists) {
            next();
            return;
        }

        res.sendFile(targetPath);
    });
}

app.use('/uploads', createTenantStaticMiddleware(() => getCurrentTenantStoragePaths().uploadsDir));
app.use('/qrcodes', createTenantStaticMiddleware(() => getCurrentTenantStoragePaths().qrcodesDir));
app.use('/staff_qrcodes', createTenantStaticMiddleware(() => getCurrentTenantStoragePaths().staffQrCodesDir));
app.use('/materials', createTenantStaticMiddleware(() => getCurrentTenantStoragePaths().materialsDir));
app.get('/sw.js', (_req, res) => {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0'
    });
    res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});
app.use(express.static(PUBLIC_DIR));

app.use((req, _res, next) => {
    ensureTenantDatabaseInitialized(req.tenant || getCurrentTenantRecord()).catch(() => {
        // Routes inspect readiness and return safer responses; avoid unhandled rejections here.
    });
    next();
});

app.use(asyncHandler(async (req, res, next) => {
    if (req.session?.student) {
        next();
        return;
    }
    if (!isDatabaseReady() && !(await waitForDatabaseReady(5000))) {
        next();
        return;
    }

    const cookies = parseCookies(req);
    const rememberToken = normalizeText(cookies[STUDENT_REMEMBER_COOKIE]);
    if (!rememberToken) {
        next();
        return;
    }

    const rememberedStudent = await getStudentSessionByRememberToken(rememberToken);
    if (!rememberedStudent) {
        clearStudentRememberCookie(res);
        next();
        return;
    }

    req.session.student = rememberedStudent;
    next();
}));
app.set('view engine', 'ejs');
app.set('views', path.join(APP_ROOT_DIR, 'views'));

app.get('/', asyncHandler(async (req, res) => {
    res.redirect('/gateway');
}));

app.get('/healthz', asyncHandler(async (_req, res) => {
    const databaseStatus = getDatabaseStatus();
    if (!isDatabaseReady()) {
        res.status(databaseStatus === 'error' ? 500 : 503).json({
            status: databaseStatus,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            dbReadyAt,
            error: dbInitError ? String(dbInitError.message || dbInitError) : undefined
        });
        return;
    }
    const row = await getAsync('SELECT 1 AS ok');
    res.json({
        status: row?.ok === 1 ? 'ok' : 'degraded',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dbReadyAt
    });
}));

app.use((req, res, next) => {
    if (!ENFORCE_PRIVATE_ENTRY) {
        next();
        return;
    }
    if (isApiRequest(req) || !isPrivateEntryPath(req.path) || isPrivateHostRequest(req)) {
        next();
        return;
    }
    res.redirect(`${getPrivateBaseUrl(req)}${req.originalUrl}`);
});

app.get('/gateway', (req, res) => {
    if (ENFORCE_PRIVATE_ENTRY && !isPrivateHostRequest(req)) {
        res.redirect(getPrivateBaseUrl(req));
        return;
    }
    res.render('gateway');
});
app.get('/register', asyncHandler(async (req, res) => {
    let batches = [];
    let portalMode = 'create';
    let portalMessage = '';
    let editStudent = null;
    let editSessionId = null;

    if (isDatabaseReady() || (await waitForDatabaseReady(5000))) {
        try {
            batches = await allAsync(
                'SELECT batch_id AS id, name, description, created_at FROM batch_catalog WHERE is_active = 1 ORDER BY updated_at DESC, created_at DESC'
            );
        } catch (error) {
            console.error('Register page batch preload failed:', error);
        }
    }

    const requestedMode = normalizeText(req.query.mode).toLowerCase();
    const requestedToken = normalizeText(req.query.token);
    if (requestedMode === 'update' || requestedToken) {
        const portalSession = consumeStudentUpdatePortalToken(requestedToken);
        if (!portalSession) {
            portalMode = 'expired';
            portalMessage = 'This updating portal has expired. Open a fresh one from Host > Manage.';
        } else {
            const indexRow = await getStudentIndexByUid(portalSession.studentUid);
            const student = indexRow ? await hydrateStudent(indexRow) : null;
            if (!student) {
                portalMode = 'expired';
                portalMessage = 'The selected student could not be loaded. Open a fresh update portal from Host > Manage.';
            } else {
                portalMode = 'update';
                editSessionId = createStudentEditSession(student.student_uid, portalSession.createdBy);
                editStudent = {
                    ...student,
                    current_batch: student.current_batch || splitBatchNames(student.batch_name)[0] || '',
                    current_batches: splitBatchNames(student.batch_name),
                    photo_url: student.photo_path,
                    photo_path: student.photo_path,
                    qr_url: student.qr_path,
                    qr_path: student.qr_path
                };
                portalMessage = 'Updating portal loaded. Reloading will expire this session.';
            }
        }
    }

    res.render('register', {
        batches,
        portalMode,
        portalMessage,
        editStudent,
        editSessionId
    });
}));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/dashboard', isAuthenticated, (req, res) => res.redirect('/staff_gateway'));
app.get('/staff_gateway', isAuthenticated, (req, res) => res.render('staff_gateway', {
    user: req.session.user,
    activePage: 'staff_gateway'
}));
app.get('/dashboard_teacher', isAuthenticated, (req, res) => res.render('dashboard_teacher', {
    user: req.session.user,
    activePage: 'teacher_console'
}));
app.get('/attendance', isAuthenticated, (req, res) => res.render('attendance', {
    user: req.session.user,
    activePage: 'staff_gateway'
}));
app.get('/host_dashboard', isAuthenticated, isHost, (req, res) => res.render('dashboard_host', {
    user: req.session.user
}));
app.get('/batches', isAuthenticated, (req, res) => res.render('batches', {
    user: req.session.user,
    activePage: 'batches'
}));
app.get('/materials', isAuthenticated, (req, res) => res.render('materials', {
    user: req.session.user,
    activePage: 'materials'
}));
app.get('/sms', isAuthenticated, (req, res) => res.render('sms_center', {
    user: req.session.user,
    activePage: 'sms'
}));
app.get('/reports', isAuthenticated, (req, res) => res.render('reports', {
    user: req.session.user,
    activePage: 'reports'
}));
app.get('/leads', isAuthenticated, (req, res) => res.render('leads', {
    user: req.session.user,
    activePage: 'leads'
}));
app.get('/student/login', (req, res) => {
    if (req.session.student) {
        res.redirect('/student/portal');
        return;
    }
    res.render('student_login');
});
app.get('/student/portal', isStudentAuthenticated, (req, res) => res.render('student_portal', {
    student: req.session.student
}));

app.get('/student/doubts', isStudentAuthenticated, (req, res) => res.render('student_doubts', {
    student: req.session.student
}));

app.get('/doubts', isAuthenticated, (req, res) => res.render('doubt_portal', {
    user: req.session.user,
    activePage: 'doubts'
}));

app.post('/api/students/update-session', isAuthenticated, asyncHandler(async (req, res) => {
    const studentUid = normalizeText(req.body.student_uid);
    if (!studentUid) {
        res.status(400).json({ status: 'error', error: 'Student UID is required.' });
        return;
    }

    const indexRow = await getStudentIndexByUid(studentUid);
    if (!indexRow) {
        res.status(404).json({ status: 'error', error: 'Student not found.' });
        return;
    }

    const token = createStudentUpdatePortalToken(studentUid, req.session?.user?.username || req.session?.user?.full_name || 'host');
    const updateUrl = `/register?mode=update&token=${encodeURIComponent(token)}`;

    res.json({
        status: 'success',
        update_url: updateUrl
    });
}));

app.get('/student/scan/:token', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.redirect('/student/login?service=starting');
        return;
    }
    const studentSession = await getStudentByTokenForPortal(req.params.token);
    if (!studentSession) {
        res.redirect('/student/login?scan=invalid');
        return;
    }
    req.session.student = studentSession;
    setStudentRememberCookie(res, extractToken(req.params.token));
    res.redirect('/student/portal');
}));

app.get('/staff/scan/:token', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.redirect('/login?service=starting');
        return;
    }
    const token = extractToken(req.params.token);
    const user = await getAsync('SELECT * FROM users WHERE staff_token = ?', [token]);
    if (!user || user.role === 'host') {
        res.redirect('/login?scan=invalid');
        return;
    }
    if (req.session) {
        delete req.session.student;
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.tenantKey = req.tenantKey || getCurrentTenantKey();
    req.session.lastActive = Date.now();
    res.redirect(user.role === 'teacher' ? '/dashboard_teacher' : '/staff_gateway');
}));

app.get('/api/leads/stream', isAuthenticatedStream, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
    });

    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    leadStreams.add(res);

    req.on('close', () => {
        leadStreams.delete(res);
    });
});

app.get('/api/staff/live/stream', isAuthenticatedStream, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
    });

    res.write(`data: ${JSON.stringify({ type: 'heartbeat', status: 'connected' })}\n\n`);
    staffLiveStreams.add(res);

    req.on('close', () => {
        staffLiveStreams.delete(res);
    });
});

app.get('/api/live/stream', isPortalAuthenticatedStream, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
    });

    res.write(`data: ${JSON.stringify({ type: 'heartbeat', status: 'connected' })}\n\n`);
    liveStreams.add(res);

    req.on('close', () => {
        liveStreams.delete(res);
    });
});

app.get('/api/leads', isAuthenticated, asyncHandler(async (req, res) => {
    await purgeExpiredIdCardRequests();
    const unreadOnly = String(req.query.unread || '') === '1';
    const filters = ["(source = 'id_card_permission_request' OR source IS NULL OR TRIM(source) = '')"];
    if (unreadOnly) {
        filters.push('is_read = 0');
    }
    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await allAsync(
        `SELECT id, name, phone, email, message, source, created_at, is_read, father_name, guardian_phone, id_card_allowed, id_card_allowed_by, id_card_allowed_at
         FROM leads
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT 200`
    );
    res.json({ status: 'success', leads: rows });
}));

app.post('/api/leads/:id/read', isAuthenticated, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ status: 'error', error: 'Invalid lead id.' });
        return;
    }
    await runAsync('UPDATE leads SET is_read = 1 WHERE id = ?', [id]);
    res.json({ status: 'success' });
}));

app.post('/api/leads/:id/id-card-approval', isAuthenticated, asyncHandler(async (req, res) => {
    await purgeExpiredIdCardRequests();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ status: 'error', error: 'Invalid lead id.' });
        return;
    }

    const lead = await getAsync('SELECT id, name, phone, father_name, guardian_phone FROM leads WHERE id = ?', [id]);
    if (!lead) {
        res.status(404).json({ status: 'error', error: 'Lead not found.' });
        return;
    }
    if (!normalizeText(lead.phone)) {
        res.status(400).json({ status: 'error', error: 'Lead has no phone number. Approval requires phone.' });
        return;
    }

    const allowed = req.body?.allowed === false ? 0 : 1;
    const approvedBy = normalizeText(req.session?.user?.username || req.session?.user?.role || 'staff');

    if (allowed) {
        await grantPhoneIdCardApproval(lead, approvedBy);
    } else {
        await revokePhoneIdCardApproval(lead.phone);
    }

    res.json({
        status: 'success',
        allowed: Boolean(allowed),
        phone: normalizeText(lead.phone),
        message: allowed
            ? 'ID card generation is now allowed for this phone until the student record is deleted.'
            : 'ID card generation has been blocked for this phone.'
    });
}));

app.get('/api/leads/approval-status', asyncHandler(async (req, res) => {
    await purgeExpiredIdCardRequests();
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0'
    });
    const phone = normalizeText(req.query.phone);
    if (!phone) {
        res.status(400).json({ status: 'error', error: 'Phone is required.' });
        return;
    }

    const requestedSignature = getIdApprovalSignature({
        phone,
        father_name: req.query.father_name,
        guardian_phone: req.query.guardian_phone
    });
    const hasRequestedDetails = Boolean(requestedSignature.father_name || requestedSignature.guardian_phone);

    const cardRow = await getAsync(
        `SELECT student_uid, created_at
         FROM master_student_index
         WHERE phone = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [phone]
    );
    const row = await getAsync(
        `SELECT id, name, phone, father_name, guardian_phone, id_card_allowed, id_card_allowed_by, id_card_allowed_at, created_at
         FROM leads
         WHERE phone = ?
         ${hasRequestedDetails ? 'AND father_name = ? AND guardian_phone = ?' : ''}
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        hasRequestedDetails
            ? [phone, requestedSignature.father_name, requestedSignature.guardian_phone]
            : [phone]
    );
    const approvalRow = await getAsync(
        `SELECT approved_by, approved_at, student_name, father_name, guardian_phone
         FROM id_card_phone_approvals
         WHERE phone = ?
         LIMIT 1`,
        [phone]
    );
    const approvedLeadRow = await getAsync(
        `SELECT id, name, phone, father_name, guardian_phone, id_card_allowed, id_card_allowed_by, id_card_allowed_at, created_at
         FROM leads
         WHERE phone = ?
           AND id_card_allowed = 1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [phone]
    );

    if (cardRow) {
        res.json({
            status: 'success',
            approved: false,
            has_existing_card: true,
            existing_student_uid: cardRow.student_uid || null,
            approved_by: approvalRow?.approved_by || null,
            approved_at: approvalRow?.approved_at || null,
            reason: 'card_exists',
            message: 'An ID card already exists for this phone number.'
        });
        return;
    }

    if (approvedLeadRow && canReuseApprovalForRequest(approvedLeadRow, requestedSignature)) {
        res.json({
            status: 'success',
            approved: true,
            has_existing_card: false,
            existing_student_uid: null,
            approved_by: approvedLeadRow.id_card_allowed_by || approvalRow?.approved_by || null,
            approved_at: approvedLeadRow.id_card_allowed_at || approvalRow?.approved_at || null,
            reason: 'approved',
            message: 'Teacher approval is active for this phone. Complete the form to generate the ID card.'
        });
        return;
    }

    if (approvalRow && canReuseApprovalForRequest(approvalRow, requestedSignature)) {
        res.json({
            status: 'success',
            approved: true,
            has_existing_card: false,
            existing_student_uid: null,
            approved_by: approvalRow.approved_by || null,
            approved_at: approvalRow.approved_at || null,
            reason: 'approved',
            message: 'Teacher approval is active for this phone. Complete the form to generate the ID card.'
        });
        return;
    }

    if (!row) {
        res.json({
            status: 'success',
            approved: false,
            has_existing_card: false,
            existing_student_uid: null,
            reason: 'not_found',
            message: 'No ID request found for this phone. Send an ID request to the teacher first.'
        });
        return;
    }

    res.json({
        status: 'success',
        approved: false,
        has_existing_card: false,
        existing_student_uid: null,
        approved_by: null,
        approved_at: null,
        reason: 'pending_teacher_approval',
        message: 'Teacher approval is pending. Ask the teacher to approve this phone from ID requests.'
    });
}));

app.post('/api/leads', asyncHandler(async (req, res) => {
    await purgeExpiredIdCardRequests();
    const name = normalizeText(req.body.name);
    const phone = normalizeText(req.body.phone);
    const fatherName = normalizeText(req.body.father_name);
    const guardianPhone = normalizeText(req.body.guardian_phone);
    const source = normalizeText(req.body.source) || 'id_card_permission_request';

    if (!name) {
        res.status(400).json({ status: 'error', error: 'Name is required.' });
        return;
    }
    if (!phone) {
        res.status(400).json({ status: 'error', error: 'Phone is required for ID card permission request.' });
        return;
    }

    const existingCard = await getAsync(
        `SELECT student_uid
         FROM master_student_index
         WHERE phone = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [phone]
    );
    if (existingCard) {
        res.json({
            status: 'success',
            existing_card: true,
            student_uid: existingCard.student_uid,
            message: 'An ID card already exists for this phone number.'
        });
        return;
    }

    let inheritedApproval = 0;
    let inheritedApprovalBy = null;
    let inheritedApprovalAt = null;
    const requestedSignature = getIdApprovalSignature({
        phone,
        father_name: fatherName,
        guardian_phone: guardianPhone
    });
    if (phone) {
        const approvalRow = await getAsync(
            `SELECT approved_by, approved_at, phone, father_name, guardian_phone
             FROM id_card_phone_approvals
             WHERE phone = ?
             LIMIT 1`,
            [phone]
        );
        inheritedApproval = approvalRow && canReuseApprovalForRequest(approvalRow, requestedSignature) ? 1 : 0;
        inheritedApprovalBy = inheritedApproval ? (approvalRow?.approved_by || null) : null;
        inheritedApprovalAt = inheritedApproval ? (approvalRow?.approved_at || null) : null;
    }

    const result = await runAsync(
        `INSERT INTO leads (name, phone, email, message, source, father_name, guardian_phone, id_card_allowed, id_card_allowed_by, id_card_allowed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, phone, null, null, source, fatherName || null, guardianPhone || null, inheritedApproval, inheritedApprovalBy, inheritedApproval ? inheritedApprovalAt : null]
    );

    const lead = await getAsync(
        `SELECT id, name, phone, email, message, source, created_at, is_read, father_name, guardian_phone, id_card_allowed, id_card_allowed_by, id_card_allowed_at
         FROM leads
         WHERE id = ?`,
        [result.lastID]
    );

    broadcastLeadEvent({ type: 'lead', lead });
    res.json({ status: 'success', id: result.lastID });
}));

app.get('/verify/:token', asyncHandler(async (req, res) => {
    const student = await verifyStudentToken(req.params.token);
    if (!student) {
        res.status(404).send(`
            <html>
            <head><title>RMC Verification</title></head>
            <body style="font-family: Arial, sans-serif; background:#0f172a; color:#fff; padding:40px;">
                <h1>Verification Failed</h1>
                <p>The QR token is invalid or no longer available.</p>
            </body>
            </html>
        `);
        return;
    }

    res.send(`
        <html>
        <head>
            <title>RMC Verification</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; background:#0f172a; color:#fff; padding:32px;">
            <div style="max-width:520px; margin:0 auto; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:20px; padding:28px;">
                <h1 style="margin-top:0;">Student Verified</h1>
                <p><strong>Name:</strong> ${escapeHtml(student.name)}</p>
                <p><strong>UID:</strong> ${escapeHtml(student.student_uid)}</p>
                <p><strong>Batch:</strong> ${escapeHtml(student.current_batch || student.batch_name || 'N/A')}</p>
                <p><strong>Phone:</strong> ${escapeHtml(student.phone || 'N/A')}</p>
                ${student.photo_path ? `<img src="${escapeHtml(student.photo_path)}" alt="Student Photo" style="width:160px;height:160px;object-fit:cover;border-radius:16px;border:2px solid rgba(255,255,255,0.15);">` : ''}
            </div>
        </body>
        </html>
    `);
}));

app.post('/api/login', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.status(503).json({ status: 'error', error: 'Service is still starting. Please try again in a few seconds.' });
        return;
    }
    const username = normalizeText(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username || !password) {
        res.status(400).json({ status: 'error', error: 'Username and password are required.' });
        return;
    }

    const user = await getAsync('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
        res.status(401).json({ status: 'error', error: 'Invalid credentials' });
        return;
    }

    const matches = await verifyAndUpgradeUserPassword(user, password);
    if (!matches) {
        res.status(401).json({ status: 'error', error: 'Invalid credentials' });
        return;
    }

    if (req.session) {
        delete req.session.student;
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.tenantKey = req.tenantKey || getCurrentTenantKey();
    req.session.lastActive = Date.now();
    const redirect = user.role === 'host'
        ? '/host_dashboard'
        : user.role === 'teacher'
            ? '/dashboard_teacher'
            : '/staff_gateway';

    const payload = {
        status: 'success',
        role: user.role,
        redirect,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            full_name: user.full_name || '',
            phone: user.phone || ''
        }
    };

    if (user.role === 'teacher' || user.role === 'host' || user.role === 'staff') {
        try {
            payload.bootstrap = await buildStaffBootstrapPayload();
        } catch (bootstrapError) {
            console.warn('[AUTH] Staff bootstrap failed during login, continuing without bootstrap:', bootstrapError);
            payload.bootstrap = null;
        }
    }

    res.json(payload);
}));

app.post('/api/login/qr', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.status(503).json({ status: 'error', error: 'Service is still starting. Please try again in a few seconds.' });
        return;
    }
    const token = extractToken(req.body.token);
    if (!token) {
        res.status(400).json({ status: 'error', error: 'Missing token.' });
        return;
    }

    const user = await getAsync('SELECT * FROM users WHERE staff_token = ?', [token]);
    if (!user || user.role === 'host') {
        res.status(401).json({ status: 'error', error: 'Staff QR not valid.' });
        return;
    }

    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.lastActive = Date.now();
    const payload = {
        status: 'success',
        redirect: user.role === 'teacher' ? '/dashboard_teacher' : '/staff_gateway',
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            full_name: user.full_name || '',
            phone: user.phone || ''
        }
    };

    if (user.role === 'teacher' || user.role === 'host' || user.role === 'staff') {
        try {
            payload.bootstrap = await buildStaffBootstrapPayload();
        } catch (bootstrapError) {
            console.warn('[AUTH] Staff bootstrap failed during QR login, continuing without bootstrap:', bootstrapError);
            payload.bootstrap = null;
        }
    }

    res.json(payload);
}));

app.post('/api/staff/cards', isAuthenticated, asyncHandler(async (req, res) => {
    const username = normalizeText(req.body.username).toLowerCase();
    const password = String(req.body.password ?? '');
    const roleInput = normalizeText(req.body.role).toLowerCase();
    const role = roleInput === 'teacher' ? 'teacher' : 'staff';
    const fullName = normalizeText(req.body.full_name) || username;
    const phone = normalizeText(req.body.phone);

    if (!username || !password) {
        res.status(400).json({ status: 'error', error: 'Username and password are required.' });
        return;
    }

    const existing = await getAsync('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
        res.status(409).json({ status: 'error', error: 'Username already exists.' });
        return;
    }

    const token = generateStaffToken();
    const passwordHash = await bcrypt.hash(password, 10);
    const qrFilename = `staff_qr_${username}_${Date.now()}.png`;
    const qrDiskPath = path.join(getCurrentTenantStoragePaths().staffQrCodesDir, qrFilename);
    const qrWebPath = `/staff_qrcodes/${qrFilename}`;
    const scanUrl = buildStaffScanUrl(token);

    await qrcode.toFile(qrDiskPath, scanUrl);
    const result = await runAsync(
        `INSERT INTO users (username, password, role, phone, full_name, staff_token)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [username, passwordHash, role, phone || null, fullName, token]
    );

    res.json({
        status: 'success',
        staff: {
            id: result.lastID,
            username,
            role,
            full_name: fullName,
            phone,
            qr_path: qrWebPath,
            scan_url: scanUrl,
            token
        }
    });
}));

app.post('/api/register', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.status(503).json({ status: 'error', error: 'Service is still starting. Please try again in a few seconds.' });
        return;
    }
    let {
        name,
        phone,
        father_name: fatherName,
        guardian_phone: guardianPhone,
        address,
        student_class: studentClass,
        aspiration,
        current_batches: currentBatches,
        photo
    } = req.body;

    name = normalizeText(name);
    phone = normalizeText(phone);
    fatherName = normalizeText(fatherName);
    guardianPhone = normalizeText(guardianPhone);
    address = normalizeText(address);
    studentClass = normalizeText(studentClass);
    aspiration = normalizeText(aspiration);
    photo = normalizeText(photo);

    if (typeof currentBatches === 'string') {
        currentBatches = [currentBatches];
    }
    currentBatches = (Array.isArray(currentBatches) ? currentBatches : [])
        .map((batch) => normalizeBatchName(batch))
        .filter(Boolean);
    currentBatches = [...new Set(currentBatches)];

    const existingByPhone = await getAsync(
        'SELECT * FROM master_student_index WHERE phone = ?',
        [phone]
    );

    if (existingByPhone) {
        const existingStudent = await hydrateStudent(existingByPhone);
        if (!existingStudent) {
            throw new Error('Student exists in master index but profile data is missing.');
        }

        res.json({
            status: 'success',
            mode: 'retrieval',
            uid: existingStudent.student_uid,
            student_uid: existingStudent.student_uid,
            qr_url: existingStudent.qr_path,
            photo_url: existingStudent.photo_path,
            message: 'Student record retrieved successfully.',
            ...existingStudent
        });
        return;
    }

    const phoneApproved = await isPhoneApprovedForIdCard({
        phone,
        father_name: fatherName,
        guardian_phone: guardianPhone
    });
    if (!phoneApproved) {
        res.status(403).json({
            status: 'error',
            error: 'ID card generation blocked. Ask teacher to approve this student details from Leads first.'
        });
        return;
    }

    if (!name || !phone || !fatherName || !aspiration || currentBatches.length === 0 || !photo) {
        res.status(400).json({
            status: 'error',
            error: 'Name, phone, father name, aspiration, photo, and at least one batch are required.'
        });
        return;
    }

    const loginToken = generateLoginToken(name, phone, fatherName);

    for (const batchName of currentBatches) {
        await createBatchTable(batchName);
    }

    const uid = await generateUniqueUid(name, aspiration, phone);
    const secureToken = generateSecureToken();
    const photoFilename = `profile_${uid}_${Date.now()}.jpg`;
    const qrFilename = `qr_${uid}.png`;
    const photoDiskPath = path.join(getCurrentTenantStoragePaths().uploadsDir, photoFilename);
    const qrDiskPath = path.join(getCurrentTenantStoragePaths().qrcodesDir, qrFilename);
    const photoWebPath = `/uploads/${photoFilename}`;
    const qrWebPath = `/qrcodes/${qrFilename}`;

    const base64Payload = photo.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Payload, 'base64');

    if (!imageBuffer.length) {
        res.status(400).json({ status: 'error', error: 'Invalid photo payload.' });
        return;
    }

    try {
        await fsp.writeFile(photoDiskPath, imageBuffer);
        await qrcode.toFile(qrDiskPath, buildVerifyUrl(secureToken));

        await beginTransaction();
        const existsDuringTxn = await getAsync('SELECT student_uid FROM master_student_index WHERE phone = ?', [phone]);
        if (existsDuringTxn) {
            throw new Error('PHONE_ALREADY_HAS_CARD');
        }
        await runAsync(
            `INSERT INTO master_student_index
            (student_uid, batch_name, secure_token, login_token, phone, name)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [uid, joinBatchNames(currentBatches), secureToken, loginToken, phone, name]
        );

        for (const batchName of currentBatches) {
            const tableName = getBatchTableName(batchName);
            await runAsync(
                `INSERT INTO ${quoteIdentifier(tableName)}
                (student_uid, name, phone, father_name, guardian_phone, address, student_class, aspiration, current_batch, photo_path, qr_path, secure_token)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    uid,
                    name,
                    phone,
                    fatherName,
                    guardianPhone,
                    address,
                    studentClass,
                    aspiration,
                    batchName,
                    photoWebPath,
                    qrWebPath,
                    secureToken
                ]
            );
        }
        await commitTransaction();
        let staffAlert = null;
        try {
            staffAlert = await createStaffAlert({
                alertType: 'student_registered',
                title: 'New student joined RMC',
                content: `${name} (${uid}) joined the RMC app in ${currentBatches.join(', ')}.`,
                targetRoles: 'teacher,staff',
                metadata: {
                    student_uid: uid,
                    phone,
                    batches: currentBatches
                }
            });
        } catch (alertError) {
            console.warn('[REGISTER] Staff alert creation failed:', alertError);
        }
        broadcastStaffEvent({
            type: 'student_registered',
            action: 'registered',
            alert: staffAlert,
            name,
            student_uid: uid,
            phone,
            batches: currentBatches
        });
        await pushMobileNotification({
            role: 'staff',
            title: 'New student joined RMC',
            body: `${name} (${uid}) joined the app in ${currentBatches.join(', ')}.`,
            data: {
                type: 'student_registered',
                student_uid: uid,
                batches: currentBatches
            }
        });
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        await safelyDeleteFile(photoDiskPath);
        await safelyDeleteFile(qrDiskPath);
        if (String(error?.message || '') === 'PHONE_ALREADY_HAS_CARD' || String(error?.code || '') === 'SQLITE_CONSTRAINT') {
            res.status(409).json({
                status: 'error',
                error: 'An ID card already exists for this phone number. Delete it from Host > Manage before creating a new one.'
            });
            return;
        }
        throw error;
    }

    res.json({
        status: 'success',
        uid,
        student_uid: uid,
        qr_url: qrWebPath,
        photo_url: photoWebPath,
        message: `Enrolled successfully in ${currentBatches.length} batch${currentBatches.length > 1 ? 'es' : ''}.`
    });
}));

app.post('/api/student/login', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.status(503).json({ status: 'error', error: 'Service is still starting. Please try again in a few seconds.' });
        return;
    }
    const uid = normalizeText(req.body.uid);
    const name = normalizeText(req.body.name);
    const phone = normalizeText(req.body.phone);
    const fatherName = normalizeText(req.body.father_name);

    if (!uid && (!name || !phone || !fatherName)) {
        res.status(400).json({
            status: 'error',
            error: 'Provide either a Student UID or the full Trio-Lock details.'
        });
        return;
    }

    let indexRow = null;
    if (uid) {
        indexRow = await getAsync('SELECT * FROM master_student_index WHERE student_uid = ?', [uid]);
    } else {
        const loginToken = generateLoginToken(name, phone, fatherName);
        indexRow = await getAsync(
            `SELECT * FROM master_student_index
             WHERE login_token = ? OR secure_token = ?`,
            [loginToken, loginToken]
        );
    }

    if (!indexRow) {
        res.status(401).json({ status: 'error', error: 'Student not found.' });
        return;
    }

    const student = await hydrateStudent(indexRow);
    if (!student) {
        res.status(500).json({ status: 'error', error: 'Student profile data is missing.' });
        return;
    }

    if (req.session) {
        delete req.session.user;
    }
    req.session.student = student;
    req.session.tenantKey = req.tenantKey || getCurrentTenantKey();
    setStudentRememberCookie(res, indexRow.login_token || indexRow.secure_token);
    void notifyStudentFirstAppLogin(student);

    res.json({ status: 'success', redirect: '/student/portal' });
}));

app.post('/api/student/login/qr', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.status(503).json({ status: 'error', error: 'Service is still starting. Please try again in a few seconds.' });
        return;
    }
    const studentSession = await getStudentByTokenForPortal(req.body.token);
    if (!studentSession) {
        res.status(401).json({ status: 'error', error: 'Student QR not valid.' });
        return;
    }

    if (req.session) {
        delete req.session.user;
    }
    req.session.student = studentSession;
    req.session.tenantKey = req.tenantKey || getCurrentTenantKey();
    setStudentRememberCookie(res, extractToken(req.body.token));
    void notifyStudentFirstAppLogin(studentSession);
    res.json({ status: 'success', redirect: '/student/portal' });
}));

app.get('/api/student/materials', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const batches = await getStudentSessionBatchesResolved(req.session.student);
    let materials = [];

    console.log(`[DEBUG] /api/student/materials - Student: ${req.session.student.student_uid}, Resolved Batches:`, batches);

    if (batches.length > 0) {
        // Use normalized batch names for matching to handle whitespace/case inconsistencies on Hostinger (MySQL)
        const placeholders = batches.map(() => 'TRIM(UPPER(?))').join(', ');
        materials = await allAsync(
            `SELECT m.*, b.name AS batch_name
             FROM materials m
             LEFT JOIN batches b ON m.batch_id = b.id
             WHERE m.batch_id IS NULL OR TRIM(UPPER(b.name)) IN (${placeholders})
             ORDER BY m.created_at DESC`,
            batches
        );
        console.log(`[DEBUG] /api/student/materials - Found ${materials.length} records for batches.`);
    } else {
        materials = await allAsync(
            `SELECT m.*, b.name AS batch_name
             FROM materials m
             LEFT JOIN batches b ON m.batch_id = b.id
             WHERE m.batch_id IS NULL
             ORDER BY m.created_at DESC`
        );
        console.log(`[DEBUG] /api/student/materials - Found ${materials.length} generic records.`);
    }

    materials = await Promise.all(materials.map(enrichMaterialRecord));
    res.json({ status: 'success', materials });
}));

app.get('/api/student/notices', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const batches = await getStudentSessionBatchesResolved(req.session.student);
    let notices = [];
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    console.log(`[DEBUG] /api/student/notices - Student: ${req.session.student.student_uid}, Resolved Batches:`, batches);

    if (batches.length > 0) {
        // Normalize both DB and input so notices still match when spacing/case differs.
        const placeholders = batches.map(() => 'TRIM(UPPER(?))').join(', ');
        notices = await allAsync(
            `SELECT *
             FROM notices
             WHERE TRIM(UPPER(target_batch)) = 'ALL'
                OR TRIM(UPPER(target_batch)) IN (${placeholders})
             ORDER BY created_at DESC`,
            batches
        );
        console.log(`[DEBUG] /api/student/notices - Found ${notices.length} records for batches.`);
    } else {
        notices = await allAsync(
            `SELECT *
             FROM notices
             WHERE TRIM(UPPER(target_batch)) = 'ALL'
             ORDER BY created_at DESC`
        );
        console.log(`[DEBUG] /api/student/notices - Found ${notices.length} global records.`);
    }

    const studentUid = normalizeText(req.session.student?.student_uid);
    let directNotices = [];
    if (studentUid) {
        directNotices = await allAsync(
            `SELECT title, content, created_at, batch_id AS target_batch
             FROM notifications
             WHERE student_uid = ?
               AND notification_type = 'notice'
             ORDER BY created_at DESC`,
            [studentUid]
        );
    }

    const merged = [...notices, ...directNotices];
    const deduped = [];
    const seen = new Set();
    for (const notice of merged) {
        const key = `${normalizeText(notice.title)}|${normalizeText(notice.content)}|${normalizeText(notice.target_batch)}|${normalizeText(notice.created_at)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(notice);
    }

    deduped.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    res.json({ status: 'success', notices: deduped });
}));

app.get('/api/student/notices/:id', isStudentAuthenticated, asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ status: 'error', error: 'Valid notice id required.' });
        return;
    }

    const notice = await getAsync(
        `SELECT id, title, content, target_batch, created_at
         FROM notices
         WHERE id = ?`,
        [id]
    );

    if (!notice) {
        res.status(404).json({ status: 'error', error: 'Notice not found.' });
        return;
    }

    const batches = await getStudentSessionBatchesResolved(req.session.student);
    const allowed = notice.target_batch === 'ALL' || batches.includes(normalizeBatchName(notice.target_batch));
    if (!allowed) {
        res.status(403).json({ status: 'error', error: 'This notice is not assigned to your batch.' });
        return;
    }

    res.json({ status: 'success', notice });
}));

app.get('/api/student/notifications', isStudentAuthenticated, asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const studentUid = req.session.student.student_uid;
    const rows = await allAsync(
        `SELECT id, title, notification_type, content, session_id, batch_id, created_at, is_read
         FROM notifications
         WHERE student_uid = ?
         ORDER BY created_at DESC
         LIMIT 100`,
        [studentUid]
    );

    res.json({
        status: 'success',
        notifications: rows
    });
}));

app.get('/api/doubts/notifications/:student_uid', asyncHandler(async (req, res) => {
    const studentUid = normalizeText(req.params.student_uid);
    if (!studentUid) {
        res.status(400).json({ status: 'error', error: 'Student UID is required.' });
        return;
    }

    if (req.session?.student?.student_uid !== studentUid && !req.session?.user) {
        res.status(403).json({ status: 'error', error: 'Not authorized.' });
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', status: 'connected' })}\n\n`);

    const streamSet = getDoubtStreamSet(studentUid);
    streamSet.add(res);

    req.on('close', () => {
        streamSet.delete(res);
    });
}));

app.post('/api/doubts', isStudentAuthenticated, handleDoubtUpload, asyncHandler(async (req, res) => {
    const student = req.session.student;
    const studentUid = normalizeText(student?.student_uid);
    const questionText = normalizeText(req.body.question_text);
    const questionImage = req.file ? `/uploads/doubts/${req.file.filename}` : '';

    if (!studentUid) {
        res.status(401).json({ status: 'error', error: 'Student session not found.' });
        return;
    }

    if (!questionText && !questionImage) {
        res.status(400).json({ status: 'error', error: 'Please provide some text or an image.' });
        return;
    }

    const studentName = normalizeText(student?.name || student?.student_name || '');
    const batchName = normalizeText(student?.current_batch || student?.batch_name || '');
    const phone = normalizeText(student?.phone || '');

    const result = await runAsync(
        `INSERT INTO doubts (student_uid, student_name, batch_name, phone, question_text, question_image)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [studentUid, studentName, batchName, phone, questionText, questionImage || null]
    );

    await pushMobileNotification({
        role: 'staff',
        title: 'New doubt received',
        body: `${studentName || studentUid} sent a doubt for ${batchName || 'their batch'}.`,
        data: {
            type: 'doubt',
            student_uid: studentUid,
            batch: batchName || '',
            doubt_id: result.lastID
        }
    });

    res.json({
        status: 'success',
        id: result.lastID,
        message: 'Your doubt has been sent to the teacher.'
    });
}));

app.get('/api/doubts/student/:student_uid', isPortalAuthenticated, asyncHandler(async (req, res) => {
    const studentUid = normalizeText(req.params.student_uid);
    if (!studentUid) {
        res.status(400).json({ status: 'error', error: 'Student UID is required.' });
        return;
    }

    if (!req.session?.user && req.session?.student?.student_uid !== studentUid) {
        res.status(403).json({ status: 'error', error: 'Not authorized.' });
        return;
    }

    const rows = await allAsync(
        `SELECT d.*,
                COALESCE(NULLIF(d.student_name, ''), m.name) AS current_name,
                COALESCE(NULLIF(d.batch_name, ''), m.batch_name) AS current_batch,
                COALESCE(NULLIF(d.phone, ''), m.phone) AS current_phone
         FROM doubts d
         LEFT JOIN master_student_index m ON m.student_uid = d.student_uid
         WHERE d.student_uid = ?
         ORDER BY d.created_at DESC, d.id DESC`,
        [studentUid]
    );

    res.json({
        status: 'success',
        doubts: rows.map(normalizeDoubtRow)
    });
}));

app.get('/api/doubts/pending', isAuthenticated, asyncHandler(async (_req, res) => {
    const rows = await allAsync(
        `SELECT d.*,
                COALESCE(NULLIF(d.student_name, ''), m.name) AS current_name,
                COALESCE(NULLIF(d.batch_name, ''), m.batch_name) AS current_batch,
                COALESCE(NULLIF(d.phone, ''), m.phone) AS current_phone
         FROM doubts d
         LEFT JOIN master_student_index m ON m.student_uid = d.student_uid
         WHERE d.status = 'pending'
         ORDER BY d.created_at ASC, d.id ASC`
    );

    res.json({
        status: 'success',
        doubts: rows.map(normalizeDoubtRow)
    });
}));

app.post('/api/doubts/status/:id', isAuthenticated, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const status = normalizeText(req.body.status).toLowerCase();
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ status: 'error', error: 'Valid doubt id is required.' });
        return;
    }
    if (!['solved', 'flagged'].includes(status)) {
        res.status(400).json({ status: 'error', error: 'Status must be solved or flagged.' });
        return;
    }

    const doubt = await getAsync('SELECT student_uid FROM doubts WHERE id = ?', [id]);
    if (!doubt) {
        res.status(404).json({ status: 'error', error: 'Doubt not found.' });
        return;
    }

    await runAsync(
        `UPDATE doubts
         SET status = ?,
             replied_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [status, id]
    );

    broadcastDoubtEvent(doubt.student_uid, { type: 'STATUS_UPDATE', doubt_id: id, status });
    res.json({ status: 'success' });
}));

app.post('/api/doubts/reply/:id', isAuthenticated, handleDoubtUpload, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ status: 'error', error: 'Valid doubt id is required.' });
        return;
    }

    const doubt = await getAsync('SELECT student_uid FROM doubts WHERE id = ?', [id]);
    if (!doubt) {
        res.status(404).json({ status: 'error', error: 'Doubt not found.' });
        return;
    }

    const replyImage = req.file ? `/uploads/replies/${req.file.filename}` : '';
    await runAsync(
        `UPDATE doubts
         SET reply_image = ?,
             status = 'solved',
             replied_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [replyImage || null, id]
    );

    broadcastDoubtEvent(doubt.student_uid, { type: 'REPLY', doubt_id: id, status: 'solved' });
    await pushMobileNotification({
        role: 'student',
        title: 'Doubt updated',
        body: 'Your doubt has been replied to by the teacher.',
        ownerKeys: [doubt.student_uid],
        data: {
            type: 'doubt_reply',
            doubt_id: id,
            student_uid: doubt.student_uid
        }
    });
    res.json({ status: 'success', reply_image: replyImage });
}));

app.use(['/api/tests', '/api/student/tests'], (_req, res, next) => {
    if (TEST_SYSTEM_ENABLED) {
        next();
        return;
    }
    res.status(503).json({
        status: 'disabled',
        error: 'Test system is temporarily disabled.'
    });
});

app.get('/api/student/tests/dashboard', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const payload = await buildStudentTestDashboard(req.session.student);
    res.json({ status: 'success', ...payload });
}));

app.get('/api/student/tests/:launchId', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const launchId = Number(req.params.launchId);
    if (!Number.isFinite(launchId)) {
        res.status(400).json({ status: 'error', error: 'Valid test launch is required.' });
        return;
    }

    const launch = await getTestLaunchById(launchId);
    if (!launch) {
        res.status(404).json({ status: 'error', error: 'Test launch not found.' });
        return;
    }

    if (!canStudentAccessBatch(req.session.student, launch.batch_name)) {
        res.status(403).json({ status: 'error', error: 'This test is not assigned to your batch.' });
        return;
    }

    const submission = await getStudentSubmission(launchId, req.session.student.student_uid);
    const questions = await getTestQuestionsForPaper(launch.paper_id, { includeCorrect: false });

    res.json({
        status: 'success',
        launch: {
            id: launch.id,
            paper_id: launch.paper_id,
            title: launch.paper_title,
            subject: launch.subject,
            duration_minutes: launch.duration_minutes,
            question_count: Number(launch.question_count || questions.length),
            batch_name: launch.batch_name,
            starts_at: launch.starts_at,
            closes_at: launch.closes_at,
            closed_at: launch.closed_at,
            status: launch.status,
            scoreboard_published: Number(launch.scoreboard_published || 0) === 1
        },
        questions,
        already_submitted: Boolean(submission),
        submission: submission ? {
            score: submission.score,
            total_questions: submission.total_questions,
            submitted_at: submission.submitted_at
        } : null
    });
}));

app.post('/api/student/tests/:launchId/submit', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const launchId = Number(req.params.launchId);
    if (!Number.isFinite(launchId)) {
        res.status(400).json({ status: 'error', error: 'Valid test launch is required.' });
        return;
    }

    const launch = await getTestLaunchById(launchId);
    if (!launch) {
        res.status(404).json({ status: 'error', error: 'Test launch not found.' });
        return;
    }

    if (launch.status !== 'active') {
        res.status(409).json({ status: 'error', error: 'This test is no longer accepting submissions.' });
        return;
    }

    if (!canStudentAccessBatch(req.session.student, launch.batch_name)) {
        res.status(403).json({ status: 'error', error: 'This test is not assigned to your batch.' });
        return;
    }

    const existingSubmission = await getStudentSubmission(launchId, req.session.student.student_uid);
    if (existingSubmission) {
        res.status(409).json({ status: 'error', error: 'You have already submitted this test.' });
        return;
    }

    const questions = await getTestQuestionsForPaper(launch.paper_id, { includeCorrect: true });
    if (questions.length === 0) {
        res.status(409).json({ status: 'error', error: 'This test paper has no questions.' });
        return;
    }

    const rawAnswers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const answers = {};

    for (const question of questions) {
        const selected = normalizeOptionKey(rawAnswers[question.id] || rawAnswers[String(question.id)]);
        if (selected) {
            answers[question.id] = selected;
        }
    }

    const score = calculateTestScore(questions, answers);
    await runAsync(
        `INSERT INTO test_submissions (
            launch_id,
            paper_id,
            student_uid,
            student_name,
            batch_name,
            answers_json,
            score,
            total_questions
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            launchId,
            launch.paper_id,
            req.session.student.student_uid,
            req.session.student.name || req.session.student.student_uid,
            launch.batch_name,
            JSON.stringify(answers),
            score,
            questions.length
        ]
    );

    const scoreboard = await buildTestScoreboard(launchId);
    broadcastMessage({
        type: 'test_submission',
        launch_id: launchId,
        batch_name: launch.batch_name,
        submission_count: scoreboard.length
    });

    res.json({
        status: 'success',
        score,
        total_questions: questions.length,
        submitted_at: new Date().toISOString()
    });
}));

app.get('/api/student/tests/:launchId/past-paper', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const launchId = Number(req.params.launchId);
    if (!Number.isFinite(launchId)) {
        res.status(400).json({ status: 'error', error: 'Valid test launch is required.' });
        return;
    }

    const launch = await getTestLaunchById(launchId);
    if (!launch) {
        res.status(404).json({ status: 'error', error: 'Test launch not found.' });
        return;
    }

    if (!canStudentAccessBatch(req.session.student, launch.batch_name)) {
        res.status(403).json({ status: 'error', error: 'This test is not assigned to your batch.' });
        return;
    }

    const submission = await getStudentSubmission(launchId, req.session.student.student_uid);
    if (!submission) {
        res.status(404).json({ status: 'error', error: 'No submission found for this test.' });
        return;
    }

    const answers = safeParseJson(submission.answers_json, {});
    const questions = await getTestQuestionsForPaper(launch.paper_id, { includeCorrect: true });
    res.json({
        status: 'success',
        launch: {
            id: launch.id,
            title: launch.paper_title,
            subject: launch.subject,
            batch_name: launch.batch_name,
            closed_at: launch.closed_at,
            submitted_at: submission.submitted_at,
            score: submission.score,
            total_questions: submission.total_questions
        },
        questions: questions.map((question) => ({
            ...question,
            selected_option: normalizeOptionKey(answers[question.id] || answers[String(question.id)]),
            is_correct: normalizeOptionKey(answers[question.id] || answers[String(question.id)]) === question.correct_option
        }))
    });
}));

app.get('/api/student/tests/:launchId/scoreboard', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const launchId = Number(req.params.launchId);
    if (!Number.isFinite(launchId)) {
        res.status(400).json({ status: 'error', error: 'Valid test launch is required.' });
        return;
    }

    const launch = await getTestLaunchById(launchId);
    if (!launch) {
        res.status(404).json({ status: 'error', error: 'Test launch not found.' });
        return;
    }

    if (!canStudentAccessBatch(req.session.student, launch.batch_name)) {
        res.status(403).json({ status: 'error', error: 'This scoreboard is not available for your batch.' });
        return;
    }

    if (Number(launch.scoreboard_published || 0) !== 1) {
        res.status(403).json({ status: 'error', error: 'Scoreboard is not published yet.' });
        return;
    }

    const scoreboard = await buildTestScoreboard(launchId);
    const yourEntry = scoreboard.find((row) => row.student_uid === req.session.student.student_uid) || null;
    res.json({
        status: 'success',
        launch: {
            id: launch.id,
            title: launch.paper_title,
            subject: launch.subject,
            batch_name: launch.batch_name,
            closed_at: launch.closed_at,
            scoreboard_published: Number(launch.scoreboard_published || 0) === 1
        },
        scoreboard,
        your_entry: yourEntry
    });
}));

app.get('/api/push/public-key', isStudentAuthenticated, asyncHandler(async (_req, res) => {
    res.json({ status: 'success', publicKey: activeVapidPublicKey });
}));

app.post('/api/push/subscribe', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const subscription = req.body.subscription || {};
    const endpoint = normalizeText(subscription.endpoint);
    const p256dh = normalizeText(subscription.keys?.p256dh);
    const auth = normalizeText(subscription.keys?.auth);
    const studentUid = normalizeText(req.session?.student?.student_uid);

    if (!studentUid || !endpoint || !p256dh || !auth) {
        res.status(400).json({ status: 'error', error: 'Invalid subscription payload.' });
        return;
    }

    if (DB_DIALECT === 'mysql') {
        await runAsync(
            `INSERT INTO push_subscriptions (student_uid, endpoint, p256dh, auth)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                student_uid = VALUES(student_uid),
                p256dh = VALUES(p256dh),
                auth = VALUES(auth)`,
            [studentUid, endpoint, p256dh, auth]
        );
    } else {
        await runAsync(
            `INSERT INTO push_subscriptions (student_uid, endpoint, p256dh, auth)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(endpoint) DO UPDATE SET
                student_uid = excluded.student_uid,
                p256dh = excluded.p256dh,
                auth = excluded.auth`,
            [studentUid, endpoint, p256dh, auth]
        );
    }
    res.json({ status: 'success' });
}));

app.post('/api/push/unsubscribe', isStudentAuthenticated, asyncHandler(async (req, res) => {
    const endpoint = normalizeText(req.body.endpoint);
    if (!endpoint) {
        res.status(400).json({ status: 'error', error: 'Endpoint is required.' });
        return;
    }
    await runAsync('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    res.json({ status: 'success' });
}));

app.get('/api/tests/papers', isAuthenticated, asyncHandler(async (_req, res) => {
    const papers = await allAsync(
        `SELECT p.id,
                p.title,
                p.subject,
                p.duration_minutes,
                p.created_at,
                p.updated_at,
                COUNT(q.id) AS question_count
         FROM test_papers p
         LEFT JOIN test_questions q ON q.paper_id = p.id
         GROUP BY p.id
         ORDER BY p.created_at DESC, p.id DESC`
    );
    res.json({ status: 'success', papers });
}));

app.post('/api/tests/papers', isAuthenticated, asyncHandler(async (req, res) => {
    const title = normalizeText(req.body.title);
    const subject = normalizeText(req.body.subject);
    const durationMinutes = Math.max(1, Number(req.body.duration_minutes) || 30);
    const rawQuestions = Array.isArray(req.body.questions) ? req.body.questions : [];

    const questions = rawQuestions.map((question, index) => ({
        question_text: normalizeText(question?.question_text),
        option_a: normalizeText(question?.options?.A ?? question?.option_a),
        option_b: normalizeText(question?.options?.B ?? question?.option_b),
        option_c: normalizeText(question?.options?.C ?? question?.option_c),
        option_d: normalizeText(question?.options?.D ?? question?.option_d),
        correct_option: normalizeOptionKey(question?.correct_option),
        question_order: index + 1
    })).filter((question) => question.question_text);

    if (!title || !subject) {
        res.status(400).json({ status: 'error', error: 'Test title and subject are required.' });
        return;
    }

    if (questions.length === 0) {
        res.status(400).json({ status: 'error', error: 'Add at least one MCQ before saving the test paper.' });
        return;
    }

    const invalidQuestion = questions.find((question) => (
        !question.option_a
        || !question.option_b
        || !question.option_c
        || !question.option_d
        || !question.correct_option
    ));
    if (invalidQuestion) {
        res.status(400).json({ status: 'error', error: 'Every question must include four options and one correct answer.' });
        return;
    }

    await beginTransaction();
    try {
        const result = await runAsync(
            `INSERT INTO test_papers (title, subject, duration_minutes, created_by)
             VALUES (?, ?, ?, ?)`,
            [title, subject, durationMinutes, req.session.user.id]
        );
        for (const question of questions) {
            await runAsync(
                `INSERT INTO test_questions (
                    paper_id,
                    question_order,
                    question_text,
                    option_a,
                    option_b,
                    option_c,
                    option_d,
                    correct_option
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    result.lastID,
                    question.question_order,
                    question.question_text,
                    question.option_a,
                    question.option_b,
                    question.option_c,
                    question.option_d,
                    question.correct_option
                ]
            );
        }
        await commitTransaction();
        const paper = await getTestPaperById(result.lastID);
        res.json({ status: 'success', paper });
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }
}));

app.get('/api/tests/launches', isAuthenticated, asyncHandler(async (req, res) => {
    const requestedBatch = normalizeText(req.query.batch_name);
    const filters = [];
    const params = [];

    if (requestedBatch) {
        const batchName = await resolveBatchName(requestedBatch);
        if (!batchName) {
            res.status(404).json({ status: 'error', error: 'Batch not found.' });
            return;
        }
        filters.push('l.batch_name = ?');
        params.push(batchName);
    }

    const launches = await allAsync(
        `SELECT l.id,
                l.paper_id,
                l.batch_name,
                l.status,
                l.scoreboard_published,
                l.starts_at,
                l.closes_at,
                l.closed_at,
                l.created_at,
                p.title,
                p.subject,
                p.duration_minutes,
                COUNT(q.id) AS question_count,
                COUNT(s.id) AS submission_count
         FROM test_launches l
         JOIN test_papers p ON p.id = l.paper_id
         LEFT JOIN test_questions q ON q.paper_id = p.id
         LEFT JOIN test_submissions s ON s.launch_id = l.id
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         GROUP BY l.id
         ORDER BY COALESCE(l.starts_at, l.created_at) DESC, l.id DESC`,
        params
    );

    res.json({ status: 'success', launches });
}));

app.post('/api/tests/launches', isAuthenticated, asyncHandler(async (req, res) => {
    const batchName = await resolveBatchName(req.body.batch_name);
    const paperId = Number(req.body.paper_id);

    if (!batchName || !Number.isFinite(paperId)) {
        res.status(400).json({ status: 'error', error: 'Valid batch and paper are required.' });
        return;
    }

    const batch = await getAsync('SELECT id, name FROM batches WHERE name = ?', [batchName]);
    if (!batch) {
        res.status(404).json({ status: 'error', error: 'Batch not found.' });
        return;
    }

    const paper = await getTestPaperById(paperId);
    if (!paper) {
        res.status(404).json({ status: 'error', error: 'Test paper not found.' });
        return;
    }

    if (Number(paper.question_count || 0) === 0) {
        res.status(409).json({ status: 'error', error: 'Selected paper has no questions.' });
        return;
    }

    const result = await runAsync(
        `INSERT INTO test_launches (paper_id, batch_name, status, launched_by)
         VALUES (?, ?, 'active', ?)`,
        [paperId, batchName, req.session.user.id]
    );

    const launch = await getTestLaunchById(result.lastID);
    await notifyStudentsByBatch({
        targetBatch: batchName,
        title: 'New Test Available',
        content: `${launch.paper_title} is now active for ${batchName}.`,
        notificationType: 'test',
        pushTitle: `RMC Test: ${launch.paper_title}`,
        pushBody: `Your test is now live for ${batchName}.`,
        pushTag: `test-launch-${launch.id}`,
        url: '/student/portal'
    });
    broadcastMessage({
        type: 'test_launch',
        launch_id: launch.id,
        batch_name: batchName,
        paper_title: launch.paper_title
    });

    res.json({ status: 'success', launch });
}));

app.post('/api/tests/launches/:launchId/close', isAuthenticated, asyncHandler(async (req, res) => {
    const launchId = Number(req.params.launchId);
    if (!Number.isFinite(launchId)) {
        res.status(400).json({ status: 'error', error: 'Valid test launch is required.' });
        return;
    }

    const launch = await getTestLaunchById(launchId);
    if (!launch) {
        res.status(404).json({ status: 'error', error: 'Test launch not found.' });
        return;
    }

    await runAsync(
        `UPDATE test_launches
         SET status = 'closed',
             closed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [launchId]
    );

    await notifyStudentsByBatch({
        targetBatch: launch.batch_name,
        title: 'Test Closed',
        content: `${launch.paper_title} has been closed.`,
        notificationType: 'test',
        pushTitle: `RMC Test Closed: ${launch.paper_title}`,
        pushBody: 'Submission window has ended.',
        pushTag: `test-closed-${launchId}`,
        url: '/student/portal'
    });

    broadcastMessage({
        type: 'test_closed',
        launch_id: launchId,
        batch_name: launch.batch_name
    });

    res.json({ status: 'success' });
}));

app.post('/api/tests/launches/:launchId/publish-scoreboard', isAuthenticated, asyncHandler(async (req, res) => {
    const launchId = Number(req.params.launchId);
    const published = Number(req.body.published) === 1 || req.body.published === true;

    if (!Number.isFinite(launchId)) {
        res.status(400).json({ status: 'error', error: 'Valid test launch is required.' });
        return;
    }

    const launch = await getTestLaunchById(launchId);
    if (!launch) {
        res.status(404).json({ status: 'error', error: 'Test launch not found.' });
        return;
    }

    await runAsync(
        'UPDATE test_launches SET scoreboard_published = ? WHERE id = ?',
        [published ? 1 : 0, launchId]
    );

    if (published) {
        await notifyStudentsByBatch({
            targetBatch: launch.batch_name,
            title: 'Test Scoreboard Published',
            content: `Scoreboard for ${launch.paper_title} is now available.`,
            notificationType: 'test',
            pushTitle: `RMC Scoreboard: ${launch.paper_title}`,
            pushBody: 'Tap to view your rank and score.',
            pushTag: `test-scoreboard-${launchId}`,
            url: '/student/portal'
        });
    }

    broadcastMessage({
        type: 'test_scoreboard_publish',
        launch_id: launchId,
        batch_name: launch.batch_name,
        published
    });

    res.json({ status: 'success', published });
}));

app.get('/api/tests/submissions', isAuthenticated, asyncHandler(async (req, res) => {
    const requestedLaunchId = Number(req.query.launch_id);
    const filters = [];
    const params = [];

    if (Number.isFinite(requestedLaunchId)) {
        filters.push('s.launch_id = ?');
        params.push(requestedLaunchId);
    }

    const submissions = await allAsync(
        `SELECT s.id,
                s.launch_id,
                s.paper_id,
                s.student_uid,
                s.student_name,
                s.batch_name,
                s.score,
                s.total_questions,
                s.submitted_at,
                l.status AS launch_status,
                l.scoreboard_published,
                l.closed_at,
                p.title,
                p.subject
         FROM test_submissions s
         JOIN test_launches l ON l.id = s.launch_id
         JOIN test_papers p ON p.id = s.paper_id
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY s.submitted_at DESC, s.id DESC`,
        params
    );
    res.json({ status: 'success', submissions });
}));

app.get('/api/tests/launches/:launchId/scoreboard', isAuthenticated, asyncHandler(async (req, res) => {
    const launchId = Number(req.params.launchId);
    if (!Number.isFinite(launchId)) {
        res.status(400).json({ status: 'error', error: 'Valid test launch is required.' });
        return;
    }

    const launch = await getTestLaunchById(launchId);
    if (!launch) {
        res.status(404).json({ status: 'error', error: 'Test launch not found.' });
        return;
    }

    const scoreboard = await buildTestScoreboard(launchId);
    res.json({
        status: 'success',
        launch: {
            id: launch.id,
            title: launch.paper_title,
            subject: launch.subject,
            batch_name: launch.batch_name,
            status: launch.status,
            closed_at: launch.closed_at,
            scoreboard_published: Number(launch.scoreboard_published || 0) === 1
        },
        scoreboard
    });
}));

app.get('/api/students', isAuthenticated, asyncHandler(async (req, res) => {
    const requestedBatch = await resolveBatchName(req.query.batch);
    if (requestedBatch) {
        const report = await getBatchReportData(requestedBatch);
        res.json(report.students);
        return;
    }

    const students = await fetchAllStudentsDetailed();
    res.json(students);
}));

app.get('/api/students/summary', isAuthenticated, asyncHandler(async (req, res) => {
    const requestedBatch = await resolveBatchName(req.query.batch);
    const students = await fetchAllStudentsSummary();
    if (requestedBatch) {
        res.json(students.filter((student) => splitBatchNames(student.batch_name || student.current_batch || '').includes(requestedBatch)));
        return;
    }
    res.json(students);
}));

async function resolveSmsAudienceRequest(body) {
    const audience = normalizeText(body?.audience || 'session').toLowerCase();
    const recipientMode = normalizeText(body?.recipient_mode || 'guardian').toLowerCase() === 'student'
        ? 'student'
        : 'guardian';
    const statuses = normalizeText(body?.statuses || 'absent,late');

    if (audience === 'session') {
        return buildSmsAudienceFromSession(body?.session_id, statuses, recipientMode);
    }
    if (audience === 'batch') {
        return buildSmsAudienceFromBatch(body?.batch_name, recipientMode);
    }
    if (audience === 'all') {
        return buildSmsAudienceAllStudents(recipientMode);
    }
    if (audience === 'custom') {
        return buildSmsAudienceCustom(body?.numbers_text, body?.message_template || body?.message || '');
    }

    const error = new Error('Invalid SMS audience.');
    error.statusCode = 400;
    throw error;
}

app.post('/api/sms/preview', isAuthenticated, asyncHandler(async (req, res) => {
    const audience = await resolveSmsAudienceRequest(req.body);
    res.json({
        status: 'success',
        audience: audience.title,
        source: audience.source,
        count: audience.recipients.length,
        skipped: audience.skipped || 0,
        recipients: audience.recipients.slice(0, 50)
    });
}));

app.post('/api/sms/send', isAuthenticated, asyncHandler(async (req, res) => {
    const audience = await resolveSmsAudienceRequest(req.body);
    const template = normalizeText(req.body?.message_template || req.body?.message || '');
    if (!template && audience.source !== 'custom') {
        res.status(400).json({ status: 'error', error: 'Message text is required.' });
        return;
    }

    const recipients = audience.recipients;
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const recipient of recipients) {
        const context = {
            name: recipient.name || 'Student',
            batch: recipient.batch_name || '',
            class_name: recipient.class_name || '',
            session: recipient.session_name || '',
            session_name: recipient.session_name || '',
            date: recipient.arrival_time || '',
            status: recipient.status || '',
            arrival_time: recipient.arrival_time || '',
            phone: recipient.recipient_phone || ''
        };
        const renderedMessage = template
            ? renderSmsTemplate(template, context)
            : recipient.message;
        if (!renderedMessage || !recipient.recipient_phone) {
            failureCount += 1;
            results.push({
                ...recipient,
                ok: false,
                error: 'Missing recipient phone or message.'
            });
            continue;
        }

        try {
            const response = await sendSms8Message(recipient.recipient_phone, renderedMessage);
            const ok = response.status >= 200 && response.status < 300;
            if (ok) {
                successCount += 1;
            } else {
                failureCount += 1;
            }
            results.push({
                ...recipient,
                message: renderedMessage,
                ok,
                response_status: response.status,
                response_body: response.body
            });
        } catch (error) {
            failureCount += 1;
            results.push({
                ...recipient,
                message: renderedMessage,
                ok: false,
                error: error.message || 'SMS send failed.'
            });
        }
    }

    res.json({
        status: 'success',
        audience: audience.title,
        source: audience.source,
        sent: successCount,
        failed: failureCount,
        total: recipients.length,
        results: results.slice(0, 100)
    });
}));

app.post('/api/students/update', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(15000))) {
        res.status(503).json({ status: 'error', error: 'Service is still starting. Please try again in a few seconds.' });
        return;
    }

    const editSessionId = normalizeText(req.body.edit_session_id);
    const editSession = getStudentEditSession(editSessionId);
    if (!editSession) {
        res.status(403).json({ status: 'error', error: 'This update session is invalid or has expired.' });
        return;
    }

    const indexRow = await getStudentIndexByUid(editSession.studentUid);
    if (!indexRow) {
        res.status(404).json({ status: 'error', error: 'Student not found.' });
        return;
    }

    const sourceStudent = await hydrateStudent(indexRow);
    if (!sourceStudent) {
        res.status(404).json({ status: 'error', error: 'Student profile data is missing.' });
        return;
    }

    let {
        name,
        phone,
        father_name: fatherName,
        guardian_phone: guardianPhone,
        address,
        student_class: studentClass,
        aspiration,
        current_batches: currentBatches,
        photo
    } = req.body;

    name = normalizeText(name);
    phone = normalizeText(phone);
    fatherName = normalizeText(fatherName);
    guardianPhone = normalizeText(guardianPhone);
    address = normalizeText(address);
    studentClass = normalizeText(studentClass);
    aspiration = normalizeText(aspiration);
    photo = normalizeText(photo);

    if (typeof currentBatches === 'string') {
        currentBatches = [currentBatches];
    }
    currentBatches = (Array.isArray(currentBatches) ? currentBatches : [])
        .map((batch) => normalizeBatchName(batch))
        .filter(Boolean);
    currentBatches = [...new Set(currentBatches)];
    const previousBatches = splitBatchNames(indexRow.batch_name);
    const nextBatches = currentBatches.length > 0 ? currentBatches : previousBatches;

    if (!name || !phone || !fatherName || !aspiration || nextBatches.length === 0) {
        res.status(400).json({
            status: 'error',
            error: 'Name, phone, father name, aspiration, and at least one batch are required.'
        });
        return;
    }

    const conflictingPhone = await getAsync(
        'SELECT student_uid FROM master_student_index WHERE phone = ? AND student_uid != ? LIMIT 1',
        [phone, indexRow.student_uid]
    );
    if (conflictingPhone) {
        res.status(409).json({
            status: 'error',
            error: 'Another student already uses this phone number.'
        });
        return;
    }

    for (const batchName of nextBatches) {
        await createBatchTable(batchName);
    }

    const loginToken = generateLoginToken(name, phone, fatherName);
    const secureToken = normalizeText(indexRow.secure_token) || generateSecureToken();
    const photoChanged = Boolean(photo && photo.trim());
    const oldPhotoPath = sourceStudent.photo_path ? resolveStoredAssetDiskPath(sourceStudent.photo_path) : null;
    let photoWebPath = sourceStudent.photo_path || null;
    let photoDiskPath = null;
    const qrWebPath = sourceStudent.qr_path || null;

    if (photoChanged) {
        const photoFilename = `profile_${indexRow.student_uid}_${Date.now()}.jpg`;
        photoDiskPath = path.join(getCurrentTenantStoragePaths().uploadsDir, photoFilename);
        photoWebPath = `/uploads/${photoFilename}`;
    }

    const base64Payload = photoChanged ? photo.replace(/^data:image\/\w+;base64,/, '') : '';
    const imageBuffer = photoChanged ? Buffer.from(base64Payload, 'base64') : null;

    if (photoChanged && (!imageBuffer || !imageBuffer.length)) {
        res.status(400).json({ status: 'error', error: 'Invalid photo payload.' });
        return;
    }

    try {
        await beginTransaction();

        if (photoChanged) {
            await fsp.writeFile(photoDiskPath, imageBuffer);
        }

        await runAsync(
            `UPDATE master_student_index
             SET batch_name = ?,
                 secure_token = ?,
                 login_token = ?,
                 phone = ?,
                 name = ?
             WHERE student_uid = ?`,
            [
                joinBatchNames(nextBatches),
                secureToken,
                loginToken,
                phone,
                name,
                indexRow.student_uid
            ]
        );

        for (const batchName of previousBatches) {
            if (!nextBatches.includes(batchName)) {
                await removeStudentFromBatch(indexRow.student_uid, batchName);
            }
        }

        const updatedStudent = {
            student_uid: indexRow.student_uid,
            name,
            phone,
            father_name: fatherName,
            guardian_phone: guardianPhone,
            address,
            student_class: studentClass,
            aspiration,
            current_batch: nextBatches[0] || null,
            photo_path: photoWebPath,
            qr_path: qrWebPath,
            secure_token: secureToken
        };

        for (const batchName of nextBatches) {
            await upsertStudentIntoBatchTable(batchName, updatedStudent);
        }

        await runAsync(
            `UPDATE session_students
             SET name = ?,
                 phone = ?,
                 father_name = ?,
                 guardian_phone = ?,
                 address = ?,
                 student_class = ?,
                 aspiration = ?,
                 current_batch = ?,
                 photo_path = ?,
                 qr_path = ?,
                 secure_token = ?
             WHERE student_uid = ?`,
            [
                name,
                phone,
                fatherName,
                guardianPhone,
                address,
                studentClass,
                aspiration,
                nextBatches[0] || null,
                photoWebPath,
                qrWebPath,
                secureToken,
                indexRow.student_uid
            ]
        );

        await commitTransaction();

        if (photoChanged) {
            await safelyDeleteFile(oldPhotoPath);
        }

        const refreshedStudent = await hydrateStudent(await getStudentIndexByUid(indexRow.student_uid));
        broadcastStaffEvent({
            type: 'student_records_updated',
            action: 'updated',
            student_uid: indexRow.student_uid,
            phone,
            batches: nextBatches
        });

        res.json({
            status: 'success',
            message: 'Student record updated successfully.',
            student: refreshedStudent || updatedStudent
        });
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        if (photoChanged) {
            await safelyDeleteFile(photoDiskPath);
        }
        throw error;
    }
}));

app.get('/api/batches', isAuthenticated, asyncHandler(async (req, res) => {
    const batches = await allAsync('SELECT * FROM batches ORDER BY created_at DESC');
    res.json(batches);
}));

app.get('/api/public/batches', asyncHandler(async (req, res) => {
    if (!isDatabaseReady() && !(await waitForDatabaseReady(5000))) {
        res.json([]);
        return;
    }
    const batches = await allAsync(
        'SELECT batch_id AS id, name, description, created_at FROM batch_catalog WHERE is_active = 1 ORDER BY updated_at DESC, created_at DESC'
    );
    res.json(batches.map((batch) => ({
        id: batch.id,
        name: batch.name,
        description: batch.description || '',
        created_at: batch.created_at
    })));
}));

app.get('/api/batches/:name/summary', isAuthenticated, asyncHandler(async (req, res) => {
    const batchName = await resolveBatchName(decodeURIComponent(req.params.name || ''));
    if (!batchName) {
        res.status(400).json({ status: 'error', error: 'Invalid batch name.' });
        return;
    }

    const batch = await getAsync('SELECT id, name, description, created_at FROM batches WHERE name = ?', [batchName]);
    if (!batch) {
        res.status(404).json({ status: 'error', error: 'Batch not found.' });
        return;
    }

    const strength = await countStudentsForBatch(batchName);
    const activeSession = await getAsync(
        `SELECT id, session_name, start_time, is_late
         FROM attendance_sessions
         WHERE batch_id = ? AND status = 'active'
         ORDER BY start_time DESC
         LIMIT 1`,
        [batchName]
    );
    const lastSession = await getAsync(
        `SELECT id, session_name, start_time, end_time
         FROM attendance_sessions
         WHERE batch_id = ? AND status = 'closed'
         ORDER BY end_time DESC, start_time DESC
         LIMIT 1`,
        [batchName]
    );

    res.json({
        status: 'success',
        batch: {
            name: batch.name,
            description: batch.description || '',
            created_at: batch.created_at,
            strength,
            active_session: activeSession || null,
            last_session: lastSession || null
        }
    });
}));

app.post('/api/batches/assign', isAuthenticated, asyncHandler(async (req, res) => {
    const studentUid = normalizeText(req.body.student_uid);
    const requestedRaw = Array.isArray(req.body.batch_names)
        ? req.body.batch_names
        : [req.body.batch_name];

    if (!studentUid) {
        res.status(400).json({ status: 'error', error: 'Student UID is required.' });
        return;
    }

    const requestedBatches = [];
    for (const value of requestedRaw) {
        const batchName = await resolveBatchName(value);
        if (batchName) {
            requestedBatches.push(batchName);
        }
    }
    const uniqueRequested = [...new Set(requestedBatches)];

    if (uniqueRequested.length === 0) {
        res.status(400).json({ status: 'error', error: 'At least one valid batch is required.' });
        return;
    }

    const placeholders = uniqueRequested.map(() => '?').join(', ');
    const existingBatches = await allAsync(
        `SELECT name FROM batches WHERE name IN (${placeholders})`,
        uniqueRequested
    );
    const existingSet = new Set(existingBatches.map((row) => row.name));
    const missingBatches = uniqueRequested.filter((name) => !existingSet.has(name));
    if (missingBatches.length > 0) {
        res.status(404).json({ status: 'error', error: `Batch not found: ${missingBatches.join(', ')}` });
        return;
    }

    const indexRow = await getStudentIndexByUid(studentUid);
    if (!indexRow) {
        res.status(404).json({ status: 'error', error: 'Student not found.' });
        return;
    }

    const currentBatches = splitBatchNames(indexRow.batch_name);
    const toAdd = uniqueRequested.filter((batchName) => !currentBatches.includes(batchName));
    const toRemove = currentBatches.filter((batchName) => !uniqueRequested.includes(batchName));

    for (const batchName of toAdd) {
        await ensureStudentInBatch(studentUid, batchName);
    }

    for (const batchName of toRemove) {
        await removeStudentFromBatch(studentUid, batchName);
    }

    await runAsync(
        'UPDATE master_student_index SET batch_name = ? WHERE student_uid = ?',
        [joinBatchNames(uniqueRequested), studentUid]
    );

    broadcastStaffEvent({
        type: 'student_records_updated',
        action: 'batch_assign',
        student_uid: studentUid,
        batches: uniqueRequested
    });

    res.json({ status: 'success', message: 'Student batch assignment updated successfully.' });
}));

app.post('/api/batches', isAuthenticated, asyncHandler(async (req, res) => {
    const name = normalizeBatchName(req.body.name);
    const description = normalizeText(req.body.description);

    if (!name) {
        res.status(400).json({ status: 'error', error: 'Batch name is required.' });
        return;
    }

    await beginTransaction();
    try {
        await createBatchTable(name);
        const result = await runAsync('INSERT INTO batches (name, description) VALUES (?, ?)', [name, description]);
        await syncBatchCatalogEntry({ id: result.lastID, name, description });
        await commitTransaction();
        broadcastStaffEvent({
            type: 'batch_updated',
            action: 'created',
            batch_id: result.lastID,
            batch_name: name
        });
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }

    res.json({ status: 'success' });
}));

app.put('/api/batches/:id', isAuthenticated, asyncHandler(async (req, res) => {
    const batchId = Number(req.params.id);
    const newName = normalizeBatchName(req.body.name);
    const description = normalizeText(req.body.description);

    if (!batchId || !newName) {
        res.status(400).json({ status: 'error', error: 'Valid batch ID and name are required.' });
        return;
    }

    const batch = await getAsync('SELECT * FROM batches WHERE id = ?', [batchId]);
    if (!batch) {
        res.status(404).json({ status: 'error', error: 'Batch not found.' });
        return;
    }

    const oldName = batch.name;
    const oldTable = getBatchTableName(oldName);
    const newTable = getBatchTableName(newName);

    await beginTransaction();
    try {
        if (oldName !== newName) {
            const existingBatch = await getAsync('SELECT id FROM batches WHERE name = ? AND id != ?', [newName, batchId]);
            if (existingBatch) {
                await rollbackTransaction().catch(() => null);
                res.status(409).json({ status: 'error', error: 'Another batch already uses that name.' });
                return;
            }

            if (oldTable !== newTable && await tableExists(oldTable)) {
                if (await tableExists(newTable)) {
                    await rollbackTransaction().catch(() => null);
                    res.status(409).json({ status: 'error', error: 'The destination batch table already exists.' });
                    return;
                }

                await runAsync(`ALTER TABLE ${quoteIdentifier(oldTable)} RENAME TO ${quoteIdentifier(newTable)}`);
            }

            if (await tableExists(newTable)) {
                await runAsync(
                    `UPDATE ${quoteIdentifier(newTable)} SET current_batch = ? WHERE current_batch = ?`,
                    [newName, oldName]
                );
            }

            await updateMasterBatchReferences(oldName, newName);
            await runAsync('UPDATE attendance_sessions SET batch_id = ? WHERE batch_id = ?', [newName, oldName]);
            await runAsync('UPDATE attendance_weekly_reports SET batch_id = ? WHERE batch_id = ?', [newName, oldName]);
            await runAsync('UPDATE notices SET target_batch = ? WHERE target_batch = ?', [newName, oldName]);
        }

        await runAsync(
            'UPDATE batches SET name = ?, description = ? WHERE id = ?',
            [newName, description, batchId]
        );
        await syncBatchCatalogEntry({ id: batchId, name: newName, description });
        await commitTransaction();
        broadcastStaffEvent({
            type: 'batch_updated',
            action: oldName === newName ? 'updated' : 'renamed',
            batch_id: batchId,
            batch_name: newName
        });
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }

    res.json({ status: 'success' });
}));

app.delete('/api/batches/:id', isAuthenticated, asyncHandler(async (req, res) => {
    const batchId = Number(req.params.id);
    const batch = await getAsync('SELECT * FROM batches WHERE id = ?', [batchId]);

    if (!batch) {
        res.status(404).json({ status: 'error', error: 'Batch not found.' });
        return;
    }

    const tableName = getBatchTableName(batch.name);
    let studentsInBatch = [];
    const tableExistsForBatch = await tableExists(tableName);

    if (tableExistsForBatch) {
        studentsInBatch = await allAsync(
            `SELECT student_uid, photo_path, qr_path FROM ${quoteIdentifier(tableName)}`
        );
    }

    const removableStudents = [];
    for (const student of studentsInBatch) {
        const currentIndex = await getStudentIndexByUid(student.student_uid);
        const assignedBatches = splitBatchNames(currentIndex?.batch_name);
        const remainingBatches = assignedBatches.filter((name) => name !== batch.name);
        if (remainingBatches.length === 0) {
            removableStudents.push(student);
        }
    }

    await beginTransaction();
    try {
        const sessionIds = await allAsync(
            'SELECT id FROM attendance_sessions WHERE batch_id = ?',
            [batch.name]
        );
        if (sessionIds.length > 0) {
            const ids = sessionIds.map((row) => row.id);
            const placeholders = ids.map(() => '?').join(', ');
            await runAsync(`DELETE FROM attendance_records WHERE session_id IN (${placeholders})`, ids);
            await runAsync(`DELETE FROM session_students WHERE session_id IN (${placeholders})`, ids);
            await runAsync(`DELETE FROM attendance_weekly_reports WHERE session_id IN (${placeholders})`, ids);
            await runAsync('DELETE FROM attendance_sessions WHERE batch_id = ?', [batch.name]);
        }

        await runAsync('DELETE FROM notices WHERE target_batch = ?', [batch.name]);
        await runAsync('DELETE FROM materials WHERE batch_id = ?', [batchId]);
        await removeBatchFromMasterIndex(batch.name);

        for (const student of removableStudents) {
            await runAsync('DELETE FROM notifications WHERE student_uid = ?', [student.student_uid]);
            await runAsync('DELETE FROM attendance_records WHERE student_uid = ?', [student.student_uid]);
            await runAsync('DELETE FROM session_students WHERE student_uid = ?', [student.student_uid]);
        }

        if (tableExistsForBatch) {
            await runAsync(`DROP TABLE ${quoteIdentifier(tableName)}`);
        }

        await deactivateBatchCatalogEntry(batchId);
        await runAsync('DELETE FROM batches WHERE id = ?', [batchId]);
        await commitTransaction();
        broadcastStaffEvent({
            type: 'batch_updated',
            action: 'deleted',
            batch_id: batchId,
            batch_name: batch.name
        });
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }

    for (const student of removableStudents) {
        await safelyDeleteFile(student.photo_path ? resolveStoredAssetDiskPath(student.photo_path) : null);
        await safelyDeleteFile(student.qr_path ? resolveStoredAssetDiskPath(student.qr_path) : null);
    }

    broadcastStaffEvent({
        type: 'batch_updated',
        action: 'deleted',
        batch_id: batchId,
        batch_name: batch.name
    });

    res.json({ status: 'success' });
}));

app.get('/api/materials', isAuthenticated, asyncHandler(async (req, res) => {
    const materials = await listMaterials();
    res.json({ status: 'success', materials });
}));

app.get('/api/materials/:id/download', isPortalAuthenticated, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ status: 'error', error: 'Valid material id required.' });
        return;
    }

    const material = await getAsync(
        `SELECT m.*, b.name AS batch_name
         FROM materials m
         LEFT JOIN batches b ON m.batch_id = b.id
         WHERE m.id = ?`,
        [id]
    );

    if (!material) {
        res.status(404).json({ status: 'error', error: 'Material not found.' });
        return;
    }

    if (req.session.student) {
        const studentBatches = splitBatchNames(req.session.student.batches);
        const allowedBatch = normalizeBatchName(material.batch_name);
        const allowed = !allowedBatch || studentBatches.includes(allowedBatch);
        if (!allowed) {
            res.status(403).json({ status: 'error', error: 'This material is not assigned to your batch.' });
            return;
        }
    }

    const rawPath = normalizeText(material.file_path);
    if (isExternalUrl(rawPath)) {
        res.redirect(rawPath);
        return;
    }

    let diskPath = '';
    if (rawPath.startsWith('/materials/')) {
        diskPath = resolveMaterialDiskPath(rawPath);
    } else if (isAbsoluteFilePath(rawPath)) {
        diskPath = rawPath;
    }

    if (!diskPath || !(await fileExists(diskPath))) {
        res.status(404).json({ status: 'error', error: 'Stored file is missing.' });
        return;
    }

    res.download(diskPath, path.basename(diskPath));
}));

app.post('/api/materials/upload', isAuthenticated, handleMaterialUpload, asyncHandler(async (req, res) => {
    if (!req.file) {
        res.status(400).json({ status: 'error', error: 'No file uploaded.' });
        return;
    }
    const publicPath = `/materials/${req.file.filename}`;
    req.session.lastUploadedMaterial = {
        url: publicPath,
        filename: req.file.filename,
        createdAt: Date.now()
    };
    res.json({
        status: 'success',
        file: {
            url: publicPath,
            name: req.file.originalname,
            stored_name: req.file.filename,
            size: Number(req.file.size || 0),
            mimetype: normalizeText(req.file.mimetype)
        }
    });
}));

app.post('/api/materials', isAuthenticated, asyncHandler(async (req, res) => {
    const title = normalizeText(req.body.title);
    const description = normalizeText(req.body.description);
    let filePath = normalizeText(req.body.file_path);
    const batchRef = normalizeText(req.body.batch_id || req.body.batch_name);

    if (!title || !batchRef) {
        res.status(400).json({ status: 'error', error: 'Title and batch are required.' });
        return;
    }

    const resolvedBatchId = await resolveMaterialBatchId(batchRef);
    if (!resolvedBatchId) {
        res.status(404).json({ status: 'error', error: 'Target batch not found.' });
        return;
    }

    const cachedUpload = req.session?.lastUploadedMaterial;
    const hasRecentUpload = Boolean(
        cachedUpload
        && cachedUpload.url
        && String(cachedUpload.url).startsWith('/materials/')
        && (Date.now() - Number(cachedUpload.createdAt || 0) <= 10 * 60 * 1000)
    );

    if (isAbsoluteFilePath(filePath)) {
        // Backward-compat for stale browser caches: prefer the last uploaded server file.
        if (hasRecentUpload) {
            filePath = String(cachedUpload.url);
        } else {
            res.status(400).json({
                status: 'error',
                error: 'Local PC file paths are not supported in browser mode. Use "Choose File" upload or an https link.'
            });
            return;
        }
    }

    if (!filePath && hasRecentUpload) {
        filePath = String(cachedUpload.url);
    }

    if (!filePath) {
        res.status(400).json({ status: 'error', error: 'Provide an https link or upload a file first.' });
        return;
    }

    if (!filePath.startsWith('/materials/') && !isExternalUrl(filePath)) {
        res.status(400).json({ status: 'error', error: 'Use file upload, a server file path, or a full http/https link.' });
        return;
    }

    let conversionInfo = null;
    if (isConvertibleIfpShareUrl(filePath)) {
        try {
            conversionInfo = await convertIfpShareLinkToPdf({
                url: filePath,
                tempId: `material_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
                materialName: title,
                materialsDir: getCurrentTenantStoragePaths().materialsDir
            });
            filePath = conversionInfo.public_url || conversionInfo.output_pdf || filePath;
        } catch (error) {
            console.warn('[Materials] IFPShare conversion failed, keeping original link:', error?.message || error);
            conversionInfo = {
                status: 'failed',
                error: error?.message || 'IFPShare conversion failed.'
            };
        }
    }

    const result = await runAsync(
        'INSERT INTO materials (title, description, file_path, batch_id) VALUES (?, ?, ?, ?)',
        [title, description, filePath, resolvedBatchId]
    );

    if (req.session?.lastUploadedMaterial) {
        delete req.session.lastUploadedMaterial;
    }

    const inserted = await getAsync(
        `SELECT m.*, b.name AS batch_name
         FROM materials m
         LEFT JOIN batches b ON m.batch_id = b.id
         WHERE m.id = ?`,
        [result.lastID]
    );
    const material = inserted ? await enrichMaterialRecord(inserted) : null;

    const targetBatchName = normalizeBatchName(material?.batch_name || batchRef);
    const materialTitle = normalizeText(material?.title || title) || 'New Study Material';
    const materialContent = `${materialTitle} has been uploaded for ${targetBatchName || 'your batch'}.`;
    await notifyStudentsByBatch({
        targetBatch: targetBatchName,
        title: 'New Study Material',
        content: materialContent,
        notificationType: 'material',
        pushTitle: `RMC Material: ${materialTitle}`,
        pushBody: normalizeText(material?.description) || `Tap to open ${materialTitle}.`,
        pushTag: `material-${material?.id || result.lastID}`,
        url: '/student/portal'
    });
    await pushMobileNotification({
        role: 'student',
        batchNames: targetBatchName === 'ALL' ? ['ALL'] : [targetBatchName],
        title: `RMC Material: ${materialTitle}`,
        body: normalizeText(material?.description) || `Tap to open ${materialTitle}.`,
        data: {
            type: 'material',
            material_id: material?.id || result.lastID,
            batch: targetBatchName || ''
        }
    });
    await pushMobileNotification({
        role: 'staff',
        title: 'Material shared',
        body: targetBatchName === 'ALL'
            ? `${materialTitle} has been shared with all batches.`
            : `${materialTitle} has been shared with ${targetBatchName}.`,
        data: {
            type: 'material',
            material_id: material?.id || result.lastID,
            batch: targetBatchName || ''
        }
    });

    broadcastMessage({ type: 'material_update' });
    res.json({
        status: 'success',
        material,
        conversion: conversionInfo
    });
}));

app.delete('/api/materials/:id', isAuthenticated, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
        res.status(400).json({ status: 'error', error: 'Valid material id required.' });
        return;
    }
    const row = await getAsync(
        `SELECT m.file_path, m.title, m.batch_id, b.name AS batch_name
         FROM materials m
         LEFT JOIN batches b ON m.batch_id = b.id
         WHERE m.id = ?`,
        [id]
    );
    if (!row) {
        res.status(404).json({ status: 'error', error: 'Material not found.' });
        return;
    }
    await runAsync('DELETE FROM materials WHERE id = ?', [id]);

    // Only delete file if stored locally under /materials
    if (row.file_path && row.file_path.startsWith('/materials/')) {
        const diskPath = resolveMaterialDiskPath(row.file_path);
        await safelyDeleteFile(diskPath);
    }

    const materialTitle = normalizeText(row.title || row.name || 'Material') || 'Material';
    const batchName = normalizeText(row.batch_name || row.current_batch || row.target_batch || '');
    broadcastMessage({
        type: 'material_deleted',
        material_id: id,
        title: materialTitle,
        batch: batchName
    });
    await pushMobileNotification({
        role: 'student',
        batchNames: batchName ? [batchName] : [],
        title: `RMC Material deleted: ${materialTitle}`,
        body: batchName
            ? `A study material was removed from ${batchName}.`
            : 'A study material was removed.',
        data: {
            type: 'material_deleted',
            material_id: id,
            batch: batchName
        }
    }).catch((error) => {
        console.warn('[Push] Material delete student push failed:', error?.message || error);
        return 0;
    });
    await pushMobileNotification({
        role: 'staff',
        title: 'Material deleted',
        body: batchName
            ? `${materialTitle} was removed from ${batchName}.`
            : `${materialTitle} was removed.`,
        data: {
            type: 'material_deleted',
            material_id: id,
            batch: batchName
        }
    }).catch((error) => {
        console.warn('[Push] Material delete staff push failed:', error?.message || error);
        return 0;
    });
    res.json({ status: 'success' });
}));

// â”€â”€â”€ NOTICES CRUD (teacher / host side) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.get('/api/notices', isAuthenticated, asyncHandler(async (req, res) => {
    const notices = await allAsync(
        `SELECT id, title, content, target_batch, created_at
         FROM notices
         ORDER BY created_at DESC
         LIMIT 200`
    );
    res.json({ status: 'success', notices });
}));

app.post('/api/notices', isAuthenticated, asyncHandler(async (req, res) => {
    const title = normalizeText(req.body.title);
    const content = normalizeText(req.body.content);
    const requestedTarget = normalizeText(req.body.target_batch).toUpperCase() === 'ALL'
        ? 'ALL'
        : normalizeBatchName(req.body.target_batch);

    if (!title || !content || !requestedTarget) {
        res.status(400).json({ status: 'error', error: 'Title, content, and target are required.' });
        return;
    }

    let targetBatch = requestedTarget;
    if (requestedTarget !== 'ALL') {
        targetBatch = await resolveBatchName(requestedTarget);
        if (!targetBatch) {
            res.status(404).json({ status: 'error', error: 'Target batch not found.' });
            return;
        }
    }

    const insert = await runAsync(
        'INSERT INTO notices (title, content, target_batch) VALUES (?, ?, ?)',
        [title, content, targetBatch]
    );
    const notice = await getAsync(
        'SELECT id, title, content, target_batch, created_at FROM notices WHERE id = ?',
        [insert.lastID]
    );

    const targetStudentUids = await getTargetStudentUids(targetBatch);
    for (const studentUid of targetStudentUids) {
        await createStudentNotification({
            studentUid,
            title,
            content,
            notificationType: 'notice',
            batchId: targetBatch
        });
    }

    broadcastMessage({
        type: 'student_notice',
        targets: targetStudentUids,
        title,
        content,
        target_batch: targetBatch,
        notice_id: notice.id,
        created_at: notice.created_at
    });
    broadcastMessage({ type: 'notice_update' });

    await pushMobileNotification({
        role: 'student',
        batchNames: targetBatch === 'ALL' ? ['ALL'] : [targetBatch],
        title: `RMC Notice: ${title}`,
        body: content,
        data: {
            type: 'notice',
            notice_id: notice.id,
            batch: targetBatch || ''
        }
    });
    await pushMobileNotification({
        role: 'staff',
        title: 'Notice published',
        body: targetBatch === 'ALL'
            ? `${title} has been published for all batches.`
            : `${title} has been published for ${targetBatch}.`,
        data: {
            type: 'notice',
            notice_id: notice.id,
            batch: targetBatch || ''
        }
    });

    if (targetStudentUids.length > 0) {
        await sendPushToStudents(targetStudentUids, {
            title: `RMC Notice: ${title}`,
            body: content,
            tag: `notice-${notice.id}`,
            url: '/student/portal'
        });
    }

    res.json({ status: 'success', notice, recipients: targetStudentUids.length });
}));

app.delete('/api/notices/:id', isAuthenticated, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ status: 'error', error: 'Valid notice id required.' });
        return;
    }

    const row = await getAsync('SELECT id FROM notices WHERE id = ?', [id]);
    if (!row) {
        res.status(404).json({ status: 'error', error: 'Notice not found.' });
        return;
    }

    await runAsync('DELETE FROM notices WHERE id = ?', [id]);
    broadcastMessage({ type: 'notice_update' });
    res.json({ status: 'success' });
}));

// â”€â”€â”€ END NOTICES CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/api/sync/sessions', isAuthenticated, asyncHandler(async (req, res) => {
    const localSessionId = normalizeText(req.body.local_session_id);
    const clientDeviceId = normalizeText(req.body.client_device_id);
    const requestedBatchId = req.body.batch_id;
    const batchName = await resolveBatchName(requestedBatchId);
    const sessionName = normalizeText(req.body.session_name) || 'Attendance Session';
    const localCreatedAt = normalizeText(req.body.created_at) || new Date().toISOString();

    if (!localSessionId || !clientDeviceId) {
        res.status(400).json({ status: 'error', error: 'local_session_id and client_device_id are required.' });
        return;
    }
    if (!batchName) {
        res.status(400).json({ status: 'error', error: 'A valid batch is required.' });
        return;
    }

    await beginTransaction();
    try {
        const existingAlias = await getAttendanceSessionAlias(localSessionId, clientDeviceId);
        if (existingAlias?.server_session_id) {
            await commitTransaction();
            res.json({
                status: 'ok',
                local_session_id: localSessionId,
                server_session_id: Number(existingAlias.server_session_id),
                already_exists: true
            });
            return;
        }

        const reusableActiveSession = await findReusableActiveAttendanceSession(batchName, sessionName);
        let sessionRow = reusableActiveSession || null;
        let alreadyExists = Boolean(existingAlias || reusableActiveSession);

        if (!sessionRow) {
            const conflictingActiveSession = await getAsync(
                `SELECT id, batch_id, session_name
                 FROM attendance_sessions
                 WHERE status = 'active'
                 ORDER BY start_time DESC
                 LIMIT 1`
            );
            if (conflictingActiveSession) {
                const sameContext = normalizeBatchName(conflictingActiveSession.batch_id) === normalizeBatchName(batchName)
                    && normalizeText(conflictingActiveSession.session_name).toLowerCase() === sessionName.toLowerCase();
                if (!sameContext) {
                    await rollbackTransaction().catch(() => null);
                    res.status(409).json({
                        status: 'error',
                        error: 'Another attendance session is already active.',
                        active_session_id: conflictingActiveSession.id
                    });
                    return;
                }
            }

            const created = await insertAttendanceSessionFromBatch(batchName, sessionName, req.session?.user?.id || null);
            sessionRow = {
                id: created.session_id,
                session_name: created.session_name,
                batch_id: created.batch_id,
                column_name: created.column_name,
                status: 'active'
            };
            alreadyExists = false;
        }

        await upsertAttendanceSessionAlias({
            localSessionId,
            clientDeviceId,
            serverSessionId: sessionRow.id,
            batchId: batchName,
            batchName,
            sessionName,
            localCreatedAt,
            syncedAt: new Date().toISOString()
        });

        await commitTransaction();
        res.json({
            status: 'ok',
            local_session_id: localSessionId,
            server_session_id: Number(sessionRow.id),
            already_exists: alreadyExists
        });
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }
}));

app.post('/api/sync/attendance-marks', isAuthenticated, asyncHandler(async (req, res) => {
    const localSessionId = normalizeText(req.body.local_session_id);
    const clientDeviceId = normalizeText(req.body.client_device_id);
    const serverSessionId = Number(req.body.server_session_id);
    const marks = Array.isArray(req.body.marks) ? req.body.marks : null;

    if (!localSessionId || !clientDeviceId) {
        res.status(400).json({ status: 'error', error: 'local_session_id and client_device_id are required.' });
        return;
    }
    if (!Number.isFinite(serverSessionId)) {
        res.status(400).json({ status: 'error', error: 'A valid server_session_id is required.' });
        return;
    }
    if (!marks) {
        res.status(400).json({ status: 'error', error: 'marks must be an array.' });
        return;
    }

    const sessionRow = await getAsync(
        'SELECT * FROM attendance_sessions WHERE id = ? LIMIT 1',
        [serverSessionId]
    );
    if (!sessionRow) {
        res.status(404).json({ status: 'error', error: 'Session not found.' });
        return;
    }

    const aliasRow = await getAttendanceSessionAlias(localSessionId, clientDeviceId);
    if (aliasRow && Number(aliasRow.server_session_id || 0) && Number(aliasRow.server_session_id) !== serverSessionId) {
        res.status(409).json({
            status: 'error',
            error: 'The local session is already linked to a different server session.',
            server_session_id: Number(aliasRow.server_session_id)
        });
        return;
    }

    if (!aliasRow || !Number(aliasRow.server_session_id || 0)) {
        await upsertAttendanceSessionAlias({
            localSessionId,
            clientDeviceId,
            serverSessionId,
            batchId: sessionRow.batch_id,
            batchName: sessionRow.batch_id,
            sessionName: sessionRow.session_name,
            syncedAt: new Date().toISOString()
        });
    }

    const accepted = [];
    const duplicates = [];
    const rejected = [];

    for (const rawMark of marks) {
        const markKey = normalizeText(rawMark?.mark_key);
        const studentUid = normalizeText(rawMark?.student_uid);
        const status = normalizeReplayStatus(rawMark?.status);
        const markedAt = normalizeText(rawMark?.marked_at) || new Date().toISOString();

        if (!markKey) {
            rejected.push({ mark_key: markKey || null, student_uid: studentUid || null, reason: 'mark_key is required.' });
            continue;
        }
        if (!studentUid) {
            rejected.push({ mark_key: markKey, student_uid: null, reason: 'student_uid is required.' });
            continue;
        }
        if (!status) {
            rejected.push({ mark_key: markKey, student_uid: studentUid, reason: 'status must be present, late, or absent.' });
            continue;
        }
        if (status === 'absent') {
            rejected.push({ mark_key: markKey, student_uid: studentUid, reason: 'absent is not supported by the current attendance model.' });
            continue;
        }

        const rosterStudent = await getAsync(
            `SELECT student_uid
             FROM session_students
             WHERE session_id = ? AND student_uid = ?
             LIMIT 1`,
            [serverSessionId, studentUid]
        );
        if (!rosterStudent) {
            rejected.push({ mark_key: markKey, student_uid: studentUid, reason: 'student not found in the session roster.' });
            continue;
        }

        const existingByMarkKey = await getAttendanceRecordByMarkKey(markKey);
        if (existingByMarkKey) {
            duplicates.push({
                mark_key: markKey,
                student_uid: studentUid,
                server_status: attendanceCodeToReplayStatus(existingByMarkKey.status)
            });
            continue;
        }

        const existingByPair = await getAttendanceRecordBySessionStudent(serverSessionId, studentUid);
        if (existingByPair) {
            duplicates.push({
                mark_key: markKey,
                student_uid: studentUid,
                server_status: attendanceCodeToReplayStatus(existingByPair.status)
            });
            continue;
        }

        try {
            await runAsync(
                `INSERT INTO attendance_records (session_id, student_uid, timestamp, status, mark_key, local_session_id, client_device_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [serverSessionId, studentUid, markedAt, replayStatusToAttendanceCode(status), markKey, localSessionId, clientDeviceId]
            );
            accepted.push({
                mark_key: markKey,
                student_uid: studentUid,
                server_status: status
            });
        } catch (error) {
            if (!isDuplicateAttendanceError(error)) {
                rejected.push({
                    mark_key: markKey,
                    student_uid: studentUid,
                    reason: error instanceof Error ? error.message : 'Could not save attendance mark.'
                });
                continue;
            }

            const existingRow = await getAttendanceRecordByMarkKey(markKey) || await getAttendanceRecordBySessionStudent(serverSessionId, studentUid);
            if (existingRow) {
                duplicates.push({
                    mark_key: markKey,
                    student_uid: studentUid,
                    server_status: attendanceCodeToReplayStatus(existingRow.status)
                });
            } else {
                rejected.push({
                    mark_key: markKey,
                    student_uid: studentUid,
                    reason: 'Could not resolve the saved attendance row.'
                });
            }
        }
    }

    res.json({
        status: 'ok',
        accepted,
        duplicates,
        rejected
    });
}));

app.post('/api/sessions/start', isAuthenticated, asyncHandler(async (req, res) => {
    const sessionName = normalizeText(req.body.session_name) || 'Attendance Session';
    const batchName = await resolveBatchName(req.body.batch_id);

    if (!batchName) {
        res.status(400).json({ status: 'error', error: 'A valid batch is required to start a session.' });
        return;
    }

    const batch = await getAsync('SELECT * FROM batches WHERE name = ?', [batchName]);
    if (!batch) {
        res.status(404).json({ status: 'error', error: 'Batch not found.' });
        return;
    }

    const activeSession = await getAsync(
        `SELECT id, batch_id, session_name FROM attendance_sessions
         WHERE status = 'active'
         ORDER BY start_time DESC
         LIMIT 1`
    );

    if (activeSession) {
        res.status(400).json({
            status: 'error',
            error: `A session is already active for ${activeSession.batch_id}. Close it before starting a new one.`
        });
        return;
    }

    const now = new Date();
    const columnName = `att_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}_${String(now.getMinutes()).padStart(2, '0')}`;
    const batchTableName = await createBatchTable(batchName);
    let result;
    await beginTransaction();
    try {
        result = await runAsync(
            `INSERT INTO attendance_sessions (session_name, batch_id, created_by, column_name)
             VALUES (?, ?, ?, ?)`,
            [sessionName, batchName, req.session.user.id, columnName]
        );

        await runAsync(
            `INSERT INTO session_students
             (session_id, student_uid, name, phone, father_name, guardian_phone, address, student_class, aspiration, current_batch, photo_path, qr_path, secure_token)
             SELECT ?, student_uid, name, phone, father_name, guardian_phone, address, student_class, aspiration, current_batch, photo_path, qr_path, secure_token
             FROM ${quoteIdentifier(batchTableName)}`,
            [result.lastID]
        );

        await commitTransaction();
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }

    broadcastStaffEvent({
        type: 'session_started',
        session_id: result.lastID,
        session_name: sessionName,
        batch_id: batchName
    });

    res.json({
        status: 'success',
        session_id: result.lastID,
        session_name: sessionName,
        batch_id: batchName,
        column_name: columnName,
        redirect: '/staff_gateway'
    });
}));

app.post('/api/sessions/:id/late', isAuthenticated, asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const updated = await runAsync(
        `UPDATE attendance_sessions
         SET is_late = 1
         WHERE id = ? AND status = 'active'`,
        [sessionId]
    );
    if (!updated.changes) {
        res.status(404).json({ status: 'error', error: 'Active session not found.' });
        return;
    }
    broadcastStaffEvent({
        type: 'session_late_mode',
        session_id: sessionId
    });
    res.json({ status: 'success', message: 'Late entry mode active.' });
}));

app.post('/api/sessions/:id/close', isAuthenticated, asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const result = await closeSessionById(sessionId);
    res.json({
        status: 'success',
        message: 'Session officially closed.',
        absentees_count: result.absenteesCount,
        late_count: result.lateCount,
        absentee_export: result.absenteeExport ? {
            file_name: result.absenteeExport.fileName,
            file_path: result.absenteeExport.filePath,
            batch_label: result.absenteeExport.batchLabel,
            session_label: result.absenteeExport.sessionLabel
        } : null
    });
}));

app.post('/api/sessions/close', isAuthenticated, asyncHandler(async (req, res) => {
    const sessionId = Number(req.body.session_id);
    const result = await closeSessionById(sessionId);
    res.json({
        status: 'success',
        message: 'Session officially closed.',
        absentees_count: result.absenteesCount,
        late_count: result.lateCount,
        absentee_export: result.absenteeExport ? {
            file_name: result.absenteeExport.fileName,
            file_path: result.absenteeExport.filePath,
            batch_label: result.absenteeExport.batchLabel,
            session_label: result.absenteeExport.sessionLabel
        } : null
    });
}));

app.post('/api/sessions/active', isAuthenticated, asyncHandler(async (req, res) => {
    const active = await getAsync(
        `SELECT * FROM attendance_sessions
         WHERE status = 'active'
         ORDER BY start_time DESC
         LIMIT 1`
    );
    res.json({ status: 'success', active });
}));

app.get('/api/sessions/current', isAuthenticated, asyncHandler(async (req, res) => {
    const active = await getAsync(
        `SELECT * FROM attendance_sessions
         WHERE status = 'active'
         ORDER BY start_time DESC
         LIMIT 1`
    );
    if (active && !normalizeBatchName(active.batch_id)) {
        await runAsync(
            `UPDATE attendance_sessions
             SET status = 'closed', end_time = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [active.id]
        );
        res.json({ status: 'success', data: null });
        return;
    }
    res.json({
        status: 'success',
        data: active ? {
            session_id: active.id,
            session_name: active.session_name,
            batch_id: active.batch_id,
            column_name: active.column_name,
            is_late: active.is_late
        } : null
    });
}));

app.get('/api/sessions/:id/roster', isAuthenticated, asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    const sessionRow = await getAsync(
        'SELECT id, batch_id, status FROM attendance_sessions WHERE id = ?',
        [sessionId]
    );
    if (!sessionRow) {
        res.status(404).json({ status: 'error', error: 'Session not found.' });
        return;
    }

    const roster = await getSessionRoster(sessionRow.id, sessionRow.batch_id);
    const attendanceRows = await allAsync(
        `SELECT student_uid, status, timestamp
         FROM attendance_records
         WHERE session_id = ?`,
        [sessionRow.id]
    );
    const attendanceByUid = new Map(
        attendanceRows.map((row) => [
            normalizeText(row.student_uid),
            {
                status: Number(row.status || 0),
                timestamp: row.timestamp || null
            }
        ])
    );

    const rosterRows = String(req.query.summary || '').trim() === '1'
        ? roster.map((student) => summarizeStudentRow(student, sessionRow.batch_id)).filter(Boolean)
        : roster;

    const enrichedRoster = rosterRows.map((student) => {
        const attendance = attendanceByUid.get(normalizeText(student.student_uid)) || null;
        return {
            ...student,
            attendance_status: attendance?.status || 0,
            attendance_timestamp: attendance?.timestamp || null
        };
    });

    const totals = enrichedRoster.reduce((acc, student) => {
        const status = Number(student.attendance_status || 0);
        acc.total += 1;
        if (status > 0) {
            acc.marked += 1;
        }
        if (status === 1) {
            acc.present += 1;
        } else if (status === 2) {
            acc.late += 1;
        }
        return acc;
    }, {
        total: 0,
        marked: 0,
        present: 0,
        late: 0
    });

    res.json({ status: 'success', roster: enrichedRoster, totals });
}));

app.get('/api/db_version', (req, res) => {
    const tenantDialect = getCurrentTenantDbDialect();
    if (tenantDialect === 'mysql') {
        (async () => {
            try {
                const row = await getAsync(
                    `SELECT
                        UNIX_TIMESTAMP(MAX(created_at)) AS mtime
                     FROM master_student_index`
                );
                res.json({ mtime: Number(row?.mtime || 0) * 1000 });
            } catch {
                res.json({ mtime: 0 });
            }
        })();
        return;
    }

    try {
        const stats = fs.statSync(getCurrentTenantRecord()?.db?.sqliteFile || DB_FILE);
        res.json({ mtime: stats.mtimeMs });
    } catch {
        res.json({ mtime: 0 });
    }
});

app.get('/api/tenant/config', asyncHandler(async (req, res) => {
    const tenant = req.tenant || getCurrentTenantRecord();
    const storage = getCurrentTenantStoragePaths();
    res.json({
        status: 'success',
        tenant: {
            tenantKey: tenant.tenantKey,
            displayName: tenant.displayName,
            publicHost: tenant.publicHost,
            privateHost: tenant.privateHost,
            brand: tenant.brand || null,
            featureFlags: tenant.featureFlags || null
        },
        storage: {
            uploadsDir: storage.uploadsDir,
            qrcodesDir: storage.qrcodesDir,
            staffQrCodesDir: storage.staffQrCodesDir,
            materialsDir: storage.materialsDir,
            attendanceExportsDir: storage.attendanceExportsDir
        }
    });
}));

app.get('/api/admin/tenants', isAuthenticated, isHost, asyncHandler(async (_req, res) => {
    const tenants = await tenantRuntime.listTenants();
    res.json({
        status: 'success',
        tenants: tenants.map((tenant) => ({
            tenantKey: tenant.tenantKey,
            displayName: tenant.displayName,
            publicHost: tenant.publicHost,
            privateHost: tenant.privateHost,
            brand: tenant.brand,
            featureFlags: tenant.featureFlags,
            dbDialect: tenant.db?.dialect || 'mysql',
            storageMode: tenant.storage?.mode || 'tenant'
        }))
    });
}));

app.post('/api/admin/tenants', isAuthenticated, isHost, asyncHandler(async (req, res) => {
    const tenantKey = tenantRuntime.normalizeTenantKey(req.body.tenant_key || req.body.tenantKey);
    const displayName = normalizeText(req.body.display_name || req.body.displayName || tenantKey);
    const publicHost = normalizeText(req.body.public_host || req.body.publicHost || '');
    const privateHost = normalizeText(req.body.private_host || req.body.privateHost || '');
    const dbName = normalizeText(req.body.db_name || req.body.dbName || '');
    const dbHost = normalizeText(req.body.db_host || req.body.dbHost || MYSQL_HOST_ENV || '127.0.0.1');
    const dbUser = normalizeText(req.body.db_user || req.body.dbUser || MYSQL_USER_ENV || '');
    const dbPassword = String(req.body.db_password || req.body.dbPassword || MYSQL_PASSWORD_ENV || '');
    const dbPort = Number(req.body.db_port || req.body.dbPort || MYSQL_PORT_ENV || 3306);
    const brand = req.body.brand && typeof req.body.brand === 'object' ? req.body.brand : {};
    const featureFlags = req.body.feature_flags && typeof req.body.feature_flags === 'object' ? req.body.feature_flags : {};

    if (!tenantKey) {
        res.status(400).json({ status: 'error', error: 'tenant_key is required.' });
        return;
    }
    if (!dbName) {
        res.status(400).json({ status: 'error', error: 'db_name is required.' });
        return;
    }

    const record = await tenantRuntime.upsertTenantRecord({
        tenantKey,
        displayName,
        publicHost,
        privateHost,
        aliases: [publicHost, privateHost].filter(Boolean),
        brand: {
            title: normalizeText(brand.title || displayName),
            subtitle: normalizeText(brand.subtitle || 'Concept Se Selection Tak'),
            accent: normalizeText(brand.accent || '#166534'),
            background: normalizeText(brand.background || '#f1faee')
        },
        featureFlags: {
            sms: featureFlags.sms !== false,
            materials: featureFlags.materials !== false,
            notices: featureFlags.notices !== false,
            attendance: featureFlags.attendance !== false,
            tests: featureFlags.tests !== false
        },
        db: {
            dialect: 'mysql',
            mysql: {
                host: dbHost,
                user: dbUser,
                password: dbPassword,
                database: dbName,
                port: Number.isFinite(dbPort) ? dbPort : 3306,
                ssl: false
            }
        },
        storage: {
            mode: 'tenant'
        }
    });

    await tenantRuntime.ensureTenantStorageDirs(record);
    res.json({
        status: 'success',
        tenant: {
            tenantKey: record.tenantKey,
            displayName: record.displayName,
            publicHost: record.publicHost,
            privateHost: record.privateHost
        },
        note: 'Tenant registry updated. Provision the target MySQL database before routing traffic to this tenant.'
    });
}));

app.get('/api/mobile/manifest', asyncHandler(async (req, res) => {
    const appManifest = await getCurrentMobileManifestApp();
    await announceMobileUpdateIfNeeded(appManifest).catch((error) => {
        console.warn('[MOBILE] Update announcement failed:', error?.message || error);
    });
    const resolvedTenant = req.tenant || getCurrentTenantRecord();
    const tenantStorage = getCurrentTenantStoragePaths();

    const notices = [];
    const materials = [];
    const staffAlerts = [];
    const feedItems = [];
    const sessionStudent = req.session?.student || null;
    const sessionUser = req.session?.user || null;

    if (sessionStudent) {
        const batches = await getStudentSessionBatchesResolved(sessionStudent);
        if (batches.length > 0) {
            const placeholders = batches.map(() => 'TRIM(UPPER(?))').join(', ');
            const studentMaterials = await allAsync(
                `SELECT m.*, b.name AS batch_name
                 FROM materials m
                 LEFT JOIN batches b ON m.batch_id = b.id
                 WHERE m.batch_id IS NULL OR TRIM(UPPER(b.name)) IN (${placeholders})
                 ORDER BY m.created_at DESC
                 LIMIT 10`,
                batches
            );
            materials.push(...await Promise.all(studentMaterials.map(enrichMaterialRecord)));

            const studentNotices = await allAsync(
                `SELECT *
                 FROM notices
                 WHERE TRIM(UPPER(target_batch)) = 'ALL'
                    OR TRIM(UPPER(target_batch)) IN (${placeholders})
                 ORDER BY created_at DESC
                 LIMIT 10`,
                batches
            );
            notices.push(...studentNotices);
        } else {
            const studentMaterials = await allAsync(
                `SELECT m.*, b.name AS batch_name
                 FROM materials m
                 LEFT JOIN batches b ON m.batch_id = b.id
                 WHERE m.batch_id IS NULL
                 ORDER BY m.created_at DESC
                 LIMIT 10`
            );
            materials.push(...await Promise.all(studentMaterials.map(enrichMaterialRecord)));

            const studentNotices = await allAsync(
                `SELECT *
                 FROM notices
                 WHERE TRIM(UPPER(target_batch)) = 'ALL'
                 ORDER BY created_at DESC
                 LIMIT 10`
            );
            notices.push(...studentNotices);
        }
    } else if (sessionUser) {
        const staffMaterials = await allAsync(
            `SELECT m.*, b.name AS batch_name
             FROM materials m
             LEFT JOIN batches b ON m.batch_id = b.id
             ORDER BY m.created_at DESC
             LIMIT 10`
        );
        materials.push(...await Promise.all(staffMaterials.map(enrichMaterialRecord)));

        const staffNotices = await allAsync(
            `SELECT id, title, content, target_batch, created_at
             FROM notices
             ORDER BY created_at DESC
             LIMIT 10`
        );
        notices.push(...staffNotices);

        const recentAlerts = await allAsync(
            `SELECT id, alert_type, title, content, target_roles, metadata_json, created_at
             FROM staff_alerts
             ORDER BY created_at DESC, id DESC
             LIMIT 10`
        );
        staffAlerts.push(...recentAlerts);
    }

    for (const notice of notices.slice(0, 5)) {
        feedItems.push({
            id: `notice-${notice.id}`,
            kind: 'notice',
            title: normalizeText(notice.title) || 'Notice',
            body: normalizeText(notice.content),
            created_at: notice.created_at,
            target_batch: normalizeText(notice.target_batch || '')
        });
    }
    for (const material of materials.slice(0, 5)) {
        feedItems.push({
            id: `material-${material.id}`,
            kind: 'material',
            title: normalizeText(material.title) || 'Material',
            body: normalizeText(material.description || material.batch_name || 'New study material'),
            created_at: material.created_at,
            target_batch: normalizeText(material.batch_name || '')
        });
    }
    for (const alert of staffAlerts.slice(0, 5)) {
        feedItems.push({
            id: `alert-${alert.id}`,
            kind: 'alert',
            title: normalizeText(alert.title) || 'Student alert',
            body: normalizeText(alert.content || ''),
            created_at: alert.created_at,
            target_batch: ''
        });
    }
    feedItems.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({
        status: 'success',
        tenant: {
            tenantKey: resolvedTenant.tenantKey,
            displayName: resolvedTenant.displayName,
            publicHost: resolvedTenant.publicHost,
            privateHost: resolvedTenant.privateHost,
            brand: resolvedTenant.brand || null,
            featureFlags: resolvedTenant.featureFlags || null
        },
        storage: {
            uploadsDir: tenantStorage.uploadsDir,
            qrcodesDir: tenantStorage.qrcodesDir,
            staffQrCodesDir: tenantStorage.staffQrCodesDir,
            materialsDir: tenantStorage.materialsDir,
            attendanceExportsDir: tenantStorage.attendanceExportsDir
        },
        app: appManifest,
        feed: {
            notices,
            materials,
            items: feedItems
        },
        checked_at: new Date().toISOString()
    });
}));

app.get('/api/session', asyncHandler(async (req, res) => {
    if (req.session?.user) {
        const user = await getAsync(
            'SELECT id, username, role, full_name, phone FROM users WHERE id = ?',
            [req.session.user.id]
        );

        res.json({
            status: 'success',
            authenticated: true,
            session_type: 'staff',
            user: user || req.session.user
        });
        return;
    }

    if (req.session?.student) {
        res.json({
            status: 'success',
            authenticated: true,
            session_type: 'student',
            student: req.session.student
        });
        return;
    }

    res.json({
        status: 'success',
        authenticated: false,
        session_type: null
    });
}));

app.post('/api/mobile/push/register', asyncHandler(async (req, res) => {
    const token = normalizeText(req.body.token);
    const requestedRole = normalizeText(req.body.role).toLowerCase();
    const appVersion = normalizeText(req.body.app_version);
    const appConfigVersion = Number(req.body.config_version || 0) || 0;
    const pushProvider = normalizeText(req.body.push_provider);
    const platform = normalizeText(req.body.platform);
    const deviceName = normalizeText(req.body.device_name);
    const ownerLabel = normalizeText(req.body.owner_label);
    const batchNames = Array.isArray(req.body.batch_names) ? req.body.batch_names : [];

    if (!token) {
        res.status(400).json({ status: 'error', error: 'Push token is required.' });
        return;
    }

    if (requestedRole !== 'staff' && requestedRole !== 'student' && requestedRole !== 'device') {
        res.status(400).json({ status: 'error', error: 'A valid role is required.' });
        return;
    }

    let resolvedOwnerKey = '';
    let resolvedOwnerLabel = ownerLabel;
    let resolvedBatchNames = batchNames;

    if (requestedRole === 'device') {
        resolvedOwnerKey = normalizeText(req.body.owner_key) || `device:${token.slice(0, 48)}`;
        resolvedOwnerLabel = resolvedOwnerLabel || 'App Device';
        resolvedBatchNames = [];
    } else {
        if (!req.session?.user && !req.session?.student) {
            res.status(401).json({ status: 'error', error: 'Login required.' });
            return;
        }

        if (requestedRole === 'staff') {
            if (!req.session?.user) {
                res.status(403).json({ status: 'error', error: 'Staff session required.' });
                return;
            }
            resolvedOwnerKey = String(req.session.user.username || req.session.user.id);
            if (!resolvedOwnerLabel) {
                resolvedOwnerLabel = req.session.user.full_name || req.session.user.username || 'Staff';
            }
            resolvedBatchNames = [];
        } else {
            if (!req.session?.student) {
                res.status(403).json({ status: 'error', error: 'Student session required.' });
                return;
            }
            resolvedOwnerKey = req.session.student.student_uid;
            if (!resolvedOwnerLabel) {
                resolvedOwnerLabel = req.session.student.name || req.session.student.student_uid;
            }
            resolvedBatchNames = normalizePushBatchList(
                req.session.student.system_batches || req.session.student.batches || req.session.student.batch_name || batchNames
            );
        }
    }

    await upsertMobilePushToken({
        role: requestedRole,
        ownerKey: resolvedOwnerKey,
        ownerLabel: resolvedOwnerLabel,
        batchNames: resolvedBatchNames,
        token,
        pushProvider,
        platform,
        deviceName,
        appVersion
    });

    const currentManifest = await getCurrentMobileManifestApp();
    const currentUpdateMode = normalizeText(currentManifest.update_mode || 'none').toLowerCase();
    const needsConfigUpdate = currentUpdateMode === 'config'
        && Number(currentManifest.config_version || 0) > appConfigVersion;
    const needsApkUpdate = currentUpdateMode === 'apk'
        && compareVersionStrings(currentManifest.version, appVersion) > 0;
    if (needsConfigUpdate || needsApkUpdate) {
        const announcement = buildMobileUpdateAnnouncement(currentManifest);
        const previousAnnouncement = await readJsonFile(MOBILE_UPDATE_BROADCAST_FILE, null);
        if (previousAnnouncement?.signature !== announcement.signature) {
            const delivered = await pushMobileNotification({
                role: 'all',
                title: announcement.title,
                body: announcement.body,
                data: announcement.data,
            }).catch((error) => {
                console.warn('[MOBILE] Targeted update push failed:', error?.message || error);
                return 0;
            });
            await writeJsonFile(MOBILE_UPDATE_BROADCAST_FILE, {
                ...announcement,
                sent_at: new Date().toISOString(),
                delivered_to: delivered
            });
        }
    }

    res.json({ status: 'success' });
}));

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ status: 'success' });
    });
});

app.post('/api/student/logout', (req, res) => {
    clearStudentRememberCookie(res);
    if (req.session) {
        delete req.session.student;
        delete req.session.user;
        delete req.session.tenantKey;
    }
    res.json({ status: 'success' });
});

app.post('/api/delete_student', isAuthenticated, isHost, asyncHandler(async (req, res) => {
    const studentUid = normalizeText(req.body.student_uid);
    if (!studentUid) {
        res.status(400).json({ status: 'error', error: 'Student UID is required.' });
        return;
    }

    const indexRow = await getStudentIndexByUid(studentUid);
    if (!indexRow) {
        res.status(404).json({ status: 'error', error: 'Student not found.' });
        return;
    }

    const batches = splitBatchNames(indexRow.batch_name);
    const studentPhone = normalizeText(indexRow.phone);
    const source = await getSourceStudentRow(studentUid, batches);
    const photoPath = source?.student?.photo_path ? resolveStoredAssetDiskPath(source.student.photo_path) : null;
    const qrPath = source?.student?.qr_path ? resolveStoredAssetDiskPath(source.student.qr_path) : null;

    for (const batchName of batches) {
        const tableName = getBatchTableName(batchName);
        if (await tableExists(tableName)) {
            await runAsync(
                `DELETE FROM ${quoteIdentifier(tableName)} WHERE student_uid = ?`,
                [studentUid]
            );
        }
    }

    await runAsync('DELETE FROM attendance_records WHERE student_uid = ?', [studentUid]);
    await runAsync('DELETE FROM session_students WHERE student_uid = ?', [studentUid]);
    await runAsync('DELETE FROM notifications WHERE student_uid = ?', [studentUid]);
    await runAsync('DELETE FROM master_student_index WHERE student_uid = ?', [studentUid]);
    await revokePhoneIdCardApproval(studentPhone);
    await safelyDeleteFile(photoPath);
    await safelyDeleteFile(qrPath);

    broadcastStaffEvent({
        type: 'student_records_updated',
        action: 'deleted',
        student_uid: studentUid,
        phone: studentPhone
    });

    res.json({ status: 'success', message: 'Student and files permanently purged.' });
}));

app.get('/api/admin/system_stats', isAuthenticated, isHost, asyncHandler(async (req, res) => {
    const tenantDialect = getCurrentTenantDbDialect();
    const tables = tenantDialect === 'mysql'
        ? await allAsync(
            `SELECT table_name AS name
             FROM information_schema.tables
             WHERE table_schema = DATABASE()
             ORDER BY table_name ASC`
        )
        : await allAsync(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        );

    const tableStats = [];
    for (const table of tables) {
        const count = await getAsync(
            `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`
        );
        tableStats.push({
            table: table.name,
            rows: count?.count || 0
        });
    }

    res.json({
        status: 'success',
        tables: tableStats,
        db_size: tenantDialect === 'sqlite' ? (await fsp.stat(getCurrentTenantRecord()?.db?.sqliteFile || DB_FILE)).size : 0,
        uptime: process.uptime()
    });
}));

app.delete('/api/admin/tables/:tableName', isAuthenticated, isHost, asyncHandler(async (req, res) => {
    const tableName = normalizeText(req.params.tableName);
    if (!isSafeIdentifier(tableName)) {
        res.status(400).json({ status: 'error', error: 'Invalid table name.' });
        return;
    }

    if (CORE_TABLES.has(tableName) || /^batch_.+_students$/.test(tableName)) {
        res.status(403).json({ status: 'error', error: 'Use the Batch Manager for managed tables.' });
        return;
    }

    if (!(await tableExists(tableName))) {
        res.status(404).json({ status: 'error', error: 'Table not found.' });
        return;
    }

    await runAsync(`DROP TABLE ${quoteIdentifier(tableName)}`);
    res.json({ status: 'success', message: `Table ${tableName} dropped successfully.` });
}));

app.put('/api/admin/tables/:tableName', isAuthenticated, isHost, asyncHandler(async (req, res) => {
    const tableName = normalizeText(req.params.tableName);
    const newName = normalizeText(req.body.newName);

    if (!isSafeIdentifier(tableName) || !isSafeIdentifier(newName)) {
        res.status(400).json({ status: 'error', error: 'Table names must contain only letters, numbers, and underscores.' });
        return;
    }

    if (CORE_TABLES.has(tableName) || /^batch_.+_students$/.test(tableName)) {
        res.status(403).json({ status: 'error', error: 'Use the Batch Manager for managed tables.' });
        return;
    }

    if (!(await tableExists(tableName))) {
        res.status(404).json({ status: 'error', error: 'Table not found.' });
        return;
    }

    if (await tableExists(newName)) {
        res.status(409).json({ status: 'error', error: 'A table with the new name already exists.' });
        return;
    }

    await runAsync(
        `ALTER TABLE ${quoteIdentifier(tableName)} RENAME TO ${quoteIdentifier(newName)}`
    );
    res.json({ status: 'success', message: `Table renamed to ${newName}.` });
}));

app.post('/api/admin/system_reset', isAuthenticated, isHost, asyncHandler(async (req, res) => {
    try {
        await beginTransaction();
        const tenantDialect = getCurrentTenantDbDialect();

        const batchTables = tenantDialect === 'mysql'
            ? await allAsync(
                `SELECT table_name AS name
                 FROM information_schema.tables
                 WHERE table_schema = DATABASE()
                   AND table_name LIKE 'batch\\_%\\_students'`
            )
            : await allAsync(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'batch_%_students'"
            );

        for (const table of batchTables) {
            await runAsync(`DROP TABLE ${quoteIdentifier(table.name)}`);
        }

        // Clear children first to satisfy foreign-key constraints.
        const tablesToClear = [
            'attendance_records',
            'materials',
            'notifications',
            'notices',
            'leads',
            'attendance_weekly_reports',
            'push_subscriptions',
            'test_submissions',
            'test_launches',
            'test_questions',
            'test_papers',
            'session_students',
            'attendance_sessions',
            'master_student_index',
            'batch_catalog',
            'batches'
        ];
        for (const tableName of tablesToClear) {
            if (await tableExists(tableName)) {
                await runAsync(`DELETE FROM ${quoteIdentifier(tableName)}`);
                if (tenantDialect === 'sqlite') {
                    await runAsync('DELETE FROM sqlite_sequence WHERE name = ?', [tableName]).catch(() => null);
                }
            }
        }

        await commitTransaction();
    } catch (error) {
        await rollbackTransaction().catch(() => null);
        throw error;
    }

    for (const directory of [
        getCurrentTenantStoragePaths().uploadsDir,
        getCurrentTenantStoragePaths().qrcodesDir,
        getCurrentTenantStoragePaths().materialsDir
    ]) {
        const entries = await fsp.readdir(directory).catch(() => []);
        for (const entry of entries) {
            await safelyDeleteFile(path.join(directory, entry));
        }
    }

    if (req.session) {
        delete req.session.lastUploadedMaterial;
        delete req.session.student;
    }
    clearStudentRememberCookie(res);
    clearRuntimeSessionState();

    res.json({ status: 'success', message: 'System reset complete. Student data, batches, materials, tests, notices, and leads were purged while staff accounts were preserved.' });
}));

app.post('/api/students/preview', isAuthenticated, asyncHandler(async (req, res) => {
    const token = extractToken(req.body.token);
    if (!token) {
        res.status(400).json({ status: 'error', error: 'Missing token.' });
        return;
    }

    const indexRow = await getAsync(
        'SELECT * FROM master_student_index WHERE secure_token = ?',
        [token]
    );
    if (!indexRow) {
        res.status(404).json({ status: 'error', error: 'Token not found or expired.' });
        return;
    }

    const student = await hydrateStudent(indexRow);
    if (!student) {
        res.status(404).json({ status: 'error', error: 'Student profile data is missing.' });
        return;
    }

    res.json({ status: 'success', data: student });
}));

app.post('/api/verify_qr', isAuthenticated, asyncHandler(async (req, res) => {
    const token = extractToken(req.body.token);
    if (!token) {
        res.status(400).json({ status: 'error', error: 'Missing token.' });
        return;
    }

    const requestedSessionId = req.body.session_id;
    const requestedBatch = normalizeBatchName(req.body.batch_id);

    if (requestedSessionId) {
        const verification = await verifyStudentForSession(token, requestedSessionId, requestedBatch);
        if (!verification.ok) {
            res.status(verification.statusCode || 400).json({ status: 'error', error: verification.error });
            return;
        }

        res.json({
            status: 'success',
            data: verification.student,
            session_id: verification.session.id,
            batch_id: verification.session.batch_id,
            already_marked: Boolean(verification.alreadyMarked),
            attendance_status: Number(verification.attendanceStatus || 0)
        });
        return;
    }

    const student = await verifyStudentToken(token);
    if (!student) {
        res.status(404).json({ status: 'error', error: 'Token not found or expired.' });
        return;
    }

    res.json({ status: 'success', data: student });
}));

app.get('/api/batches/:name/history', isAuthenticated, asyncHandler(async (req, res) => {
    const batchName = normalizeBatchName(req.params.name);
    const sessions = await allAsync(
        `SELECT id, session_name, start_time
         FROM attendance_sessions
         WHERE batch_id = ?
           AND status = 'closed'
         ORDER BY start_time ASC`,
        [batchName]
    );

    if (sessions.length === 0) {
        res.json([]);
        return;
    }

    const history = [];
    for (const sessionRow of sessions) {
        const counts = await getAsync(
            `SELECT
                SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS present,
                SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS late,
                COUNT(*) AS total_marked
             FROM attendance_records
             WHERE session_id = ?`,
            [sessionRow.id]
        );
        const rosterCountRow = await getAsync(
            'SELECT COUNT(*) AS count FROM session_students WHERE session_id = ?',
            [sessionRow.id]
        );
        const totalStudents = rosterCountRow?.count || counts?.total_marked || 0;

        history.push({
            session_id: sessionRow.id,
            batch_id: batchName,
            date: formatDateTimeIST(sessionRow.start_time),
            present: counts?.present || 0,
            late: counts?.late || 0,
            total: totalStudents || counts?.total_marked || 0,
            session_name: sessionRow.session_name
        });
    }

    res.json(history);
}));

app.get('/api/student_details/:uid', isAuthenticated, asyncHandler(async (req, res) => {
    const studentUid = normalizeText(req.params.uid);
    const indexRow = await getStudentIndexByUid(studentUid);

    if (!indexRow) {
        res.status(404).json({ status: 'error', error: 'Student not found.' });
        return;
    }

    const student = await hydrateStudent(indexRow);
    if (!student) {
        res.status(404).json({ status: 'error', error: 'Student profile data is missing.' });
        return;
    }

    res.json({ status: 'success', data: student });
}));

app.get('/api/students/lookup-by-phone', isAuthenticated, asyncHandler(async (req, res) => {
    const phone = normalizeText(req.query.phone);
    if (!phone) {
        res.status(400).json({ status: 'error', error: 'Phone is required.' });
        return;
    }

    const indexRow = await getAsync(
        `SELECT *
         FROM master_student_index
         WHERE phone = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [phone]
    );
    if (!indexRow) {
        res.status(404).json({ status: 'error', error: 'No student found for this phone.' });
        return;
    }

    const student = await hydrateStudent(indexRow);
    if (!student) {
        res.status(404).json({ status: 'error', error: 'Student profile data is missing.' });
        return;
    }

    res.json({ status: 'success', data: student });
}));

app.get('/api/reports/batch/:name', isAuthenticated, asyncHandler(async (req, res) => {
    const report = await getBatchReportData(await resolveBatchName(req.params.name));
    res.json({ status: 'success', ...report });
}));

app.get('/api/reports/attendance_alerts', isAuthenticated, asyncHandler(async (req, res) => {
    const rows = await allAsync(
        `SELECT id, batch_id, session_id, window_start, window_end, low_count, total_students, summary, report_json, is_read, created_at
         FROM attendance_weekly_reports
         ORDER BY created_at DESC
         LIMIT 50`
    );

    const alerts = rows.map((row) => {
        let report = null;
        try {
            report = row.report_json ? JSON.parse(row.report_json) : null;
        } catch {
            report = null;
        }

        return {
            ...row,
            report,
            lowAttendanceStudents: report?.lowAttendanceStudents || [],
            sessions: report?.sessions || []
        };
    });

    res.json({ status: 'success', alerts });
}));

app.get('/api/reports/absentees/export', isAuthenticated, asyncHandler(async (req, res) => {
    const exportData = await getAbsenteeExportData(req.query.session_id);
    const session = exportData.session;
    const absentees = exportData.absentees || [];
    const headers = [
        'UID',
        'Name',
        'Phone',
        'Father Name',
        'Guardian Phone',
        'Class',
        'Aspiration',
        'Address',
        'Batch',
        'Session',
        'Session Date',
        'Message',
        'Message Link'
    ];
    const lines = [headers.map(escapeCsv).join(',')];

    for (const student of absentees) {
        const phone = student.guardian_phone || student.phone || '';
        const linkFormula = student.sms_link
            ? `=HYPERLINK("${student.sms_link.replace(/"/g, '""')}","Open SMS App")`
            : '';

        lines.push([
            student.student_uid,
            student.name,
            student.phone,
            student.father_name,
            student.guardian_phone,
            student.student_class,
            student.aspiration,
            student.address,
            student.current_batch || student.batch_name || session.batch_id,
            session.session_name,
            session.start_time,
            student.message,
            linkFormula || student.sms_link || ''
        ].map(escapeCsv).join(','));
    }

    const safeBatch = String(session.batch_id || 'batch').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const safeSession = String(session.session_name || 'session').replace(/[^a-zA-Z0-9_-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=RMC_${safeBatch}_${safeSession}_Absentees.csv`);
    res.status(200).send(lines.join('\n'));
}));

app.get('/api/reports/tests/export', isAuthenticated, asyncHandler(async (req, res) => {
    const report = await getBatchTestReportData(req.query.batch);
    const testColumns = report.tests.map((test) => test.column_label);
    const lines = [[
        'UID',
        'Name',
        ...testColumns
    ].map(escapeCsv).join(',')];

    for (const student of report.students) {
        lines.push([
            student.student_uid,
            student.name,
            ...testColumns.map((column) => student.scores[column] || 'Not Attempted')
        ].map(escapeCsv).join(','));
    }

    const safeBatch = String(report.batch || 'batch').replace(/[^a-zA-Z0-9_-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=RMC_${safeBatch}_Test_Report.csv`);
    res.status(200).send(lines.join('\n'));
}));

app.get('/api/admin/export_csv', isAuthenticated, asyncHandler(async (req, res) => {
    const selectedBatch = await resolveBatchName(req.query.batch);
    if (selectedBatch && selectedBatch.toUpperCase() !== 'ALL') {
        const report = await getBatchReportData(selectedBatch);
        const fixedColumns = [
            'UID',
            'Name',
            'Phone',
            'Father Name',
            'Guardian Phone',
            'Class',
            'Aspiration',
            'Address',
            'Batch',
            'Attendance %'
        ];
        const sessionColumns = report.sessions.map((session) => session.label);
        const lines = [[...fixedColumns, ...sessionColumns].map(escapeCsv).join(',')];

        for (const student of report.students) {
            const baseValues = [
                student.student_uid,
                student.name,
                student.phone,
                student.father_name,
                student.guardian_phone,
                student.student_class,
                student.aspiration,
                student.address,
                student.current_batch || report.batch,
                student.attendance_percent
            ];
            const sessionValues = report.sessions.map((session) => student.attendance[String(session.id)] || 'Absent');
            lines.push([...baseValues, ...sessionValues].map(escapeCsv).join(','));
        }

        const safeBatch = selectedBatch.replace(/[^a-zA-Z0-9_-]+/g, '_');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=RMC_${safeBatch}_Attendance_Export.csv`);
        res.status(200).send(lines.join('\n'));
        return;
    }

    const students = await fetchAllStudentsDetailed();
    const lines = [
        'UID,Name,Phone,Batches,CurrentBatch,EnrollmentDate'
    ];

    for (const student of students) {
        lines.push([
            escapeCsv(student.student_uid),
            escapeCsv(student.name),
            escapeCsv(student.phone),
            escapeCsv(student.batch_name),
            escapeCsv(student.current_batch),
            escapeCsv(student.created_at)
        ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=Vanguard_Master_Export.csv');
    res.status(200).send(lines.join('\n'));
}));

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

app.get('/student/logout', (req, res) => {
    clearStudentRememberCookie(res);
    if (req.session) {
        delete req.session.student;
        delete req.session.user;
        delete req.session.tenantKey;
    }
    res.redirect('/student/login');
});

app.use((req, res) => {
    if (isApiRequest(req)) {
        res.status(404).json({ status: 'error', error: 'Endpoint not found.' });
        return;
    }

    res.status(404).send('Page not found.');
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        next(error);
        return;
    }

    console.error('Unhandled Server Error:', error);
    const rawMessage = String(error?.message || '');
    const dbUnavailable = rawMessage.includes('Database not initialized.');
    const dbFailed = Boolean(dbInitError);
    const statusCode = error.statusCode || (dbUnavailable ? (dbFailed ? 500 : 503) : 500);
    let message = statusCode >= 500 ? 'Internal Server Error' : rawMessage;

    if (dbUnavailable) {
        message = dbFailed
            ? 'Database initialization failed. Check the hosting database configuration and redeploy.'
            : 'Service is still starting. Please try again in a few seconds.';
    }

    if (isApiRequest(req)) {
        res.status(statusCode).json({ status: 'error', error: message });
        return;
    }

    res.status(statusCode).send(message);
});

async function startServer() {
    if (serverInstance) {
        return serverInstance;
    }

    ensureDbInitialization().catch(() => {
        // Keep server booting so Hostinger can still serve health/status routes.
    });

    serverInstance = await new Promise((resolve, reject) => {
        const instance = app.listen(PORT, (error) => {
            if (error) {
                reject(error);
                return;
            }

            logger.server(`RMC Running on ${PORT}`);
            resolve(instance);
        });
    });

    // Initialize WebSocket Server
    wss = new WebSocket.Server({ server: serverInstance });
    wss.on('connection', (ws) => {
        console.log('[WS] New client connected');
        ws.on('close', () => console.log('[WS] Client disconnected'));
    });

    return serverInstance;
}

const SHOULD_AUTO_INIT_DB = !['1', 'true', 'yes', 'on'].includes(String(process.env.RMC_SKIP_AUTO_INIT || '').trim().toLowerCase());

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Startup failure:', error);
        process.exit(1);
    });
} else if (SHOULD_AUTO_INIT_DB) {
    ensureDbInitialization().catch(() => {
        // Hostinger's Express preset loads the module without calling startServer().
    });
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.ensureDbInitialization = ensureDbInitialization;
module.exports.migrateSqliteDataToMysqlIfNeeded = migrateSqliteDataToMysqlIfNeeded;
module.exports.getDbClient = () => dbClient;
module.exports.buildWeeklyAttendanceReport = buildWeeklyAttendanceReport;
module.exports.generateAndStoreWeeklyAttendanceReport = generateAndStoreWeeklyAttendanceReport;
module.exports.queueWeeklyAttendanceReportGeneration = queueWeeklyAttendanceReportGeneration;

burstQueue.startBurstQueueConsumer({
    workerName: process.env.BURST_QUEUE_WORKER_NAME || 'rmc-burst-core',
    pollIntervalMs: Number(process.env.BURST_QUEUE_POLL_INTERVAL_MS || 4000)
});
