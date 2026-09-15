// Entry point — drop this straight into the host app's tab/section.
// Handles exam-backend auth (RMC bridge + dev fallback) then renders ExamNavigator.
export { ExamEntry } from './ExamEntry';
export type { ExamCredentials } from './ExamEntry';

// Navigator (lower-level — use ExamEntry unless you manage auth yourself)
export { ExamNavigator } from './ExamNavigator';

// Student screens
export { StudentTabNavigator } from './screens/student/StudentTabNavigator';
export { StudentExamList } from './screens/student/StudentExamList';
export { StudentPracticeLibrary } from './screens/student/StudentPracticeLibrary';
export { StudentResultsTab, saveAttemptMeta } from './screens/student/StudentResultsTab';
export { StudentResultReviewScreen } from './screens/student/StudentResultReviewScreen';
export { StudentWaitingRoom } from './screens/student/StudentWaitingRoom';
export { SecureAttemptScreen } from './screens/student/SecureAttemptScreen';

// Teacher screens
export { TeacherTabNavigator } from './screens/teacher/TeacherTabNavigator';
export { QuestionPaperManager } from './screens/teacher/QuestionPaperManager';
export { TeacherHistoryTab } from './screens/teacher/TeacherHistoryTab';
export { TeacherGateMonitor } from './screens/teacher/TeacherGateMonitor';
export { TeacherDashboard } from './screens/teacher/TeacherDashboard';
export { TeacherQrScanner } from './screens/teacher/TeacherQrScanner';
export { TeacherExamCreator } from './screens/teacher/TeacherExamCreator';
export { TeacherQuestionEditor } from './screens/teacher/TeacherQuestionEditor';

// Services
export {
  examFetch,
  getExamBaseUrl,
  getExamWebSocketUrl,
  getExamHeaders,
  setExamBaseUrl,
  setExamWsPort,
  STORAGE_EXAM_TOKEN,
  STORAGE_EXAM_USER,
} from './services/api';
export { examWs } from './services/websocket';

// Hooks
export { useExamTimer } from './hooks/useExamTimer';
