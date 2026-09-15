import React, { useCallback, useRef, useState } from 'react';
import { StudentTabNavigator } from './screens/student/StudentTabNavigator';
import { StudentWaitingRoom } from './screens/student/StudentWaitingRoom';
import { SecureAttemptScreen } from './screens/student/SecureAttemptScreen';
import { StudentResultReviewScreen } from './screens/student/StudentResultReviewScreen';
import { TeacherTabNavigator } from './screens/teacher/TeacherTabNavigator';
import { TeacherQrScanner } from './screens/teacher/TeacherQrScanner';
import { TeacherExamCreator } from './screens/teacher/TeacherExamCreator';
import { TeacherGateMonitor } from './screens/teacher/TeacherGateMonitor';
import { TeacherExamDetail } from './screens/teacher/TeacherExamDetail';
import { PracticeEntryScreen } from './screens/student/PracticeEntryScreen';

type ScreenName =
  | 'StudentRoot'
  | 'StudentWaitingRoom'
  | 'PracticeEntryScreen'
  | 'SecureAttemptScreen'
  | 'StudentResultReview'
  | 'TeacherRoot'
  | 'TeacherQrScanner'
  | 'TeacherExamCreator'
  | 'TeacherGateMonitor'
  | 'TeacherExamDetail';

type StackEntry = { screen: ScreenName; params?: Record<string, any> };

interface NavObject {
  navigate: (screen: ScreenName, params?: Record<string, any>) => void;
  replace: (screen: ScreenName, params?: Record<string, any>) => void;
  goBack: () => void;
  popToTop: () => void;
}

interface ExamNavigatorProps {
  role: 'student' | 'teacher';
  onExit?: () => void;
}

export function ExamNavigator({ role, onExit }: ExamNavigatorProps) {
  const initialScreen: ScreenName = role === 'student' ? 'StudentRoot' : 'TeacherRoot';
  const [stack, setStack] = useState<StackEntry[]>([{ screen: initialScreen }]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const navigate = useCallback((screen: ScreenName, params?: Record<string, any>) => {
    setStack((prev) => [...prev, { screen, params }]);
  }, []);

  const replace = useCallback((screen: ScreenName, params?: Record<string, any>) => {
    setStack((prev) => [...prev.slice(0, -1), { screen, params }]);
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) {
        onExit?.();
        return prev;
      }
      return prev.slice(0, -1);
    });
  }, [onExit]);

  const popToTop = useCallback(() => {
    setStack((prev) => [prev[0]]);
  }, []);

  const navigation: NavObject = { navigate, replace, goBack, popToTop };

  const current = stack[stack.length - 1];
  const route = { params: current.params ?? {} };

  switch (current.screen) {
    case 'StudentRoot':
      return <StudentTabNavigator navigation={navigation} />;

    case 'StudentWaitingRoom':
      return <StudentWaitingRoom route={route} navigation={navigation} />;

    case 'PracticeEntryScreen':
      return <PracticeEntryScreen route={route} navigation={navigation} />;

    case 'SecureAttemptScreen':
      return <SecureAttemptScreen route={route} navigation={navigation} />;

    case 'StudentResultReview':
      return <StudentResultReviewScreen route={route} navigation={navigation} />;

    case 'TeacherRoot':
      return <TeacherTabNavigator navigation={navigation} />;

    case 'TeacherQrScanner':
      return <TeacherQrScanner route={route} navigation={navigation} />;

    case 'TeacherExamCreator':
      return <TeacherExamCreator navigation={navigation} />;

    case 'TeacherGateMonitor':
      return <TeacherGateMonitor route={route} navigation={navigation} />;

    case 'TeacherExamDetail':
      return <TeacherExamDetail route={route} navigation={navigation} />;

    default:
      return null;
  }
}
