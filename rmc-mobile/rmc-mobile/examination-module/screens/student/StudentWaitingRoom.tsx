import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import WebView from 'react-native-webview';
// Import only pure-JS sub-paths; avoid the top-level 'qrcode' entry which pulls in canvas/fs
const QRCore = require('qrcode/lib/core/qrcode');
const SvgTagRenderer = require('qrcode/lib/renderer/svg-tag');

function generateQRSvg(data: string): string | null {
  try {
    const qrData = QRCore.create(data, { errorCorrectionLevel: 'M' });
    return SvgTagRenderer.render(qrData, { margin: 1 });
  } catch {
    return null;
  }
}

import { examFetch, getExamBaseUrl, STORAGE_EXAM_TOKEN } from '../../services/api';
import { examWs } from '../../services/websocket';
import { cacheExamPaper, loadCachedPaper } from '../../services/examPaperCache';
import { T } from '../../theme';

export function StudentWaitingRoom({ route, navigation }: { route: any; navigation: any }) {
  const { examId, title } = route.params;

  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [qrHtml, setQrHtml] = useState<string | null>(null);
  const [gateStatus, setGateStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false); // Show UI immediately; loading only for QR fetch
  const [error, setError] = useState<string | null>(null);
  const [paperStatus, setPaperStatus] = useState<'idle' | 'downloading' | 'ready' | 'failed'>('idle');

  const getOrCreateDeviceId = async () => {
    let deviceId = await AsyncStorage.getItem('@rmc_device_id');
    if (!deviceId) {
      deviceId =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
      await AsyncStorage.setItem('@rmc_device_id', deviceId);
    }
    return deviceId;
  };

  const initWaitingRoom = async () => {
    try {
      setError(null);
      const deviceId = await getOrCreateDeviceId();

      // has_overlay_permission: true — this app uses Android lock task mode
      // (startLockTask) instead of overlay windows. Signal to the backend that
      // screen-control permission is available.
      const response = await examFetch(`/student/exams/${examId}/gate/qr`, {
        method: 'POST',
        body: JSON.stringify({ device_id: deviceId, has_overlay_permission: true }),
      });

      const payload = typeof response.qr_payload === 'string' ? response.qr_payload : JSON.stringify(response.qr_payload);
      setQrPayload(payload);
      setGateStatus(response.gate);
      // Generate QR locally — pure JS, no external network request
      const svg = generateQRSvg(payload);
      if (svg) {
        setQrHtml(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>html,body{margin:0;padding:0;background:#fff;display:flex;align-items:center;justify-content:center;height:100%}svg{width:100%;height:100%}</style></head><body>${svg}</body></html>`);
      }
      setLoading(false);
      // Kick off paper pre-download in the background while student waits.
      // Best-effort: some backends may require an active attempt — if so we
      // silently fall through and let SecureAttemptScreen download it instead.
      prefetchPaper(deviceId);
    } catch (err: any) {
      setError(err.message || 'Failed to request waiting room verification');
    } finally {
      setLoading(false);
    }
  };

  const prefetchPaper = async (deviceId: string) => {
    try {
      const existing = await loadCachedPaper(examId);
      if (existing) { setPaperStatus('ready'); return; } // already cached

      setPaperStatus('downloading');
      const paperResp = await examFetch(`/student/exams/${examId}?device_id=${encodeURIComponent(deviceId)}`);
      const questions: any[] = paperResp.questions ?? [];
      if (questions.length === 0) { setPaperStatus('idle'); return; }

      const token = await SecureStore.getItemAsync(STORAGE_EXAM_TOKEN).catch(() => null);
      const imgBase = getExamBaseUrl().replace(/\/api$/, '');
      await cacheExamPaper(examId, questions, imgBase, token);
      setPaperStatus('ready');
    } catch {
      // Server may require active attempt — that's OK, SecureAttemptScreen will cache it
      setPaperStatus('idle');
    }
  };

  useEffect(() => {
    initWaitingRoom();
    examWs.connect();

    const unsubscribe = examWs.subscribe('gate.verified', (event) => {
      if (event.exam_id === examId) {
        setGateStatus((prev: any) => ({
          ...prev,
          gate_status: 'VERIFIED',
          can_start_attempt: true,
        }));
      }
    });

    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await examFetch(`/student/exams/${examId}/gate/status`);
        setGateStatus(statusResponse.gate);
      } catch {
        // polling errors are non-fatal
      }
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
      examWs.disconnect();
    };
  }, [examId]);

  const handleStartExam = () => {
    navigation.replace('SecureAttemptScreen', { examId, title });
  };

  const isVerified = gateStatus?.gate_status === 'VERIFIED';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>Waiting Room Verification</Text>
        </View>

        <View style={styles.body}>
            {!isVerified ? (
              <View style={styles.verificationSection}>
                <Text style={styles.instructionText}>
                  Present this QR code to the exam coordinator to verify your identity and enter the exam hall.
                </Text>

                {qrHtml && (
                  <View style={styles.qrContainer}>
                    <WebView
                      source={{ html: qrHtml }}
                      style={styles.qrImage}
                      scrollEnabled={false}
                      originWhitelist={['*']}
                    />
                  </View>
                )}

                <View style={styles.statusContainer}>
                  <ActivityIndicator size="small" color={T.warning} />
                  <Text style={styles.waitingText}>Waiting for supervisor scan...</Text>
                </View>

                {/* Paper download status — shown below the waiting indicator */}
                {paperStatus === 'downloading' && (
                  <View style={styles.paperStatusRow}>
                    <ActivityIndicator size="small" color={T.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.paperStatusTxt}>Downloading exam paper…</Text>
                  </View>
                )}
                {paperStatus === 'ready' && (
                  <View style={styles.paperStatusRow}>
                    <Text style={styles.paperStatusReady}>✓ Exam paper ready offline</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.successSection}>
                <View style={styles.checkIconContainer}>
                  <Text style={styles.checkIcon}>✅</Text>
                </View>
                <Text style={styles.successTitle}>Identity Verified!</Text>
                <Text style={styles.successSubtitle}>
                  You are now checked in. Tap below to enter secure exam mode.
                </Text>
                <TouchableOpacity style={styles.startButton} onPress={handleStartExam}>
                  <Text style={styles.startButtonText}>Start Secure Exam Mode</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.instructionsCard}>
              <Text style={styles.instructionsHeader}>🔒 Secure Mode Rules</Text>
              <Text style={styles.instructionItem}>
                • The app will enter Android Screen Pinning. You will be locked inside the exam.
              </Text>
              <Text style={styles.instructionItem}>
                • <Text style={styles.bold}>1st exit</Text> from the app = logged warning. You will be re-locked immediately.
              </Text>
              <Text style={styles.instructionItem}>
                • <Text style={styles.bold}>2nd exit</Text> = your exam is auto-submitted instantly. No exceptions.
              </Text>
              <Text style={styles.instructionItem}>
                • Screenshots and screen recording are blocked for the duration.
              </Text>
            </View>
          </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: T.bg },
  scrollContent:       { flexGrow: 1, padding: 20 },
  header:              { alignItems: 'center', marginBottom: 30 },
  title:               { fontSize: 20, fontWeight: '800', color: T.textPrimary, textAlign: 'center' },
  subtitle:            { fontSize: 13, color: T.textSecondary, marginTop: 6 },
  centered:            { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  statusText:          { color: T.textSecondary, marginTop: 16, fontSize: 15 },
  errorText:           { color: T.danger, fontSize: 15, textAlign: 'center', marginBottom: 20 },
  retryButton:         { backgroundColor: T.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: T.radiusSm },
  retryButtonText:     { color: '#fff', fontWeight: '700' },
  body:                { flex: 1, alignItems: 'center' },
  verificationSection: { alignItems: 'center', width: '100%' },
  instructionText:     { color: T.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 24, paddingHorizontal: 10 },
  qrContainer:         { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, marginBottom: 24, elevation: 8, shadowColor: T.shadowColor, shadowOffset:{width:0,height:4}, shadowOpacity:0.15, shadowRadius:8 },
  qrImage:             { width: 200, height: 200 },
  statusContainer:     { flexDirection: 'row', alignItems: 'center', backgroundColor: T.warningBg, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#FDE68A' },
  waitingText:         { color: T.warning, marginLeft: 8, fontWeight: '700', fontSize: 14 },
  successSection:      { alignItems: 'center', paddingVertical: 20 },
  checkIconContainer:  { backgroundColor: T.success, width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  checkIcon:           { fontSize: 40 },
  successTitle:        { fontSize: 22, fontWeight: '800', color: T.textPrimary, marginBottom: 10 },
  successSubtitle:     { color: T.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 30, paddingHorizontal: 20 },
  startButton:         { backgroundColor: T.primary, paddingVertical: 16, paddingHorizontal: 32, borderRadius: T.radius, elevation: 4, shadowColor: T.primary, shadowOffset:{width:0,height:4}, shadowOpacity:0.25, shadowRadius:8 },
  startButtonText:     { color: '#fff', fontWeight: '800', fontSize: 17 },
  instructionsCard:    { backgroundColor: T.dangerBg, borderRadius: T.radius, padding: 16, marginTop: 40, width: '100%', borderWidth: 1, borderColor: '#FECACA' },
  instructionsHeader:  { fontSize: 15, fontWeight: '800', color: T.danger, marginBottom: 12 },
  instructionItem:     { color: '#7F1D1D', fontSize: 13, lineHeight: 20, marginBottom: 8 },
  bold:            { fontWeight: '800', color: T.danger },
  paperStatusRow:  { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: T.surfaceAlt, borderRadius: T.radiusSm },
  paperStatusTxt:  { color: T.textSecondary, fontSize: 12, fontWeight: '600' },
  paperStatusReady:{ color: T.success, fontSize: 12, fontWeight: '700' },
});
