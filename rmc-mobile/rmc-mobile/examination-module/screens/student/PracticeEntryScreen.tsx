import React, { useEffect, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '../../theme';

// ── Session shape (kept in sync with SecureAttemptScreen) ────────────────────

export interface PracticeSession {
  examId: number;
  answers: Record<number, any>;
  practiceChecks: Record<number, number>;
  practiceRevealed: Record<number, boolean>;
  /** ISO string of when this session's timer should expire. null = no timer. */
  timerEndsAt: string | null;
  savedAt: number;
}

export function practiceSessionKey(examId: number) {
  return `@rmc_practice_session_v1_${examId}`;
}

export async function loadPracticeSession(examId: number): Promise<PracticeSession | null> {
  try {
    const raw = await AsyncStorage.getItem(practiceSessionKey(examId));
    return raw ? (JSON.parse(raw) as PracticeSession) : null;
  } catch {
    return null;
  }
}

export async function clearPracticeSession(examId: number) {
  await AsyncStorage.removeItem(practiceSessionKey(examId)).catch(() => {});
}

// ── Timer options ─────────────────────────────────────────────────────────────

const TIMER_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'No limit', minutes: null },
  { label: '30 min', minutes: 30 },
  { label: '60 min', minutes: 60 },
  { label: '90 min', minutes: 90 },
  { label: '3 hrs', minutes: 180 },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function PracticeEntryScreen({ route, navigation }: { route: any; navigation: any }) {
  const { examId, title, offlineQuestions } = route.params as {
    examId: number;
    title: string;
    offlineQuestions: any[];
  };

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [timerChoice, setTimerChoice] = useState<number | null>(null); // minutes, null = no limit
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    loadPracticeSession(examId).then((s) => {
      setSession(s);
      setChecking(false);
    });
  }, [examId]);

  const answeredCount = session
    ? Object.values(session.answers).filter(
        (a: any) => a.selected_option_id !== undefined || (a.integer_answer ?? '').trim() !== ''
      ).length
    : 0;

  const buildTimerEndsAt = (): string | null => {
    if (timerChoice === null) return null;
    return new Date(Date.now() + timerChoice * 60 * 1000).toISOString();
  };

  const goToAttempt = (resumeSession: PracticeSession | null) => {
    navigation.replace('SecureAttemptScreen', {
      examId,
      title,
      isPractice: true,
      isOffline: true,
      offlineQuestions,
      practiceSession: resumeSession,
      practiceTimerEndsAt: resumeSession?.timerEndsAt ?? buildTimerEndsAt(),
    });
  };

  const handleStart = () => goToAttempt(null);

  const handleResume = () => {
    if (!session) return;
    goToAttempt(session);
  };

  const handleRestart = () => {
    Alert.alert(
      'Restart Attempt',
      'This will erase your current progress. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart',
          style: 'destructive',
          onPress: async () => {
            await clearPracticeSession(examId);
            setSession(null);
            goToAttempt(null);
          },
        },
      ],
    );
  };

  if (checking) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.center}>
          <Text style={s.loadTxt}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const savedAgo = session
    ? (() => {
        const ms = Date.now() - session.savedAt;
        const mins = Math.floor(ms / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ago`;
      })()
    : null;

  // If resuming, timer was already set when the session started — don't change it
  const showTimerPicker = !session;

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Text style={s.backTxt}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.titleTxt} numberOfLines={2}>{title}</Text>
          <Text style={s.modeTxt}>Practice Mode · {offlineQuestions?.length ?? 0} questions</Text>
        </View>

        {/* Saved session card */}
        {session && (
          <View style={s.sessionCard}>
            <Text style={s.sessionCardTitle}>Saved Session Found</Text>
            <Text style={s.sessionCardDetail}>
              {answeredCount}/{offlineQuestions?.length ?? 0} questions answered · saved {savedAgo}
            </Text>
            {session.timerEndsAt && (
              <Text style={s.sessionCardDetail}>
                Timer: {Math.max(0, Math.round((new Date(session.timerEndsAt).getTime() - Date.now()) / 60000))} min remaining
              </Text>
            )}
            <View style={s.sessionBtns}>
              <TouchableOpacity style={s.resumeBtn} onPress={handleResume}>
                <Text style={s.resumeBtnTxt}>Resume →</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.restartBtn} onPress={handleRestart}>
                <Text style={s.restartBtnTxt}>Restart</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Timer picker — only when starting fresh */}
        {showTimerPicker && (
          <View style={s.timerSection}>
            <Text style={s.sectionLabel}>Set a time limit (optional)</Text>
            <View style={s.timerRow}>
              {TIMER_OPTIONS.map((opt) => {
                const selected = timerChoice === opt.minutes;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[s.timerChip, selected && s.timerChipSelected]}
                    onPress={() => setTimerChoice(opt.minutes)}
                  >
                    <Text style={[s.timerChipTxt, selected && s.timerChipTxtSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Start button (only shown when no saved session) */}
        {!session && (
          <TouchableOpacity style={s.startBtn} onPress={handleStart}>
            <Text style={s.startBtnTxt}>
              Start Practice →
            </Text>
          </TouchableOpacity>
        )}

        {/* Rules reminder */}
        <View style={s.rulesCard}>
          <Text style={s.rulesTitle}>Practice Rules</Text>
          <Text style={s.ruleItem}>• Tap "Check Answer" up to 3 times — answer reveals on the 3rd tap</Text>
          <Text style={s.ruleItem}>• Your progress auto-saves as you go</Text>
          <Text style={s.ruleItem}>• No screen pinning or security restrictions in practice mode</Text>
          <Text style={s.ruleItem}>• Tap "Finish" at any time to see your score</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:                { flex: 1, backgroundColor: T.bg },
  scroll:              { padding: 20, paddingBottom: 40 },
  center:              { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadTxt:             { color: T.textSecondary, fontSize: 15 },

  header:              { marginBottom: 24 },
  backBtn:             { marginBottom: 12 },
  backTxt:             { color: T.primary, fontSize: 14, fontWeight: '600' },
  titleTxt:            { fontSize: 22, fontWeight: '800', color: T.textPrimary, marginBottom: 6 },
  modeTxt:             { fontSize: 13, color: T.textSecondary },

  sessionCard:         { backgroundColor: T.surfaceAlt, borderRadius: T.radius, padding: 18, marginBottom: 24, borderWidth: 1, borderColor: T.border },
  sessionCardTitle:    { fontSize: 15, fontWeight: '800', color: T.primary, marginBottom: 6 },
  sessionCardDetail:   { fontSize: 13, color: T.textSecondary, marginBottom: 3 },
  sessionBtns:         { flexDirection: 'row', gap: 12, marginTop: 14 },
  resumeBtn:           { flex: 1, backgroundColor: T.primary, paddingVertical: 13, borderRadius: T.radius, alignItems: 'center' },
  resumeBtnTxt:        { color: '#fff', fontWeight: '800', fontSize: 15 },
  restartBtn:          { flex: 1, backgroundColor: T.dangerBg, paddingVertical: 13, borderRadius: T.radius, alignItems: 'center', borderWidth: 1, borderColor: T.danger },
  restartBtnTxt:       { color: T.danger, fontWeight: '700', fontSize: 15 },

  timerSection:        { marginBottom: 28 },
  sectionLabel:        { fontSize: 14, fontWeight: '700', color: T.textPrimary, marginBottom: 12 },
  timerRow:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timerChip:           { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: T.border, backgroundColor: T.surface },
  timerChipSelected:   { borderColor: T.primary, backgroundColor: T.primary + '18' },
  timerChipTxt:        { fontSize: 13, fontWeight: '600', color: T.textSecondary },
  timerChipTxtSelected:{ color: T.primary },

  startBtn:            { backgroundColor: T.primary, paddingVertical: 16, borderRadius: T.radius, alignItems: 'center', marginBottom: 28, elevation: 3, shadowColor: T.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6 },
  startBtnTxt:         { color: '#fff', fontWeight: '800', fontSize: 17 },

  rulesCard:           { backgroundColor: T.surfaceAlt, borderRadius: T.radius, padding: 16, borderWidth: 1, borderColor: T.border },
  rulesTitle:          { fontSize: 13, fontWeight: '800', color: T.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  ruleItem:            { fontSize: 13, color: T.textSecondary, lineHeight: 22, marginBottom: 3 },
});
