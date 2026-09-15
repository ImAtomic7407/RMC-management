import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  Animated,
  Easing
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';

type StudentProfile = {
  id: number;
  name: string;
  student_uid: string;
  phone: string;
  father_name: string;
  guardian_phone: string;
  address: string;
  student_class: string;
  current_batch: string;
  batch_name?: string;
  aspiration: string;
  photo: string | null;
  photo_path?: string | null;
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

type SessionInfo = { type: 'student'; student: StudentProfile } | { type: 'staff'; user: StaffUser } | null;
type GuestTab = 'welcome' | 'student' | 'staff' | 'register';
type StudentTab = 'overview' | 'tests' | 'doubts';
type StaffTab = 'home' | 'attendance' | 'students' | 'batches' | 'materials' | 'notifications' | 'reports' | 'tests' | 'doubts' | 'admin';
type StaffNotificationSection = 'notices' | 'absentees' | 'test_reports' | 'leads' | 'id_requests';

type StaffNotification = {
  id: number;
  title?: string;
  content: string;
  notification_type?: string;
  created_at: string;
};

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
  photo_path?: string | null;
};

type SessionCurrentResponse = {
  session_id: number;
  session_name: string;
  batch_id: string;
  column_name: string;
  is_late: number;
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
  current_batch: string;
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

const STORAGE_BASE_URL = 'rmc_mobile_base_url';
const STORAGE_COOKIE = 'rmc_mobile_cookie';
const LOCKED_SERVER_URL = 'https://private.riteshmathematics.in';

function normalizeBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function makeAbsoluteUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
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

function prettyDate(value?: string) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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

const POLL_FAST_MS = 1000;
const POLL_MED_MS = 5000;
const POLL_SLOW_MS = 20000;

function stripToken(raw: string) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

function splitBatchNames(value?: string | string[]) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split(',').map((batch) => batch.trim()).filter(Boolean);
}

