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
  View
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';

type SessionInfo = { type: 'student'; student: StudentProfile } | { type: 'staff'; user: StaffUser } | null;
type GuestTab = 'welcome' | 'student' | 'staff' | 'register';
type StudentTab = 'overview' | 'tests' | 'doubts';
type StaffTab = 'home' | 'attendance' | 'students' | 'batches' | 'materials' | 'notifications' | 'reports' | 'tests' | 'doubts' | 'admin';
type StaffNotificationSection = 'notices' | 'absentees' | 'test_reports' | 'leads' | 'id_requests';

type DoubtItem = {
  id: number;
  student_uid: string;
  student_name?: string;
  batch_name?: string;
  phone?: string;
  question_text: string;
  question_image?: string;
  reply_image?: string;
  status: 'pending' | 'solved' | 'flagged';
  created_at: string;
  replied_at?: string;
};

type StudentProfile = {
  student_uid: string;
  name: string;
  phone?: string;
  father_name?: string;
  guardian_phone?: string;
  current_batch?: string;
  batch_name?: string;
  batches?: string[] | string;
  aspiration?: string;
  student_class?: string;
  address?: string;
  photo_path?: string;
  qr_path?: string;
  secure_token?: string;
  attendance_percent?: number;
  attendance?: Record<string, string>;
};

type StaffUser = {
  id?: number;
  username: string;
  role: 'host' | 'teacher' | 'staff';
  full_name?: string;
  phone?: string;
};