function batchMatches(student: StudentRow, batchName: string) {
  return splitBatchNames(student.batch_name || student.current_batch).includes(batchName);
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

function PrimaryButton(props: { title: string; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'secondary' | 'danger' | 'success' }) {
  const isSecondary = props.tone === 'secondary';
  const toneStyle = isSecondary ? styles.buttonSecondary : props.tone === 'danger' ? styles.buttonDanger : props.tone === 'success' ? styles.buttonSuccess : styles.buttonPrimary;
  return (
    <Pressable disabled={props.disabled} onPress={props.onPress} style={[styles.button, toneStyle, props.disabled && styles.buttonDisabled]}>
      <Text style={[styles.buttonText, isSecondary && styles.buttonTextSecondary]}>{props.title}</Text>
    </Pressable>
  );
}

function LabeledInput(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'words' | 'characters' | 'sentences'; keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'url'; }) {
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
        style={[styles.input, props.multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function PillTabs(props: { items: Array<{ key: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
      {props.items.map((item) => (
        <Pressable key={item.key} onPress={() => props.onChange(item.key)} style={[styles.tabChip, props.value === item.key && styles.tabChipActive]}>
          <Text style={[styles.tabChipText, props.value === item.key && styles.tabChipTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ScannerModal(props: { visible: boolean; title: string; subtitle: string; onClose: () => void; onScan: (value: string) => Promise<void> | void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (props.visible && !permission?.granted) {
      requestPermission().catch(() => null);
    }
  }, [permission?.granted, props.visible, requestPermission]);

  const handleScan = useCallback(async (result: BarcodeScanningResult) => {
    if (locked) return;
    setLocked(true);
    try {
      await props.onScan(result.data);
    } finally {
      setTimeout(() => setLocked(false), 1200);
    }
  }, [locked, props]);

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
        {!permission?.granted ? (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Camera permission needed</Text>
            <Text style={styles.emptyBody}>Allow access so the app can scan student and staff QR cards.</Text>
            <PrimaryButton title="Allow Camera" onPress={() => requestPermission()} />
          </View>
        ) : (
          <View style={styles.cameraShell}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={locked ? undefined : handleScan} />
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraFrame} />
              <Text style={styles.cameraText}>Hold the QR inside the square</Text>
            </View>
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


const IdCardFront = ({ student, frontInterpolate, frontOpacity, baseUrl }: { student: StudentProfile, frontInterpolate: Animated.AnimatedInterpolation<string>, frontOpacity: Animated.AnimatedInterpolation<number>, baseUrl: string }) => (
  <Animated.View style={[styles.idCardPro, { transform: [{ rotateY: frontInterpolate }], opacity: frontOpacity }]}>
    <View style={styles.idWatermark}><Text style={styles.idWatermarkText}>RMC</Text></View>
    <View style={styles.idTopBar}>
      <View style={styles.idLogoArea}>
        <Text style={styles.idLogomarkBig}>RMC</Text>
        <Text style={styles.idLogomarkSmall}>INSTITUTE</Text>
      </View>
      <View style={styles.idType}>
        <Text style={styles.idTypeMain}>IDENTITY{"\n"}CARD</Text>
        <Text style={styles.idTypeYear}>2025-26</Text>
      </View>
    </View>
    <View style={styles.idConcept}>
      <Text style={styles.conceptMainText}>RMC</Text>
      <Text style={styles.conceptSubText}>Concept Se Selection tak</Text>
    </View>
    <View style={styles.idBatchBox}><Text style={styles.idBatchText}>{student.current_batch || 'GENERAL BATCH'}</Text></View>
    <View style={styles.idMiddleGrid}>
      <View style={styles.idQrZone}>
        {student.student_uid ? <Image source={{ uri: makeAbsoluteUrl(baseUrl, `/api/students/qr/${student.student_uid}`) }} style={styles.idQrImage} /> : <View style={styles.idQrImage} />}
      </View>
      <View style={styles.idPhotoZone}>
        <Image source={{ uri: student.photo ? makeAbsoluteUrl(baseUrl, student.photo) : 'https://riteshmathematics.in/images/default_avatar.png' }} style={styles.idPhoto} />
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
    </View>
    <View style={styles.idFooter}><Text style={styles.idFooterText}>Digital Identity Verified • RMC Vault</Text></View>
  </Animated.View>
);

const IdCardBack = ({ student, backInterpolate, backOpacity }: { student: StudentProfile, backInterpolate: Animated.AnimatedInterpolation<string>, backOpacity: Animated.AnimatedInterpolation<number> }) => (
  <Animated.View style={[styles.idCardPro, { transform: [{ rotateY: backInterpolate }], opacity: backOpacity, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}>
    <View style={styles.idWatermark}><Text style={styles.idWatermarkText}>RMC</Text></View>
    <View style={styles.idBrandBanner}>
      <Text style={styles.idBrandTitle}>Official Records</Text>
      <Text style={styles.idBrandTagline}>RMC Internal Sheet</Text>
    </View>
    <View style={styles.backFieldList}>
      <View style={styles.backFieldFull}>
        <Text style={styles.backFieldLabel}>Father's Name</Text>
        <Text style={styles.backFieldValueStrong}>{student.father_name || '-'}</Text>
      </View>
      <View style={styles.backFieldRow}>
        <View style={styles.backFieldHalf}>
          <Text style={styles.backFieldLabel}>Guardian Phone</Text>
          <Text style={styles.backFieldValue}>{student.guardian_phone || '-'}</Text>
        </View>
        <View style={styles.backFieldHalf}>
          <Text style={styles.backFieldLabel}>UID Number</Text>
          <Text style={styles.backFieldValue}>{student.student_uid || '-'}</Text>
        </View>
      </View>
      <View style={styles.backFieldFull}>
        <Text style={styles.backFieldLabel}>Current Batch</Text>
        <Text style={styles.backFieldValueStrong}>{student.current_batch || 'N/A'}</Text>
      </View>
      <View style={styles.backFieldFull}>
        <Text style={styles.backFieldLabel}>Security Note</Text>
        <Text style={styles.backFieldCompact}>This card is property of RMC. Return to institute if found. Unauthorized use is prohibited. Digital records archived at riteshmathematics.in.</Text>
      </View>
    </View>
    <View style={styles.backFooterStrip}>
      <Text style={styles.backFooterUrl}>riteshmathematics.in</Text>
      <View style={styles.backFooterTag}><Text style={styles.backFooterTagText}>Verified Access</Text></View>
    </View>
  </Animated.View>
);

function MainApp() {
  const [baseUrl, setBaseUrl] = useState(LOCKED_SERVER_URL);
  const [baseUrlDraft, setBaseUrlDraft] = useState(LOCKED_SERVER_URL);
  const [cookieHeader, setCookieHeader] = useState('');
  const [session, setSession] = useState<SessionInfo>(null);
  const [booting, setBooting] = useState(true);
  const [busyMessage, setBusyMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [guestTab, setGuestTab] = useState<GuestTab>('welcome');
  const [studentTab, setStudentTab] = useState<StudentTab>('overview');
  const [staffTab, setStaffTab] = useState<StaffTab>('home');
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
  const [registrationForm, setRegistrationForm] = useState<RegistrationForm>({ name: '', phone: '', father_name: '', guardian_phone: '', address: '', student_class: '', current_batch: '', aspiration: '', photo: '' });
  const [publicBatches, setPublicBatches] = useState<Batch[]>([]);
  const [studentMaterials, setStudentMaterials] = useState<MaterialItem[]>([]);
  const [studentNotices, setStudentNotices] = useState<NoticeItem[]>([]);
  const [studentDoubts, setStudentDoubts] = useState<DoubtItem[]>([]);
  const [staffDoubts, setStaffDoubts] = useState<DoubtItem[]>([]);
  const [newDoubtText, setNewDoubtText] = useState('');
  const [newDoubtPhoto, setNewDoubtPhoto] = useState('');
  const [doubtReplyPhoto, setDoubtReplyPhoto] = useState('');
  const [studentNotifications, setStudentNotifications] = useState<PersonalNotification[]>([]);
  
  const [isIdCardFlipped, setIsIdCardFlipped] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  const toggleIdCardFlip = () => {
    Animated.timing(flipAnim, {
      toValue: isIdCardFlipped ? 0 : 180,
      duration: 600,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();
    setIsIdCardFlipped(!isIdCardFlipped);
  };

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const frontOpacity = flipAnim.interpolate({
    inputRange: [89, 90],
    outputRange: [1, 0],
  });

  const backOpacity = flipAnim.interpolate({
    inputRange: [89, 90],
    outputRange: [0, 1],
  });

  const DigitalIdCard = ({ student }: { student: StudentProfile }) => (
    <View style={styles.idCardContainer}>
      <Pressable onPress={toggleIdCardFlip}>
        <IdCardFront student={student} frontInterpolate={frontInterpolate} frontOpacity={frontOpacity} baseUrl={baseUrl} />
        <IdCardBack student={student} backInterpolate={backInterpolate} backOpacity={backOpacity} />
      </Pressable>
      <View style={styles.cardActionRow}>
        <Text style={styles.cardActionText}>Tap card to flip for details</Text>
      </View>
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
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [weeklyAlerts, setWeeklyAlerts] = useState<WeeklyAlert[]>([]);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
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
  const [selectedBatch, setSelectedBatch] = useState('');
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [batchHistory, setBatchHistory] = useState<AttendanceHistoryRow[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionCurrentResponse | null>(null);
  const [roster, setRoster] = useState<StudentRow[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [attendanceScannerVisible, setAttendanceScannerVisible] = useState(false);
  const [lastScannedStudent, setLastScannedStudent] = useState<StudentRow | null>(null);
  const [studentModalVisible, setStudentModalVisible] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentRow | null>(null);
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
  const [selectedAbsenteeSessionId, setSelectedAbsenteeSessionId] = useState('');
  const [staffNotificationSection, setStaffNotificationSection] = useState<StaffNotificationSection>('notices');
  const [createdStaffCard, setCreatedStaffCard] = useState<CreatedStaffCard | null>(null);
  const [staffCardForm, setStaffCardForm] = useState<StaffCardPayload>({ full_name: '', username: '', password: '', phone: '', role: 'teacher' });
  const [renameTableTarget, setRenameTableTarget] = useState('');
  const [renameTableValue, setRenameTableValue] = useState('');

  const cookieRef = useRef('');
  const isHost = session?.type === 'staff' && session.user.role === 'teacher';

  const apiJson = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(makeAbsoluteUrl(baseUrl, path), {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        ...(cookieRef.current ? { Cookie: cookieRef.current } : {})
      }
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      cookieRef.current = mergeCookieHeaders(cookieRef.current, setCookie);
      setCookieHeader(cookieRef.current);
      await SecureStore.setItemAsync(STORAGE_COOKIE, cookieRef.current);
    }
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    return response.json();
  }, [baseUrl]);

  const apiUpload = useCallback(async <T,>(path: string, formData: FormData): Promise<T> => {
    const response = await fetch(makeAbsoluteUrl(baseUrl, path), {
      method: 'POST',
      body: formData,
      headers: {
        ...(cookieRef.current ? { Cookie: cookieRef.current } : {})
      }
    });
    if (!response.ok) throw new Error(`Upload Error: ${response.status}`);
    return response.json();
  }, [baseUrl]);

  const persistCookie = useCallback(async (value: string) => {
    cookieRef.current = value;
    setCookieHeader(value);
    await SecureStore.setItemAsync(STORAGE_COOKIE, value);
  }, []);

  const downloadAndShare = useCallback(async (path: string, filename: string) => {
    const result = await FileSystem.downloadAsync(makeAbsoluteUrl(baseUrl, path), `${FileSystem.Paths.document.uri}/${filename}`, {
      headers: cookieHeader ? { Cookie: cookieHeader } : undefined
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(result.uri);
    } else {
      Alert.alert('Downloaded', result.uri);
    }
  }, [baseUrl, cookieHeader]);

  const syncSession = useCallback(async () => {
    const payload = await apiJson<{ authenticated: boolean; session_type: 'student' | 'staff' | null; user?: StaffUser; student?: StudentProfile; }>('/api/session');
    if (!payload.authenticated || !payload.session_type) {
      setSession(null);
      return null;
    }
    if (payload.session_type === 'student' && payload.student) {
      const nextSession: SessionInfo = { type: 'student', student: payload.student };
      setSession(nextSession);
      return nextSession;
    }
    if (payload.session_type === 'staff' && payload.user) {
      const nextSession: SessionInfo = { type: 'staff', user: payload.user };
      setSession(nextSession);
      return nextSession;
    }
    setSession(null);
    return null;
  }, [apiJson]);

  const loadPublicBatches = useCallback(async () => {
    const payload = await apiJson<Batch[]>('/api/public/batches');
    setPublicBatches(Array.isArray(payload) ? payload : []);
  }, [apiJson]);

  const loadStudentPortal = useCallback(async () => {
    const [materialsPayload, noticesPayload, notificationsPayload] = await Promise.all([
      apiJson<MaterialItem[]>('/api/student/materials'),
      apiJson<NoticeItem[]>('/api/student/notices'),
      apiJson<{ status: string; notifications: PersonalNotification[] }>('/api/student/notifications')
    ]);
    setStudentMaterials(materialsPayload || []);
    setStudentNotices(noticesPayload || []);
    setStudentNotifications(notificationsPayload.notifications || []);
  }, [apiJson]);

  const loadStudentTests = useCallback(async () => {
    const payload = await apiJson<{ status: string } & StudentDashboardTests>('/api/student/tests/dashboard');
    setStudentTests({
      upcoming: Array.isArray(payload.upcoming) ? payload.upcoming : [],
      history: Array.isArray(payload.history) ? payload.history : [],
      scoreboard_tests: Array.isArray(payload.scoreboard_tests) ? payload.scoreboard_tests : []
    });
  }, [apiJson]);

  const loadRoster = useCallback(async (activeSessionId?: number, batchName?: string) => {
    if (activeSessionId) {
      const payload = await apiJson<{ status: string; roster: StudentRow[] }>(`/api/sessions/${activeSessionId}/roster`);
      setRoster(Array.isArray(payload.roster) ? payload.roster : []);
      return;
    }
    if (batchName) {
      setRoster(students.filter((student) => batchMatches(student, batchName)));
    } else {
      setRoster([]);
    }
  }, [apiJson, students]);

  const loadBatchInsights = useCallback(async (batchName: string) => {
    if (!batchName) {
      setBatchSummary(null);
      setBatchHistory([]);
      return;
    }
    const [summaryPayload, historyPayload] = await Promise.all([
      apiJson<{ status: string; batch: BatchSummary }>(`/api/batches/${encodeURIComponent(batchName)}/summary`),
      apiJson<AttendanceHistoryRow[]>(`/api/batches/${encodeURIComponent(batchName)}/history`)
    ]);
    setBatchSummary(summaryPayload.batch || null);
    setBatchHistory(Array.isArray(historyPayload) ? historyPayload : []);
  }, [apiJson]);

  const loadStaffCore = useCallback(async () => {
    const [batchesPayload, studentsPayload, currentSessionPayload] = await Promise.all([
      apiJson<Batch[]>('/api/batches'),
      apiJson<StudentRow[]>('/api/students'),
      apiJson<{ status: string; data: SessionCurrentResponse | null }>('/api/sessions/current')
    ]);
    const nextBatches = Array.isArray(batchesPayload) ? batchesPayload : [];
    const nextStudents = Array.isArray(studentsPayload) ? studentsPayload : [];
    const nextSession = currentSessionPayload.data || null;
    const activeBatch = nextSession?.batch_id || selectedBatch || nextBatches[0]?.name || '';
    setBatches(nextBatches);
    setStudents(nextStudents);
    setCurrentSession(nextSession);
    setSelectedBatch(activeBatch);
    if (activeBatch) {
      await loadBatchInsights(activeBatch);
    } else {
      setBatchSummary(null);
      setBatchHistory([]);
    }
  }, [apiJson, loadBatchInsights, selectedBatch]);

  const loadMaterials = useCallback(async () => {
    const payload = await apiJson<{ status: string; materials: MaterialItem[] }>('/api/materials');
    setMaterials(Array.isArray(payload.materials) ? payload.materials : []);
  }, [apiJson]);

  const loadNotices = useCallback(async () => {
    const payload = await apiJson<{ status: string; notices: NoticeItem[] }>('/api/notices');
    setNotices(Array.isArray(payload.notices) ? payload.notices : []);
  }, [apiJson]);

  const loadLeads = useCallback(async () => {
    const payload = await apiJson<{ status: string; leads: LeadItem[] }>('/api/leads');
    setLeads(Array.isArray(payload.leads) ? payload.leads : []);
  }, [apiJson]);

  const loadReports = useCallback(async () => {
    const [alertsPayload, reportPayload] = await Promise.all([
      apiJson<{ status: string; alerts: WeeklyAlert[] }>('/api/reports/attendance_alerts'),
      reportBatch !== 'ALL' ? apiJson<{ status: string } & BatchReport>(`/api/reports/batch/${encodeURIComponent(reportBatch)}`) : Promise.resolve(null)
    ]);
    setWeeklyAlerts(Array.isArray(alertsPayload.alerts) ? alertsPayload.alerts : []);
    setReport(reportPayload && reportPayload.status === 'success' ? reportPayload : null);
  }, [apiJson, reportBatch]);

  const loadAdmin = useCallback(async () => {
    const payload = await apiJson<{ status: string } & SystemStats>('/api/admin/system_stats');
    setSystemStats(payload);
  }, [apiJson]);

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
    if (!selectedPaperId && nextPapers[0]) setSelectedPaperId(String(nextPapers[0].id));
    if (!selectedLaunchId && nextLaunches[0]) setSelectedLaunchId(String(nextLaunches[0].id));
  }, [apiJson, selectedLaunchId, selectedPaperId]);

  const loadScoreboard = useCallback(async (launchId: number, role: 'student' | 'staff') => {
    const path = role === 'student' ? `/api/student/tests/${launchId}/scoreboard` : `/api/tests/launches/${launchId}/scoreboard`;
    const payload = await apiJson<{ status: string } & ScoreboardPayload>(path);
    setScoreboardPayload(payload);
    setSelectedScoreboardLaunchId(String(launchId));
  }, [apiJson]);

  const loadDoubts = useCallback(async (type: 'student' | 'staff', studentUid?: string) => {
    const endpoint = type === 'student'
      ? (studentUid ? `/api/doubts/student/${encodeURIComponent(studentUid)}` : '')
      : '/api/doubts/pending';
    if (!endpoint) {
      setStudentDoubts([]);
      return;
    }
    const payload = await apiJson<{ status: string; doubts: DoubtItem[] }>(endpoint);
    if (type === 'student') setStudentDoubts(Array.isArray(payload.doubts) ? payload.doubts : []);
    else setStaffDoubts(Array.isArray(payload.doubts) ? payload.doubts : []);
  }, [apiJson]);

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
      await loadDoubts('student', session?.type === 'student' ? session.student.student_uid : undefined);
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
      await loadDoubts('staff');
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Reply failed', error instanceof Error ? error.message : 'Could not reply.');
    }
  }, [apiUpload, loadDoubts, doubtReplyPhoto]);

  const refreshStaffWorkspace = useCallback(async () => {
    await loadStaffCore();
    await loadRoster(currentSession?.session_id, selectedBatch);
    if (staffTab === 'materials') await loadMaterials();
    if (staffTab === 'notifications') await Promise.all([loadNotices(), loadLeads()]);
    if (staffTab === 'reports') await loadReports();
    if (staffTab === 'tests') await loadTestAdmin();
    if (staffTab === 'doubts') await loadDoubts('staff');
    if (staffTab === 'admin' && isHost) await loadAdmin();
  }, [currentSession?.session_id, isHost, loadAdmin, loadDoubts, loadLeads, loadMaterials, loadNotices, loadReports, loadRoster, loadStaffCore, loadTestAdmin, selectedBatch, staffTab]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const current = await syncSession();
      if (!current) {
        await loadPublicBatches();
        return;
      }
      if (current.type === 'student') {
        await Promise.all([loadStudentPortal(), loadStudentTests(), loadDoubts('student', current.student.student_uid)]);
      } else {
        await refreshStaffWorkspace();
      }
    } finally {
      setRefreshing(false);
    }
  }, [loadDoubts, loadPublicBatches, loadStudentPortal, loadStudentTests, refreshStaffWorkspace, syncSession]);

  useEffect(() => {
    (async () => {
      try {
        const storedBaseUrl = normalizeBaseUrl((await SecureStore.getItemAsync(STORAGE_BASE_URL)) || '');
        const initialBaseUrl = storedBaseUrl || LOCKED_SERVER_URL;
        const storedCookie = (await SecureStore.getItemAsync(STORAGE_COOKIE)) || '';
        setBaseUrl(initialBaseUrl);
        setBaseUrlDraft(initialBaseUrl);
        await SecureStore.setItemAsync(STORAGE_BASE_URL, initialBaseUrl);
        cookieRef.current = storedCookie;
        setCookieHeader(storedCookie);
        if (initialBaseUrl) {
          try {
            const current = await syncSession();
            if (current?.type === 'student') {
              await Promise.all([loadStudentPortal(), loadStudentTests(), loadDoubts('student', current.student.student_uid)]);
            } else if (current?.type === 'staff') {
              await refreshStaffWorkspace();
            } else {
              await loadPublicBatches();
            }
          } catch {
            await loadPublicBatches();
          }
        }
      } finally {
        setBooting(false);
      }
    })();
  }, [loadDoubts, loadPublicBatches, loadStudentPortal, loadStudentTests, refreshStaffWorkspace, syncSession]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    (async () => {
      try {
        if (staffTab === 'materials') await loadMaterials();
        if (staffTab === 'notifications') await Promise.all([loadNotices(), loadLeads()]);
        if (staffTab === 'reports') await loadReports();
        if (staffTab === 'tests') await loadTestAdmin();
        if (staffTab === 'doubts') await loadDoubts('staff');
        if (staffTab === 'admin' && isHost) await loadAdmin();
      } catch {
        // retry via refresh if needed
      }
    })();
  }, [isHost, loadAdmin, loadDoubts, loadLeads, loadMaterials, loadNotices, loadReports, loadTestAdmin, session, staffTab]);

  useEffect(() => {
    if (!batchHistory.length) {
      if (selectedAbsenteeSessionId) setSelectedAbsenteeSessionId('');
      return;
    }
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
    if (session?.type !== 'student' || studentTab !== 'tests' || !selectedScoreboardLaunchId) return;
    loadScoreboard(Number(selectedScoreboardLaunchId), 'student').catch(() => null);
  }, [loadScoreboard, selectedScoreboardLaunchId, session?.type, studentTab]);

  useEffect(() => {
    if (session?.type !== 'staff' || staffTab !== 'tests' || !selectedLaunchId) return;
    loadScoreboard(Number(selectedLaunchId), 'staff').catch(() => null);
  }, [loadScoreboard, selectedLaunchId, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    loadRoster(currentSession?.session_id, selectedBatch).catch(() => null);
  }, [currentSession?.session_id, loadRoster, selectedBatch, session]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    loadBatchInsights(selectedBatch).catch(() => null);
  }, [loadBatchInsights, selectedBatch, session]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    if (staffTab !== 'attendance') return;
    if (!currentSession?.session_id) return;

    const id = setInterval(() => {
      loadStaffCore()
        .then(() => loadRoster(currentSession.session_id, selectedBatch))
        .catch(() => null);
    }, POLL_FAST_MS);

    return () => clearInterval(id);
  }, [currentSession?.session_id, loadRoster, loadStaffCore, selectedBatch, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'staff') return;
    if (staffTab !== 'tests') return;

    const id = setInterval(() => {
      loadTestAdmin().catch(() => null);
    }, POLL_MED_MS);

    return () => clearInterval(id);
  }, [loadTestAdmin, session?.type, staffTab]);

  useEffect(() => {
    if (session?.type !== 'student') return;
    if (studentTab !== 'tests') return;

    const id = setInterval(() => {
      loadStudentTests().catch(() => null);
    }, POLL_SLOW_MS);

    return () => clearInterval(id);
  }, [loadStudentTests, session?.type, studentTab]);

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
      await SecureStore.setItemAsync(STORAGE_BASE_URL, normalized);
      setBusyMessage('');
      Alert.alert('Connected', 'Server URL saved.');
      await loadPublicBatches();
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Connection failed', error instanceof Error ? error.message : 'Could not reach the server.');
    }
  }, [baseUrlDraft, loadPublicBatches]);

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
      await loadMaterials();
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
      await loadMaterials();
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
    await Linking.openURL(makeAbsoluteUrl(baseUrl, targetPath));
  }, [baseUrl]);

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

  const submitRegistration = useCallback(async () => {
    Alert.alert('Registration', 'Student registration is still handled from the web admin flow.');
  }, []);

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
        await Promise.all([
          loadStudentPortal(),
          loadStudentTests(),
          loadDoubts('student', current.student.student_uid)
        ]);
        setGuestTab('welcome');
        setStudentTab('overview');
      }
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Could not log in.');
    }
  }, [apiJson, loadDoubts, loadStudentPortal, loadStudentTests, studentFather, studentName, studentPhone, studentUid, syncSession]);

  const handleStaffLogin = useCallback(async () => {
    if (!staffUsername.trim() || !staffPassword.trim()) {
      Alert.alert('Missing details', 'Enter your staff username and password.');
      return;
    }
    setBusyMessage('Logging in...');
    try {
      await apiJson('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: staffUsername.trim(), password: staffPassword })
      });
      const current = await syncSession();
      if (current?.type === 'staff') {
        await refreshStaffWorkspace();
        setGuestTab('welcome');
        setStaffTab('home');
      }
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Could not log in.');
    }
  }, [apiJson, refreshStaffWorkspace, staffPassword, staffUsername, syncSession]);

  const handleStaffQrLogin = useCallback(async (token: string) => {
    if (!token.trim()) return;
    setBusyMessage('Scanning staff QR...');
    try {
      await apiJson('/api/login/qr', {
        method: 'POST',
        body: JSON.stringify({ token })
      });
      const current = await syncSession();
      if (current?.type === 'staff') {
        await refreshStaffWorkspace();
        setGuestTab('welcome');
        setStaffTab('home');
      }
      setBusyMessage('');
      setStaffScannerVisible(false);
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Scan failed', error instanceof Error ? error.message : 'Could not verify the staff QR.');
    }
  }, [apiJson, refreshStaffWorkspace, syncSession]);

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
          loadStudentPortal(),
          loadStudentTests(),
          loadDoubts('student', current.student.student_uid)
        ]);
        setGuestTab('welcome');
        setStudentTab('overview');
      }
      setBusyMessage('');
      setStudentScannerVisible(false);
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Scan failed', error instanceof Error ? error.message : 'Could not verify the student QR.');
    }
  }, [apiJson, loadDoubts, loadStudentPortal, loadStudentTests, syncSession]);

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
      setGuestTab('welcome');
      setStudentTab('overview');
      setStaffTab('home');
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
      await loadDoubts('staff');
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Could not update the doubt.');
    }
  }, [apiJson, apiUpload, doubtReplyPhoto, loadDoubts]);

  const verifyAttendanceQr = useCallback(async (token: string) => {
    if (!currentSession?.session_id || !selectedBatch) {
      Alert.alert('Session required', 'Start an attendance session first.');
      return;
    }
    setBusyMessage('Verifying QR...');
    try {
      const payload = await apiJson<{ status: string; data: StudentRow; session_id: number; attendance_status: number }>(
        '/api/verify_qr',
        {
          method: 'POST',
          body: JSON.stringify({
            token,
            session_id: currentSession.session_id,
            batch_id: selectedBatch
          })
        }
      );
      setLastScannedStudent(payload.data || null);
      await loadStaffCore();
      await loadRoster(currentSession.session_id, selectedBatch);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Verification failed', error instanceof Error ? error.message : 'Could not verify the QR.');
    }
  }, [apiJson, currentSession?.session_id, loadRoster, loadStaffCore, selectedBatch]);

  const startAttendanceSession = useCallback(async () => {
    if (!selectedBatch) {
      Alert.alert('Batch required', 'Choose a batch before starting attendance.');
      return;
    }
    setBusyMessage('Starting session...');
    try {
      await apiJson('/api/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          batch_id: selectedBatch,
          session_name: `${selectedBatch} Attendance`
        })
      });
      await loadStaffCore();
      await loadRoster(currentSession?.session_id, selectedBatch);
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Start failed', error instanceof Error ? error.message : 'Could not start the session.');
    }
  }, [apiJson, currentSession?.session_id, loadRoster, loadStaffCore, selectedBatch]);

  const setLateMode = useCallback(async () => {
    if (!currentSession?.session_id) {
      Alert.alert('Session required', 'Start an attendance session first.');
      return;
    }
    setBusyMessage('Enabling late mode...');
    try {
      await apiJson(`/api/sessions/${currentSession.session_id}/late`, { method: 'POST' });
      await loadStaffCore();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Could not enable late mode.');
    }
  }, [apiJson, currentSession?.session_id, loadStaffCore]);

  const closeAttendanceSession = useCallback(async () => {
    if (!currentSession?.session_id) {
      Alert.alert('Session required', 'No active attendance session to close.');
      return;
    }
    setBusyMessage('Closing session...');
    try {
      await apiJson('/api/sessions/close', {
        method: 'POST',
        body: JSON.stringify({ session_id: currentSession.session_id })
      });
      setCurrentSession(null);
      setLastScannedStudent(null);
      await loadStaffCore();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Close failed', error instanceof Error ? error.message : 'Could not close the session.');
    }
  }, [apiJson, currentSession?.session_id, loadStaffCore]);

  const openStudentDetail = useCallback((student: StudentRow) => {
    setSelectedStudent(student);
    setSelectedStudentBatches(splitBatchNames(student.batch_name || student.current_batch));
    setStudentModalVisible(true);
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
      await loadStaffCore();
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
    setBusyMessage('Saving batch...');
    try {
      await apiJson(`/api/batches/${editingBatchId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editingBatchName.trim(),
          description: editingBatchDescription.trim()
        })
      });
      setEditingBatchId(null);
      setEditingBatchName('');
      setEditingBatchDescription('');
      await loadStaffCore();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save the batch.');
    }
  }, [apiJson, editingBatchDescription, editingBatchId, editingBatchName, loadStaffCore]);

  const deleteBatch = useCallback(async (batch: Batch) => {
    setBusyMessage('Deleting batch...');
    try {
      await apiJson(`/api/batches/${batch.id}`, { method: 'DELETE' });
      if (selectedBatch === batch.name) setSelectedBatch('');
      await loadStaffCore();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Delete failed', error instanceof Error ? error.message : 'Could not delete the batch.');
    }
  }, [apiJson, loadStaffCore, selectedBatch]);

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
      await loadStaffCore();
      setBusyMessage('');
      Alert.alert('Saved', 'Student batch assignment updated.');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Could not save the batches.');
    }
  }, [apiJson, loadStaffCore, selectedStudent, selectedStudentBatches]);

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
      await loadNotices();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Publish failed', error instanceof Error ? error.message : 'Could not create notice.');
    }
  }, [apiJson, loadNotices, noticeContent, noticeTarget, noticeTitle]);

  const markLeadRead = useCallback(async (leadId: number) => {
    await apiJson(`/api/leads/${leadId}/read`, { method: 'POST' });
    await loadLeads();
  }, [apiJson, loadLeads]);

  const markAllLeadsRead = useCallback(async () => {
    setBusyMessage('Marking requests...');
    try {
      await Promise.all(leads.filter((lead) => lead.is_read === 0).map((lead) => apiJson(`/api/leads/${lead.id}/read`, { method: 'POST' })));
      await loadLeads();
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
      await loadLeads();
      setBusyMessage('');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Approval failed', error instanceof Error ? error.message : 'Could not update approval.');
    }
  }, [apiJson, loadLeads]);

  const exportCsv = useCallback(async (batch?: string) => {
    try {
      const path = batch ? `/api/admin/export_csv?batch=${encodeURIComponent(batch)}` : '/api/admin/export_csv';
      await downloadAndShare(path, batch ? `${batch}_report.csv` : 'rmc_export.csv');
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not export CSV.');
    }
  }, [downloadAndShare]);

  const exportAbsenteeCsv = useCallback(async () => {
    if (!selectedAbsenteeSessionId) {
      Alert.alert('Session required', 'Choose a closed session first.');
      return;
    }
    const sessionEntry = batchHistory.find((entry) => String(entry.session_id || '') === selectedAbsenteeSessionId);
    try {
      await downloadAndShare(
        `/api/reports/absentees/export?session_id=${encodeURIComponent(selectedAbsenteeSessionId)}`,
        `${(selectedBatch || sessionEntry?.batch_id || 'batch').replace(/[^a-zA-Z0-9_-]+/g, '_')}_absentees.csv`
      );
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not export absentees.');
    }
  }, [batchHistory, downloadAndShare, selectedAbsenteeSessionId, selectedBatch]);

  const exportTestReportCsv = useCallback(async () => {
    if (!selectedBatch) {
      Alert.alert('Batch required', 'Choose a batch first.');
      return;
    }
    try {
      await downloadAndShare(
        `/api/reports/tests/export?batch=${encodeURIComponent(selectedBatch)}`,
        `${selectedBatch.replace(/[^a-zA-Z0-9_-]+/g, '_')}_test_report.csv`
      );
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Could not export test report.');
    }
  }, [downloadAndShare, selectedBatch]);

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
            await refreshStaffWorkspace();
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
    if (rank === 1) return 'ðŸ¥‡';
    if (rank === 2) return 'ðŸ¥ˆ';
    if (rank === 3) return 'ðŸ¥‰';
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
    if (!selectedBatch || !selectedPaperId) {
      Alert.alert('Missing selection', 'Choose both a batch and a saved paper.');
      return;
    }
    setBusyMessage('Launching test...');
    try {
      await apiJson('/api/tests/launches', {
        method: 'POST',
        body: JSON.stringify({ batch_name: selectedBatch, paper_id: Number(selectedPaperId) })
      });
      await loadTestAdmin();
      setBusyMessage('');
      Alert.alert('Live now', 'The test has been launched for the selected batch.');
    } catch (error) {
      setBusyMessage('');
      Alert.alert('Launch failed', error instanceof Error ? error.message : 'Could not launch test.');
    }
  }, [apiJson, loadTestAdmin, selectedBatch, selectedPaperId]);

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
      if (session?.type === 'student') await loadStudentTests();
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
      await Promise.all([loadStudentTests(), selectedScoreboardLaunchId ? loadScoreboard(Number(selectedScoreboardLaunchId), 'student') : Promise.resolve()]);
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

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    const pool = selectedBatch ? students.filter((student) => batchMatches(student, selectedBatch)) : students;
    if (!query) return pool;
    return pool.filter((student) => [student.name, student.student_uid, student.phone, student.batch_name].join(' ').toLowerCase().includes(query));
  }, [selectedBatch, studentSearch, students]);

  const staffSummary = useMemo(() => ({ totalStudents: students.length, unreadLeads: leads.filter((lead) => lead.is_read === 0).length }), [leads, students]);

  const guestTabs: Array<{ key: GuestTab; label: string }> = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'student', label: 'Student' },
    { key: 'staff', label: 'Staff' },
    { key: 'register', label: 'Register' }
  ];

  const studentTabs: Array<{ key: StudentTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'tests', label: 'Tests' },
    { key: 'doubts', label: 'Doubts' }
  ];

  const staffTabs: Array<{ key: StaffTab; label: string }> = [
    { key: 'home', label: 'Home' },
    { key: 'attendance', label: 'Roll Call' },
    { key: 'students', label: 'Students' },
    { key: 'batches', label: 'Batches' },
    { key: 'materials', label: 'Library' },
    { key: 'notifications', label: 'Inbox' },
    { key: 'reports', label: 'Reports' },
    { key: 'tests', label: 'Tests' },
    { key: 'doubts', label: 'Doubts' },
    ...(isHost ? [{ key: 'admin' as const, label: 'Admin' }] : [])
  ];
  const staffNotificationTabs: Array<{ key: StaffNotificationSection; label: string }> = [
    { key: 'notices', label: 'Notices' },
    { key: 'absentees', label: 'Absentees' },
    { key: 'test_reports', label: 'Test Reports' },
    { key: 'leads', label: 'Leads' },
    { key: 'id_requests', label: 'ID Requests' }
  ];
  const renderWelcome = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor="#6A4D3B" />}>
      <View style={styles.heroBranding}>
        <Text style={styles.heroTitle}>RMC</Text>
        <Text style={styles.heroSubtitle}>Concept Se Selection Tak</Text>
      </View>
      <SectionCard title="RMC Portal" subtitle="The unified management system for Ritesh Mathematics Classes.">
        <View style={styles.posterPanel}>
          <Text style={styles.posterCopy}>Manage attendance, results, materials, and student communications from one premium mobile workspace.</Text>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{publicBatches.length}</Text><Text style={styles.kpiLabel}>Batches</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>Secure</Text><Text style={styles.kpiLabel}>Encryption</Text></View>
        </View>
      </SectionCard>
      <SectionCard title="Server URL" subtitle="Point the app at your local installer, LAN host, or tunnel URL.">
        <LabeledInput label="Backend URL" value={baseUrlDraft} onChangeText={setBaseUrlDraft} placeholder="http://192.168.1.10:3000" keyboardType="url" autoCapitalize="none" />
        <PrimaryButton title="Save Server URL" onPress={saveBaseUrl} tone="secondary" />
      </SectionCard>
      <SectionCard title="ID Card Request" subtitle="Ask for registration approval via phone number.">
        <LabeledInput label="Full Name" value={leadRequestName} onChangeText={setLeadRequestName} placeholder="Student name" />
        <LabeledInput label="Phone Number" value={leadRequestPhone} onChangeText={setLeadRequestPhone} placeholder="+91..." keyboardType="phone-pad" />
        <PrimaryButton title="Send Request" onPress={submitLeadRequest} />
      </SectionCard>
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
        <LabeledInput label="Phone" value={registrationForm.phone} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, phone: value }))} placeholder="+91..." keyboardType="phone-pad" />
        <LabeledInput label="Father Name" value={registrationForm.father_name} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, father_name: value }))} placeholder="Father name" />
        <LabeledInput label="Address" value={registrationForm.address} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, address: value }))} placeholder="Full address" multiline />
        <LabeledInput label="Class" value={registrationForm.student_class} onChangeText={(value) => setRegistrationForm((prev) => ({ ...prev, student_class: value }))} placeholder="11th / 12th / Dropper" />
        <Text style={styles.label}>Select Target Batch</Text>
        <PillTabs items={publicBatches.map((batch) => ({ key: batch.name, label: batch.name }))} value={registrationForm.current_batch} onChange={(value) => setRegistrationForm((prev) => ({ ...prev, current_batch: value }))} />
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
        <LabeledInput label="Security Password" value={staffPassword} onChangeText={setStaffPassword} placeholder="••••••••" secureTextEntry />
        <PrimaryButton title="Enter Workspace" onPress={handleStaffLogin} />
        <PrimaryButton title="Scan Staff ID" onPress={() => setStaffScannerVisible(true)} tone="secondary" />
      </SectionCard>
    </ScrollView>
  );

  const renderStudentOverview = () => (
    <>
      <SectionCard title="Digital ID Card" subtitle="Your official RMC identification. Show this for entry.">
        {session?.type === 'student' ? <DigitalIdCard student={session.student} /> : null}
      </SectionCard>
      
      <SectionCard title="Quick Actions" subtitle="Frequently used student tools.">
        <View style={styles.buttonRow}>
          <PrimaryButton title="View Notes" onPress={() => setStudentTab('overview')} tone="secondary" />
          <PrimaryButton title="Tests" onPress={() => setStudentTab('tests')} tone="secondary" />
          <PrimaryButton title="Ask Doubt" onPress={() => setStudentTab('doubts')} tone="secondary" />
        </View>
      </SectionCard>

      <SectionCard title="Study Materials" subtitle="Open links or download assigned files.">
        {studentMaterials.length ? studentMaterials.map((material) => (
          <Pressable key={material.id} style={styles.rowCard} onPress={() => handleMaterialOpen(material)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{material.title}</Text>
              <Text style={styles.rowText}>{material.description || 'Reference material for your batch.'}</Text>
            </View>
            <View style={styles.statusPill}>
               <Text style={styles.statusPillText}>{material.access_mode === 'view' ? 'VIEW' : 'FILE'}</Text>
            </View>
          </Pressable>
        )) : <Text style={styles.emptyBody}>No materials assigned yet.</Text>}
      </SectionCard>
      
      <SectionCard title="Inbox & Notices" subtitle="Stay updated with batch announcements and personal alerts.">
        {[...studentNotices, ...studentNotifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).length ? 
          [...studentNotices, ...studentNotifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((notice) => (
          <View key={notice.id} style={styles.listBlock}>
            <View style={styles.noticeHead}>
               <Text style={styles.metaText}>{prettyDate(notice.created_at)}</Text>
               <View style={[styles.badge, (notice as any).notification_type ? { backgroundColor: '#3B82F6' } : null]}>
                 <Text style={styles.badgeText}>{(notice as any).notification_type ? 'Alert' : 'Notice'}</Text>
               </View>
            </View>
            <Text style={styles.rowTitle}>{notice.title || 'Attendance Update'}</Text>
            <Text style={styles.rowText}>{notice.content}</Text>
          </View>
        )) : <Text style={styles.emptyBody}>No messages yet.</Text>}
      </SectionCard>
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
            <Text style={styles.metaText}>{prettyDate(doubt.created_at)} • {doubt.status.toUpperCase()}</Text>
            <Text style={styles.rowTitle}>{doubt.question_text}</Text>
            {doubt.question_image ? (
              <PrimaryButton title="View Question Image" onPress={() => Linking.openURL(makeAbsoluteUrl(baseUrl, doubt.question_image!))} tone="secondary" />
            ) : null}
            {doubt.status === 'solved' ? (
              <View style={[styles.posterPanel, { marginTop: 12 }]}>
                <Text style={styles.metaText}>SOLVED • {prettyDate(doubt.replied_at || '')}</Text>
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

  const renderStudentPortal = (student: StudentProfile) => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor="#6A4D3B" />}>
      <SectionCard title={student.name} subtitle={`${student.student_uid} - ${student.current_batch || student.batch_name || 'No batch assigned'}`} right={<PrimaryButton title="Logout" onPress={handleLogout} tone="secondary" />}>
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{student.phone || '-'}</Text><Text style={styles.kpiLabel}>Phone</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{student.student_class || '-'}</Text><Text style={styles.kpiLabel}>Class</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{student.aspiration || '-'}</Text><Text style={styles.kpiLabel}>Goal</Text></View>
        </View>
      </SectionCard>
      <PillTabs items={studentTabs} value={studentTab} onChange={(value) => setStudentTab(value as StudentTab)} />
      {studentTab === 'overview' && renderStudentOverview()}
      {studentTab === 'tests' && renderStudentTests()}
      {studentTab === 'doubts' && renderStudentDoubts()}
    </ScrollView>
  );

  const renderStaffHome = () => (
    <>
      <SectionCard title="Command Center" subtitle="Real-time institutional oversight and performance metrics.">
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{staffSummary.totalStudents}</Text><Text style={styles.kpiLabel}>Students</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{staffSummary.unreadLeads}</Text><Text style={styles.kpiLabel}>New Leads</Text></View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{formatBytes(systemStats?.db_size || 0)}</Text><Text style={styles.kpiLabel}>Vault Size</Text></View>
          <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{batches.length}</Text><Text style={styles.kpiLabel}>Batches</Text></View>
        </View>
        <View style={styles.buttonRow}>
          <PrimaryButton title="Start Attendance" onPress={startAttendanceSession} disabled={!selectedBatch || !!currentSession} />
          <PrimaryButton title="Scan QR" onPress={() => setAttendanceScannerVisible(true)} tone="success" disabled={!currentSession} />
          <PrimaryButton title="Close Session" onPress={closeAttendanceSession} tone="danger" disabled={!currentSession} />
        </View>
      </SectionCard>
      <SectionCard title="Selected Batch" subtitle="Quick batch context and last session details.">
        <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={selectedBatch} onChange={setSelectedBatch} />
        {batchSummary ? (
          <View style={styles.kpiRow}>
            <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{batchSummary.strength}</Text><Text style={styles.kpiLabel}>Strength</Text></View>
            <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{batchSummary.active_session ? 'Active' : 'Idle'}</Text><Text style={styles.kpiLabel}>Status</Text></View>
            <View style={styles.kpiBlock}><Text style={styles.kpiValue}>{batchHistory.length}</Text><Text style={styles.kpiLabel}>Closed sessions</Text></View>
          </View>
        ) : <Text style={styles.emptyBody}>Select a batch to load insights.</Text>}
      </SectionCard>
    </>
  );

  const renderStaffAttendance = () => (
    <>
      <SectionCard title="Attendance Console" subtitle="Choose a batch, run the scanner, and manage the live session.">
        <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={selectedBatch} onChange={setSelectedBatch} />
        <View style={styles.buttonRow}>
          <PrimaryButton title="Start Session" onPress={startAttendanceSession} disabled={!selectedBatch || !!currentSession} />
          <PrimaryButton title="Late Mode" onPress={setLateMode} tone="secondary" disabled={!currentSession || currentSession.is_late === 1} />
          <PrimaryButton title="Scan Student" onPress={() => setAttendanceScannerVisible(true)} tone="success" disabled={!currentSession} />
          <PrimaryButton title="Close Session" onPress={closeAttendanceSession} tone="danger" disabled={!currentSession} />
        </View>
        {lastScannedStudent ? <View style={styles.listBlock}><Text style={styles.metaText}>Latest verification</Text><Text style={styles.rowTitle}>{lastScannedStudent.name}</Text><Text style={styles.rowText}>{lastScannedStudent.student_uid} • {lastScannedStudent.current_batch || lastScannedStudent.batch_name || 'N/A'}</Text></View> : null}
      </SectionCard>
      <SectionCard title="Live Roster" subtitle="Tap a student for details and batch assignment tools.">
        {roster.length ? roster.map((student) => (
          <Pressable key={student.student_uid} style={styles.rowCard} onPress={() => openStudentDetail(student)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{student.name}</Text>
              <Text style={styles.rowText}>{student.student_uid}</Text>
            </View>
            <Text style={styles.rowMeta}>{student.current_batch || student.batch_name || '-'}</Text>
          </Pressable>
        )) : <Text style={styles.emptyBody}>No roster data yet.</Text>}
      </SectionCard>
    </>
  );

  const renderStaffStudents = () => (
    <>
      <SectionCard title="Students" subtitle="Search the database and manage per-student assignments.">
        <LabeledInput label="Search" value={studentSearch} onChangeText={setStudentSearch} placeholder="Search by name, UID, phone, or batch" />
        <PillTabs items={[{ key: '', label: 'All' }, ...batches.map((batch) => ({ key: batch.name, label: batch.name }))]} value={selectedBatch} onChange={setSelectedBatch} />
      </SectionCard>
      <SectionCard title="Student Directory" subtitle={`${filteredStudents.length} records loaded.`}>
        {filteredStudents.length ? filteredStudents.map((student) => (
          <Pressable key={student.student_uid} style={styles.rowCard} onPress={() => openStudentDetail(student)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{student.name}</Text>
              <Text style={styles.rowText}>{student.student_uid} • {student.phone || '-'}</Text>
            </View>
            <Text style={styles.rowMeta}>{student.batch_name || '-'}</Text>
          </Pressable>
        )) : <Text style={styles.emptyBody}>No students match the current filter.</Text>}
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
      {batchSummary ? (
        <SectionCard title={`Attendance Trend • ${selectedBatch}`} subtitle="Recent closed-session history for the selected batch.">
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
              <Text style={styles.rowText}>{material.batch_name || 'GLOBAL'} • {prettyDate(material.created_at)}</Text>
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
                <Text style={styles.metaText}>{notice.target_batch || 'ALL'} • {prettyDate(notice.created_at)}</Text>
                <Text style={styles.rowTitle}>{notice.title}</Text>
                <Text style={styles.rowText}>{notice.content}</Text>
              </View>
            )) : <Text style={styles.emptyBody}>No notices published yet.</Text>}
          </SectionCard>
        </>
      ) : null}
      {staffNotificationSection === 'absentees' ? (
        <SectionCard title="Absentee Report" subtitle="Export an Excel-friendly sheet with a message link already prepared for parents.">
          <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={selectedBatch} onChange={setSelectedBatch} />
          {batchHistory.length ? (
            <>
              <PillTabs
                items={batchHistory.map((entry) => ({ key: String(entry.session_id || ''), label: entry.session_name }))}
                value={selectedAbsenteeSessionId}
                onChange={setSelectedAbsenteeSessionId}
              />
              {batchHistory.map((entry, index) => (
                <View key={`${entry.session_id || index}`} style={styles.rowCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{entry.session_name}</Text>
                    <Text style={styles.rowText}>{entry.date}</Text>
                  </View>
                  <Text style={styles.rowMeta}>{entry.total - entry.present - entry.late} absent</Text>
                </View>
              ))}
              <PrimaryButton title="Export Absentee Sheet" onPress={exportAbsenteeCsv} />
              <Text style={styles.helper}>The exported CSV includes a `Message Link` column that opens the SMS app with the message already typed.</Text>
            </>
          ) : (
            <Text style={styles.emptyBody}>No closed sessions yet for the selected batch.</Text>
          )}
        </SectionCard>
      ) : null}
      {staffNotificationSection === 'test_reports' ? (
        <SectionCard title="Test Report Export" subtitle="Download one sheet with `UID`, `Name`, and one separate column for each launched test in the selected batch.">
          <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={selectedBatch} onChange={setSelectedBatch} />
          <PrimaryButton title="Export Test Report" onPress={exportTestReportCsv} disabled={!selectedBatch} />
          <Text style={styles.helper}>Each launched test becomes its own column in the format `TestName_YYYY-MM-DD`, and each cell shows the student score.</Text>
        </SectionCard>
      ) : null}
      {staffNotificationSection === 'leads' ? (
        <SectionCard title="Lead Pings" subtitle="Detailed contact-form leads from `riteshmathematics.in`." right={<PrimaryButton title="Mark All Read" onPress={markAllLeadsRead} tone="secondary" />}>
          {leads.filter((lead) => {
            const normalizedSource = (lead.source || '').trim().toLowerCase();
            return normalizedSource && normalizedSource !== 'id_card_permission_request';
          }).length ? leads.filter((lead) => {
            const normalizedSource = (lead.source || '').trim().toLowerCase();
            return normalizedSource && normalizedSource !== 'id_card_permission_request';
          }).map((lead) => (
            <View key={lead.id} style={styles.listBlock}>
              <Text style={styles.metaText}>{lead.is_read ? 'READ' : 'NEW'} • {prettifyLeadSource(lead.source)} • {prettyDate(lead.created_at)}</Text>
              <Text style={styles.rowTitle}>{lead.name}</Text>
              <Text style={styles.rowText}>{lead.phone}{lead.email ? ` • ${lead.email}` : ''}</Text>
              <Text style={styles.helper}>{lead.message || 'No message attached.'}</Text>
              <View style={styles.buttonRow}>
                <PrimaryButton title="Mark Read" onPress={() => markLeadRead(lead.id)} tone="secondary" />
              </View>
            </View>
          )) : <Text style={styles.emptyBody}>No lead pings yet.</Text>}
        </SectionCard>
      ) : null}
      {staffNotificationSection === 'id_requests' ? (
        <SectionCard title="ID Requests" subtitle="Approve or block phone numbers for student ID generation." right={<PrimaryButton title="Mark All Read" onPress={markAllLeadsRead} tone="secondary" />}>
          {leads.filter((lead) => {
            const normalizedSource = (lead.source || '').trim().toLowerCase();
            return !normalizedSource || normalizedSource === 'id_card_permission_request';
          }).length ? leads.filter((lead) => {
            const normalizedSource = (lead.source || '').trim().toLowerCase();
            return !normalizedSource || normalizedSource === 'id_card_permission_request';
          }).map((lead) => (
            <View key={lead.id} style={styles.listBlock}>
              <Text style={styles.metaText}>{lead.is_read ? 'READ' : 'NEW'} • {prettyDate(lead.created_at)}</Text>
              <Text style={styles.rowTitle}>{lead.name}</Text>
              <Text style={styles.rowText}>{lead.phone}{lead.email ? ` • ${lead.email}` : ''}</Text>
              <Text style={styles.helper}>{lead.message || 'ID card approval request received.'}</Text>
              <Text style={styles.helper}>{lead.id_card_allowed ? `Approved by ${lead.id_card_allowed_by || 'staff'}` : 'Pending approval'}</Text>
              <View style={styles.buttonRow}>
                <PrimaryButton title="Mark Read" onPress={() => markLeadRead(lead.id)} tone="secondary" />
                <PrimaryButton title="Approve" onPress={() => setLeadApproval(lead.id, true)} tone="success" />
                <PrimaryButton title="Block" onPress={() => setLeadApproval(lead.id, false)} tone="danger" />
              </View>
            </View>
          )) : <Text style={styles.emptyBody}>No ID requests yet.</Text>}
        </SectionCard>
      ) : null}
    </>
  );

  const renderStaffReports = () => (
    <>
      <SectionCard title="Exports" subtitle="Download the master CSV or a selected batch report.">
        <PillTabs items={[{ key: 'ALL', label: 'All Batches' }, ...batches.map((batch) => ({ key: batch.name, label: batch.name }))]} value={reportBatch} onChange={setReportBatch} />
        <View style={styles.buttonRow}>
          <PrimaryButton title="Export Full Data" onPress={() => exportCsv()} />
          <PrimaryButton title="Export Selected Batch" onPress={() => exportCsv(reportBatch)} tone="secondary" disabled={reportBatch === 'ALL'} />
          <PrimaryButton title="Refresh Reports" onPress={loadReports} tone="secondary" />
        </View>
      </SectionCard>
      {report ? (
        <SectionCard title={`Batch Report • ${report.batch}`} subtitle="Attendance percentage and batch session data.">
          {report.students.map((student) => (
            <Pressable key={student.student_uid} style={styles.rowCard} onPress={() => openStudentDetail(student as StudentRow)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{student.name}</Text>
                <Text style={styles.rowText}>{student.student_uid} • {student.current_batch || report.batch}</Text>
              </View>
              <Text style={styles.rowMeta}>{student.attendance_percent ?? 0}%</Text>
            </Pressable>
          ))}
        </SectionCard>
      ) : null}
      <SectionCard title="Weekly Attendance Alerts" subtitle="Students below 75% attendance over the weekly window.">
        {weeklyAlerts.length ? weeklyAlerts.map((alert) => (
          <View key={alert.id} style={styles.listBlock}>
            <Text style={styles.metaText}>{alert.batch_id} • {prettyDate(alert.created_at)}</Text>
            <Text style={styles.rowTitle}>{alert.summary}</Text>
            <Text style={styles.rowText}>{alert.low_count} low-attendance students out of {alert.total_students}</Text>
          </View>
        )) : <Text style={styles.emptyBody}>No weekly alerts yet.</Text>}
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
        <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={selectedBatch} onChange={setSelectedBatch} />
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
        <LabeledInput label="Phone" value={staffCardForm.phone} onChangeText={(value) => setStaffCardForm((prev) => ({ ...prev, phone: value }))} placeholder="+91..." keyboardType="phone-pad" />
        <PillTabs items={[{ key: 'teacher', label: 'Teacher' }, { key: 'staff', label: 'Staff' }]} value={staffCardForm.role} onChange={(value) => setStaffCardForm((prev) => ({ ...prev, role: value as 'teacher' | 'staff' }))} />
        <PrimaryButton title="Create Staff Card" onPress={createStaffCard} />
        {createdStaffCard ? (
          <View style={styles.listBlock}>
            <Text style={styles.rowTitle}>{createdStaffCard.full_name || createdStaffCard.username}</Text>
            <Text style={styles.rowText}>{createdStaffCard.role} • {createdStaffCard.username}</Text>
            {createdStaffCard.scan_url ? <Text style={styles.helper}>{createdStaffCard.scan_url}</Text> : null}
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
        <PillTabs items={[{ key: '', label: 'All' }, ...batches.map((batch) => ({ key: batch.name, label: batch.name }))]} value={selectedBatch} onChange={setSelectedBatch} />
        {staffDoubts.filter(d => !selectedBatch || d.batch_name === selectedBatch).length ? staffDoubts.filter(d => !selectedBatch || d.batch_name === selectedBatch).map((doubt) => (
          <View key={doubt.id} style={styles.listBlock}>
            <Text style={styles.metaText}>{doubt.student_name} • {doubt.batch_name} • {prettyDate(doubt.created_at)}</Text>
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

  const renderStaffWorkspace = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor="#6A4D3B" />}>
      <View style={styles.tabContainer}>
        <PillTabs items={staffTabs} value={staffTab} onChange={(value) => setStaffTab(value as StaffTab)} />
      </View>
      {staffTab === 'home' && renderStaffHome()}
      {staffTab === 'attendance' && renderStaffAttendance()}
      {staffTab === 'students' && renderStaffStudents()}
      {staffTab === 'batches' && renderStaffBatches()}
      {staffTab === 'materials' && renderStaffMaterials()}
      {staffTab === 'notifications' && renderStaffNotifications()}
      {staffTab === 'reports' && renderStaffReports()}
      {staffTab === 'tests' && renderStaffTests()}
      {staffTab === 'doubts' && renderStaffDoubts()}
      {staffTab === 'admin' && isHost && renderStaffAdmin()}
    </ScrollView>
  );

  const selectedStudentBatchOptions = batches.map((batch) => ({ key: batch.name, label: batch.name }));

  if (booting) {
    return (
      <SafeAreaView style={styles.root}>
        <ExpoStatusBar style="light" />
        <View style={styles.bootShell}>
          <ActivityIndicator size="large" color="#6A4D3B" />
          <Text style={styles.bootText}>Loading RMC Mobile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ExpoStatusBar style="light" />
      <StatusBar barStyle="light-content" />
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
      <ScannerModal visible={attendanceScannerVisible} title="Attendance Scanner" subtitle="Scan student cards to mark attendance in the current session." onClose={() => setAttendanceScannerVisible(false)} onScan={verifyAttendanceQr} />

      <DetailModal visible={studentModalVisible} title={selectedStudent?.name || 'Student Detail'} onClose={() => setStudentModalVisible(false)}>
        {selectedStudent ? (
          <>
            {selectedStudent.photo_path ? <Image source={{ uri: makeAbsoluteUrl(baseUrl, selectedStudent.photo_path) }} style={styles.detailPhoto} /> : null}
            <Text style={styles.metaText}>{selectedStudent.student_uid}</Text>
            <Text style={styles.rowText}>{selectedStudent.phone || '-'} • {selectedStudent.father_name || '-'}</Text>
            <Text style={styles.rowText}>{selectedStudent.address || '-'}</Text>
            <Text style={styles.helper}>Tap batches below to assign this student.</Text>
            <View style={styles.selectionWrap}>
              {selectedStudentBatchOptions.map((batch) => {
                const active = selectedStudentBatches.includes(batch.key);
                return (
                  <Pressable key={batch.key} onPress={() => setSelectedStudentBatches((prev) => prev.includes(batch.key) ? prev.filter((value) => value !== batch.key) : [...prev, batch.key])} style={[styles.selectionChip, active && styles.selectionChipActive]}>
                    <Text style={[styles.selectionChipText, active && styles.selectionChipTextActive]}>{batch.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.buttonRow}>
              <PrimaryButton title="Save Batches" onPress={saveStudentBatches} />
              {isHost ? <PrimaryButton title="Delete Student" onPress={deleteStudent} tone="danger" /> : null}
            </View>
          </>
        ) : null}
      </DetailModal>

      <DetailModal visible={testAttemptVisible} title={activeTestAttempt?.launch.title || 'Test'} onClose={() => { setTestAttemptVisible(false); setActiveTestAttempt(null); }}>
        {activeTestAttempt ? (
          <>
            <Text style={styles.helper}>{activeTestAttempt.launch.subject} • {activeTestAttempt.launch.duration_minutes} minutes • {activeTestAttempt.launch.question_count} questions</Text>
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

      {!!busyMessage ? <View style={styles.busyOverlay}><ActivityIndicator size="large" color="#6A4D3B" /><Text style={styles.busyText}>{busyMessage}</Text></View> : null}
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
  root: { flex: 1, backgroundColor: '#EDF4FB' },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 32, paddingBottom: 80 },
  tabContainer: { marginHorizontal: 2, marginBottom: 24, marginTop: 12 },
  tabsRow: { gap: 12, paddingVertical: 14, paddingHorizontal: 6 },
  tabChip: { minWidth: 120, paddingHorizontal: 28, paddingVertical: 20, borderRadius: 40, backgroundColor: 'rgba(255, 255, 255, 0.9)', alignItems: 'center' },
  tabChipActive: { backgroundColor: '#3B82F6', shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.35, shadowRadius: 24, elevation: 12 },
  tabChipText: { color: '#475569', fontWeight: '800', fontSize: 17 },
  tabChipTextActive: { color: '#FFFFFF' },
  heroBranding: { alignItems: 'center', marginVertical: 32, gap: 4 },
  heroTitle: { color: '#1E293B', fontSize: 56, fontWeight: '900', letterSpacing: -2 },
  heroSubtitle: { color: '#3B82F6', fontSize: 18, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  section: { borderRadius: 56, padding: 36, backgroundColor: 'rgba(255, 255, 255, 0.98)', gap: 28, shadowColor: '#1E293B', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.12, shadowRadius: 48, elevation: 14, borderWidth: 1, borderColor: '#FFFFFF' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 8 },
  sectionTitle: { color: '#0F172A', fontSize: 32, fontWeight: '900', letterSpacing: -0.8 },
  sectionSubtitle: { color: '#475569', fontSize: 17, lineHeight: 26, marginTop: 6 },
  inputGroup: { gap: 12 },
  label: { color: '#6A4D3B', fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 4 },
  input: { borderRadius: 28, backgroundColor: '#E9F1EA', color: '#1A2B1D', paddingHorizontal: 24, paddingVertical: 20, fontSize: 17, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.5)' },
  inputMultiline: { minHeight: 140, textAlignVertical: 'top' },
  button: { height: 64, borderRadius: 32, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#3E5041', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 8 },
  buttonPrimary: { backgroundColor: '#6A4D3B' },
  buttonSecondary: { backgroundColor: '#E9F1EA', shadowOpacity: 0, elevation: 0 },
  buttonDanger: { backgroundColor: '#CF5C5C' },
  buttonSuccess: { backgroundColor: '#6B8E69' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  buttonTextSecondary: { color: '#1A2B1D' },
  helper: { color: '#3E5041', fontSize: 14, lineHeight: 20 },
  kpiRow: { flexDirection: 'row', gap: 16 },
  kpiBlock: { flex: 1, borderRadius: 40, padding: 24, backgroundColor: '#FFFFFF', shadowColor: '#3E5041', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  kpiValue: { color: '#1A2B1D', fontSize: 32, fontWeight: '900' },
  kpiLabel: { color: '#6B8E69', marginTop: 8, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  buttonRow: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  rowCard: { flexDirection: 'row', gap: 16, alignItems: 'center', borderRadius: 36, padding: 24, backgroundColor: '#FFFFFF', shadowColor: '#3E5041', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12 },
  rowTitle: { color: '#1A2B1D', fontSize: 20, fontWeight: '800' },
  rowText: { color: '#3E5041', fontSize: 16, lineHeight: 24, marginTop: 4 },
  rowMeta: { color: '#6B8E69', fontSize: 14, fontWeight: '900' },
  listBlock: { borderRadius: 36, padding: 24, backgroundColor: '#F8FBF8', gap: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  metaText: { color: '#6B8E69', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  emptyPanel: { margin: 20, padding: 40, borderRadius: 48, backgroundColor: 'rgba(255, 255, 255, 0.9)', gap: 18, shadowColor: '#3E5041', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.15, shadowRadius: 25, elevation: 5, alignItems: 'center' },
  emptyTitle: { color: '#1A2B1D', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  emptyBody: { color: '#3E5041', fontSize: 17, lineHeight: 26, textAlign: 'center' },
  photoPanel: { borderRadius: 32, minHeight: 240, backgroundColor: '#E2EDE3', alignItems: 'center', justifyContent: 'center', padding: 20, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.6)', borderStyle: 'dashed' },
  photoPreview: { width: '100%', height: 260, borderRadius: 28 },
  inlineActionColumn: { gap: 12, minWidth: 110 },
  modalRoot: { flex: 1, backgroundColor: '#D1E0D4' },
  modalTop: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, flexDirection: 'row', gap: 16, alignItems: 'center', backgroundColor: 'transparent' },
  modalTitle: { color: '#1A2B1D', fontSize: 30, fontWeight: '900' },
  modalSubtitle: { color: '#3E5041', fontSize: 16, marginTop: 8 },
  modalContent: { padding: 16, gap: 28, paddingBottom: 60 },
  cameraShell: { flex: 1, margin: 24, borderRadius: 56, overflow: 'hidden', backgroundColor: '#000' },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(209, 224, 212, 0.3)' },
  cameraFrame: { width: '70%', aspectRatio: 1, borderRadius: 56, borderWidth: 6, borderColor: '#6A4D3B' },
  cameraText: { marginTop: 40, color: '#FFFFFF', fontSize: 18, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: {width: 0, height: 2}, textShadowRadius: 10 },
  posterPanel: { padding: 24, borderRadius: 40, backgroundColor: '#E9F1EA' },
  posterCopy: { color: '#1A2B1D', fontSize: 17, lineHeight: 28, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  dividerText: { flex: 1, textAlign: 'center', color: '#6B8E69', fontSize: 14, fontWeight: '800', textTransform: 'uppercase' },
  bootShell: { flex: 1, backgroundColor: '#D1E0D4', alignItems: 'center', justifyContent: 'center', gap: 24 },
  bootText: { color: '#1A2B1D', fontSize: 22, fontWeight: '900' },
  busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(209, 224, 212, 0.96)', alignItems: 'center', justifyContent: 'center', gap: 24, zIndex: 100 },
  busyText: { color: '#1A2B1D', fontSize: 20, fontWeight: '900' },
  detailPhoto: { width: '100%', height: 320, borderRadius: 32, marginBottom: 24 },
  selectionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  selectionChip: { paddingHorizontal: 22, paddingVertical: 18, borderRadius: 32, backgroundColor: 'rgba(255, 255, 255, 0.85)', borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.4)' },
  selectionChipActive: { backgroundColor: '#6A4D3B' },
  selectionChipText: { color: '#3E5041', fontWeight: '800' },
  selectionChipTextActive: { color: '#FFFFFF' },
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
  idCardContainer: { marginVertical: 12, paddingBottom: 12 },
  idCardPro: { width: '100%', aspectRatio: 1.6, borderRadius: 28, backgroundColor: '#1A2B1D', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.4, shadowRadius: 32, elevation: 15, position: 'relative', backfaceVisibility: 'hidden' },
  idBrandBanner: { paddingHorizontal: 20, paddingVertical: 14, gap: 4, backgroundColor: 'rgba(255,255,255,0.04)' },
  idWatermark: { position: 'absolute', top: -40, right: -40, opacity: 0.05 },
  idWatermarkText: { fontSize: 240, fontWeight: '900', color: '#FFFFFF' },
  idTopBar: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'flex-start' },
  idLogoArea: { gap: 0 },
  idLogomarkBig: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  idLogomarkSmall: { color: '#6B8E69', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2, marginTop: -4 },
  idType: { alignItems: 'flex-end', gap: 2 },
  idTypeMain: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'right', opacity: 0.9 },
  idTypeYear: { color: '#6B8E69', fontSize: 12, fontWeight: '900' },
  idConcept: { position: 'absolute', top: '25%', left: 20 },
  conceptMainText: { color: 'rgba(255,255,255,0.08)', fontSize: 72, fontWeight: '900' },
  conceptSubText: { color: '#6B8E69', fontSize: 13, fontWeight: '800', marginTop: -20, marginLeft: 4 },
  idBatchBox: { position: 'absolute', top: 20, left: 140, backgroundColor: 'rgba(107, 142, 105, 0.15)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
  idBatchText: { color: '#6B8E69', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  idMiddleGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 10, alignItems: 'center' },
  idQrZone: { width: 80, height: 80, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 8 },
  idQrImage: { width: '100%', height: '100%' },
  idPhotoZone: { width: 100, height: 120, borderRadius: 16, backgroundColor: '#3E5041', overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)' },
  idPhoto: { width: '100%', height: '100%' },
  idDetails: { paddingHorizontal: 20, marginTop: 12 },
  idName: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  idUid: { color: '#6B8E69', fontSize: 14, fontWeight: '900', marginTop: 2 },
  idSecondaryRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
  idSecondaryText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800' },
  idParent: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '800', marginTop: 4 },
  idFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', paddingHorizontal: 20 },
  idFooterText: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  cardActionRow: { alignItems: 'center', marginTop: 18 },
  cardActionText: { color: '#3E5041', fontSize: 14, fontWeight: '800', textTransform: 'uppercase', opacity: 0.6, letterSpacing: 1 },
  backFieldList: { padding: 24, gap: 16, marginTop: 60 },
  backFieldRow: { flexDirection: 'row', gap: 16 },
  backFieldFull: { gap: 4 },
  backFieldHalf: { flex: 1, gap: 4 },
  backFieldLabel: { color: '#6B8E69', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  backFieldValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  backFieldValueStrong: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  backFieldCompact: { color: 'rgba(255,255,255,0.5)', fontSize: 11, lineHeight: 16, fontWeight: '600' },
  backBrandBanner: { position: 'absolute', top: 20, left: 20 },
  idBrandTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  idBrandTagline: { color: '#6B8E69', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  backFooterStrip: { position: 'absolute', bottom: 16, left: 24, right: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backFooterUrl: { color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '800' },
  backFooterTag: { backgroundColor: '#6B8E69', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  backFooterTagText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  statusPill: { backgroundColor: '#E9F1EA', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  statusPillText: { color: '#1A2B1D', fontSize: 11, fontWeight: '900' },
  noticeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  badge: { backgroundColor: '#6A4D3B', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }
});
