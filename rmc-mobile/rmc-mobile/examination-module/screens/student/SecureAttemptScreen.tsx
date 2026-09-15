import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator, Alert, AppState, AppStateStatus,
  Dimensions, Modal, NativeEventEmitter, NativeModules,
  SafeAreaView, ScrollView, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { examFetch, getExamBaseUrl, STORAGE_EXAM_TOKEN } from '../../services/api';
import { ZoomableImage } from '../../components/ZoomableImage';
import { useExamTimer } from '../../hooks/useExamTimer';
import { saveAttemptMeta } from './StudentResultsTab';
import { T } from '../../theme';

const { RmcLockTaskModule } = NativeModules;
const lockEmitter = RmcLockTaskModule ? new NativeEventEmitter(RmcLockTaskModule) : null;

// ── Types ─────────────────────────────────────────────────────────────────────

interface MediaItem { access_url: string; local_uri?: string; }

interface Option {
  id: number;
  option_label: string;
  option_text: string | null;
  is_correct?: boolean;
}

interface Question {
  id: number;
  section_code: string;
  question_type: 'MCQ' | 'INTEGER';
  question_order: number;
  question_text: string | null;
  question_options: Option[];
  question_media: MediaItem[];
  correct_integer_answer?: string | null;
}

type SaveStatus = 'SAVED' | 'PENDING' | 'FAILED';

type AnswerState = {
  selected_option_id?: number;
  integer_answer?: string;
  is_marked_for_review: boolean;
  save_status: SaveStatus;
};
type AnswerMap = Record<number, AnswerState>;

type Section = { code: string; questions: Question[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

function answered(ans?: AnswerState): boolean {
  if (!ans) return false;
  return ans.selected_option_id !== undefined ||
    (ans.integer_answer !== undefined && ans.integer_answer.trim() !== '');
}

type Stats = { answered: number; marked: number; answeredMarked: number; unanswered: number };

function sectionStats(questions: Question[], answers: AnswerMap): Stats {
  let a = 0, m = 0, am = 0;
  for (const q of questions) {
    const ans = answers[q.id];
    const isA = answered(ans);
    const isM = ans?.is_marked_for_review ?? false;
    if (isA && isM) am++;
    else if (isA) a++;
    else if (isM) m++;
  }
  return { answered: a, marked: m, answeredMarked: am, unanswered: questions.length - a - m - am };
}

function computeLocalScore(qs: Question[], answers: AnswerMap) {
  let correct = 0, wrong = 0, skip = 0;
  for (const q of qs) {
    const ans = answers[q.id];
    if (q.question_type === 'MCQ') {
      const chosen = q.question_options.find(o => o.id === ans?.selected_option_id);
      if (!chosen) skip++;
      else if (chosen.is_correct) correct++;
      else wrong++;
    } else {
      const g = ans?.integer_answer?.trim();
      if (!g) skip++;
      else if (g === (q.correct_integer_answer ?? '').trim()) correct++;
      else wrong++;
    }
  }
  return { correct, wrong, skip, score: correct * 4 - wrong };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SecureAttemptScreen({ route, navigation }: { route: any; navigation: any }) {
  const {
    examId, title,
    isPractice = false,
    isOffline = false,
    offlineQuestions = null,
  } = route.params;

  // Core
  const [loading, setLoading] = useState(!isOffline);
  const [error, setError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>(offlineQuestions ?? []);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [imgToken, setImgToken] = useState<string | null>(null);

  // Navigation
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [activeQIdx, setActiveQIdx] = useState(0);
  const questionScrollRef = useRef<ScrollView>(null);

  // Security
  const [lockStatus, setLockStatus] = useState<'starting' | 'active' | 'failed' | 'monitoring'>('starting');
  const [isOverlayLocked, setIsOverlayLocked] = useState(false);
  const unpinCountRef = useRef(0);
  const lastViolationMs = useRef(0);
  const attemptIdRef = useRef<number | null>(null);
  attemptIdRef.current = attemptId;

  // Practice
  const [practiceChecks, setPracticeChecks] = useState<Record<number, number>>({});
  const [practiceRevealed, setPracticeRevealed] = useState<Record<number, boolean>>({});

  // ── Derived sections ──────────────────────────────────────────────────────

  const sections: Section[] = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const q of questions) {
      if (!map.has(q.section_code)) map.set(q.section_code, []);
      map.get(q.section_code)!.push(q);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1][0].question_order - b[1][0].question_order)
      .map(([code, qs]) => ({
        code,
        questions: qs.sort((a, b) => a.question_order - b.question_order),
      }));
  }, [questions]);

  const currentSection = sections[activeSectionIdx] ?? { code: '', questions: [] };
  const currentQuestion = currentSection.questions[activeQIdx] ?? null;

  // ── Load exam ─────────────────────────────────────────────────────────────

  // Load auth token for offline/practice mode so question images can render from server
  useEffect(() => {
    if (!isOffline) return;
    setLoading(false);
    SecureStore.getItemAsync(STORAGE_EXAM_TOKEN).then(token => {
      if (token) setImgToken(token);
    }).catch(() => {});
  }, [isOffline]);

  useEffect(() => {
    if (isOffline) return;

    (async () => {
      try {
        setLoading(true);
        const token = await SecureStore.getItemAsync(STORAGE_EXAM_TOKEN);
        setImgToken(token);

        const deviceId = (await AsyncStorage.getItem('@rmc_device_id')) || 'default_device';

        const startResp = await examFetch(`/student/exams/${examId}/start`, {
          method: 'POST',
          body: JSON.stringify({ device_id: deviceId }),
        });
        const { attempt, ends_at } = startResp.result;
        setAttemptId(attempt.id);
        setEndsAt(ends_at);

        const paperResp = await examFetch(`/student/exams/${examId}?device_id=${encodeURIComponent(deviceId)}`);
        setQuestions(paperResp.questions ?? []);

        // Only restore cache if it belongs to this exact attempt (avoids stale marked state).
        const cached = await AsyncStorage.getItem(`@rmc_exam_answers_${examId}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed.attemptId === attempt.id) {
              setAnswers(parsed.answers ?? {});
            } else {
              AsyncStorage.removeItem(`@rmc_exam_answers_${examId}`).catch(() => {});
            }
          } catch {}
        }

        ScreenCapture.preventScreenCaptureAsync();
        if (RmcLockTaskModule) RmcLockTaskModule.startLock();
      } catch (e: any) {
        setError(e.message || 'Failed to start exam.');
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      ScreenCapture.allowScreenCaptureAsync();
      if (RmcLockTaskModule) RmcLockTaskModule.stopLock();
    };
  }, [examId]);

  // ── Auto re-pin ───────────────────────────────────────────────────────────
  // During a live exam, whenever the student comes back to the app we silently
  // re-enter lock-task (re-pin) instead of making them tap "Resume". The 2nd
  // unpin still auto-submits (see recordViolation), so this only ever fires
  // for the 1st strike — re-securing the screen and warning them once.
  const maybeRePin = useCallback((warn: boolean) => {
    if (isOffline || isPractice) return;
    if (unpinCountRef.current >= 2) return; // already auto-submitting
    if (RmcLockTaskModule) { try { RmcLockTaskModule.startLock(); } catch {} }
    setIsOverlayLocked(false);
    if (warn && unpinCountRef.current === 1) {
      Alert.alert(
        '⚠️ Final Warning',
        'You left the exam screen. If you leave the app again, your exam will be submitted automatically.',
      );
    }
  }, [isOffline, isPractice]);

  // ── Violation handler ─────────────────────────────────────────────────────

  const recordViolation = useCallback(async (source: string) => {
    const now = Date.now();
    if (now - lastViolationMs.current < 2000) return;
    lastViolationMs.current = now;

    unpinCountRef.current += 1;
    const count = unpinCountRef.current;

    try {
      await examFetch(`/student/exams/${examId}/violations`, {
        method: 'POST',
        body: JSON.stringify({
          violation_type: 'APP_SWITCH',
          severity: count >= 2 ? 'CRITICAL' : 'WARNING',
          attempt_id: attemptIdRef.current ?? undefined,
          message: `${source} (exit #${count})`,
        }),
      });
    } catch {}

    if (count >= 2) {
      doSubmit(true);
    } else {
      // 1st strike: shield the screen, and if the student is still in the app
      // (unpinned in place) re-pin immediately. If they're backgrounded, the
      // AppState 'active' handler re-pins the moment they return.
      setIsOverlayLocked(true);
      if (AppState.currentState === 'active') maybeRePin(true);
    }
  }, [examId, maybeRePin]);

  // ── Native lock events ────────────────────────────────────────────────────

  useEffect(() => {
    if (!lockEmitter) { setLockStatus('monitoring'); return; }
    const s1 = lockEmitter.addListener('onLockStarted', (e: { success: boolean }) =>
      setLockStatus(e.success ? 'active' : 'failed'));
    const s2 = lockEmitter.addListener('onAppUnpinned', () => recordViolation('Exited lock task'));
    const s3 = lockEmitter.addListener('onFocusLost', async () => {
      try {
        await examFetch(`/student/exams/${examId}/violations`, {
          method: 'POST',
          body: JSON.stringify({ violation_type: 'APP_BACKGROUND', severity: 'WARNING',
            attempt_id: attemptIdRef.current ?? undefined, message: 'Focus lost' }),
        });
      } catch {}
    });
    return () => { s1.remove(); s2.remove(); s3.remove(); };
  }, [recordViolation]);

  // ── AppState fallback ─────────────────────────────────────────────────────

  useEffect(() => {
    if (isOffline || isPractice) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') recordViolation('App backgrounded');
      else if (next === 'active') maybeRePin(true); // returned → auto re-pin
    });
    return () => sub.remove();
  }, [isOffline, isPractice, recordViolation, maybeRePin]);

  // ── Timer ─────────────────────────────────────────────────────────────────

  const handleTimeExpired = useCallback(() => {
    Alert.alert('Time Up!', 'Submitting automatically...');
    doSubmit(true);
  }, []);

  const { formatTime, isUrgent, clearAnswersCache } = useExamTimer({
    examId,
    endsAt: endsAt || new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    onTimeExpired: handleTimeExpired,
  });

  // ── Save answer ───────────────────────────────────────────────────────────

  const saveAnswer = async (
    qId: number,
    optionId?: number,
    intAnswer?: string,
    markedReview?: boolean,
  ) => {
    const prev = answers[qId];
    const newAns: AnswerState = {
      selected_option_id: optionId,
      integer_answer: intAnswer,
      is_marked_for_review: markedReview ?? prev?.is_marked_for_review ?? false,
      save_status: 'PENDING',
    };
    const updated = { ...answers, [qId]: newAns };
    setAnswers(updated);
    AsyncStorage.setItem(`@rmc_exam_answers_${examId}`,
      JSON.stringify({ answers: updated, timestamp: Date.now(), attemptId: attemptIdRef.current })).catch(() => {});

    if (!attemptIdRef.current) return;
    try {
      await examFetch(`/student/attempts/${attemptIdRef.current}/answers`, {
        method: 'PATCH',
        body: JSON.stringify({
          question_id: qId,
          selected_option_id: optionId ?? null,
          integer_answer: intAnswer ?? null,
          is_marked_for_review: markedReview ?? prev?.is_marked_for_review ?? false,
        }),
      });
      setAnswers(a => ({ ...a, [qId]: { ...a[qId], save_status: 'SAVED' } }));
    } catch {
      setAnswers(a => ({ ...a, [qId]: { ...a[qId], save_status: 'FAILED' } }));
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const doSubmit = async (auto: boolean) => {
    if (submitting) return;
    setShowSubmitDialog(false);

    if (isOffline) {
      const { correct, wrong, skip, score } = computeLocalScore(questions, answers);
      // Navigate to review screen with the practice data so student can see images + correct answers
      const practiceAnswers: Record<number, { selected_option_id?: number | null; integer_answer?: string | null }> = {};
      for (const [qId, ans] of Object.entries(answers)) {
        practiceAnswers[Number(qId)] = { selected_option_id: ans.selected_option_id, integer_answer: ans.integer_answer };
      }
      navigation.replace('StudentResultReview', {
        title: `Review: ${title}`,
        practiceQuestions: questions,
        practiceAnswers,
        practiceScore: { correct, wrong, skip, score, total: questions.length },
      });
      return;
    }

    if (!attemptIdRef.current) return;
    setSubmitting(true);
    try {
      await examFetch(`/student/attempts/${attemptIdRef.current}/submit`, { method: 'POST' });
      await clearAnswersCache();
      if (RmcLockTaskModule) RmcLockTaskModule.stopLock();
      await saveAttemptMeta({
        attemptId: attemptIdRef.current!,
        examId, title,
        submittedAt: new Date().toISOString(),
        resultStatus: 'pending',
      });
      Alert.alert(
        auto ? 'Auto-Submitted' : 'Submitted!',
        auto
          ? 'Exam was auto-submitted due to a security violation.'
          : 'Your answers have been recorded. Check "My Results" when results are released.',
        [{ text: 'OK', onPress: () => navigation.popToTop() }],
      );
    } catch (e: any) {
      Alert.alert('Submission Error', e.message || 'Failed to submit. Please retry.');
      setSubmitting(false);
    }
  };

  const handleResumeLock = () => {
    setIsOverlayLocked(false);
    if (RmcLockTaskModule) RmcLockTaskModule.startLock();
  };

  // ── Navigation ────────────────────────────────────────────────────────────

  const goToQuestion = (sIdx: number, qIdx: number) => {
    setActiveSectionIdx(sIdx);
    setActiveQIdx(qIdx);
    questionScrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const goPrev = () => {
    if (activeQIdx > 0) goToQuestion(activeSectionIdx, activeQIdx - 1);
    else if (activeSectionIdx > 0) {
      const prev = sections[activeSectionIdx - 1];
      goToQuestion(activeSectionIdx - 1, prev.questions.length - 1);
    }
  };

  const goNext = () => {
    if (activeQIdx < currentSection.questions.length - 1) goToQuestion(activeSectionIdx, activeQIdx + 1);
    else if (activeSectionIdx < sections.length - 1) goToQuestion(activeSectionIdx + 1, 0);
  };

  const toggleMark = () => {
    if (!currentQuestion) return;
    const prev = answers[currentQuestion.id];
    saveAnswer(currentQuestion.id, prev?.selected_option_id, prev?.integer_answer, !prev?.is_marked_for_review);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────

  const globalStats = sectionStats(questions, answers);
  const totalAnswered = globalStats.answered + globalStats.answeredMarked;

  // ── States: loading / error ───────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.loadScreen}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.loadCard}>
          <ActivityIndicator size="large" color={T.primary} />
          <Text style={s.loadTitle}>Setting up secure environment</Text>
          <Text style={s.loadSub}>Please wait…</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.loadScreen}>
        <StatusBar barStyle="dark-content" backgroundColor={PAGE_BG} />
        <View style={s.loadCard}>
          <Text style={s.errorTitle}>Unable to Load Exam</Text>
          <Text style={s.errorBody}>{error}</Text>
          <TouchableOpacity style={s.errorBtn} onPress={() => navigation.goBack()}>
            <Text style={s.errorBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const imgBase = getExamBaseUrl().replace(/\/api$/, '');
  const curAns = currentQuestion ? answers[currentQuestion.id] : undefined;
  const isMarked = curAns?.is_marked_for_review ?? false;
  const saveStatus = curAns?.save_status;
  const isFirst = activeSectionIdx === 0 && activeQIdx === 0;
  const isLast = activeSectionIdx === sections.length - 1 &&
    activeQIdx === currentSection.questions.length - 1;
  const qNumInSection = activeQIdx + 1;
  const totalInSection = currentSection.questions.length;
  const progressFraction = questions.length > 0 ? totalAnswered / questions.length : 0;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={T.primary} />

      {/* ── Security overlay ─────────────────────────────────────────── */}
      {isOverlayLocked && (
        <View style={s.secOverlay}>
          <Text style={s.secIcon}>⚠</Text>
          <Text style={s.secTitle}>SECURITY ALERT</Text>
          <Text style={s.secMsg}>
            You exited the examination app. This violation has been recorded.
          </Text>
          <Text style={s.secWarn}>
            A second exit will auto-submit your exam immediately with no exceptions.
          </Text>
          <TouchableOpacity style={s.secBtn} onPress={handleResumeLock}>
            <Text style={s.secBtnText}>Return to Exam</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 1. Exam header ───────────────────────────────────────────── */}
      <View style={s.header}>
        {/* top row: title + timer + submit */}
        <View style={s.headerTop}>
          <View style={s.headerTitleWrap}>
            <Text style={s.headerLabel}>RMC SECURE TEST</Text>
            <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
          </View>
          <View style={s.headerRight}>
            {lockStatus !== 'starting' && (
              <View style={[s.lockPip, lockStatus === 'active' ? s.lockPipOk : s.lockPipWarn]} />
            )}
            <View style={[s.timerBox, isUrgent && s.timerBoxUrgent]}>
              <Text style={s.timerLabel}>TIME LEFT</Text>
              <Text style={[s.timerValue, isUrgent && s.timerValueUrgent]}>{formatTime()}</Text>
            </View>
          </View>
        </View>

        {/* progress row */}
        <View style={s.headerProgress}>
          <View style={s.progressBarTrack}>
            <View style={[s.progressBarFill, { width: `${Math.round(progressFraction * 100)}%` as any }]} />
          </View>
          <View style={s.progressMeta}>
            <Text style={s.progressText}>
              {totalAnswered}/{questions.length} answered
              {saveStatus === 'FAILED' ? '  ⚠ not synced' : saveStatus === 'SAVED' ? '  ✓ saved' : ''}
            </Text>
            <TouchableOpacity
              style={[s.submitBtn, submitting && { opacity: 0.5 }]}
              disabled={submitting}
              onPress={() => isOffline ? doSubmit(false) : setShowSubmitDialog(true)}
            >
              <Text style={s.submitBtnText}>{submitting ? 'Submitting…' : isOffline ? 'Finish Practice' : 'Submit Exam'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── 2. Section tabs (pill style, RMC-matched) ─────────────────── */}
      {sections.length > 1 && (
        <View style={s.sectionBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sectionScroll}>
            {sections.map((sec, idx) => {
              const active = idx === activeSectionIdx;
              const st = sectionStats(sec.questions, answers);
              const pct = sec.questions.length > 0
                ? Math.round((st.answered + st.answeredMarked) / sec.questions.length * 100)
                : 0;
              return (
                <TouchableOpacity
                  key={sec.code}
                  style={[s.secPill, active && s.secPillActive]}
                  onPress={() => goToQuestion(idx, 0)}
                >
                  <Text style={[s.secPillText, active && s.secPillTextActive]}>{sec.code}</Text>
                  <View style={[s.secPillBadge, active && s.secPillBadgeActive]}>
                    <Text style={[s.secPillBadgeText, active && s.secPillBadgeTextActive]}>
                      {pct}%
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* ── 3. Question palette (NTA-style) ──────────────────────────── */}
      <View style={s.palette}>
        <View style={s.paletteHeader}>
          <Text style={s.paletteLabel}>
            Question Palette — {currentSection.code}
          </Text>
          <Text style={s.paletteCount}>
            Q {qNumInSection}/{totalInSection}
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.paletteBubbles}>
          {currentSection.questions.map((q, idx) => {
            const ans = answers[q.id];
            const a = answered(ans);
            const m = ans?.is_marked_for_review ?? false;
            const cur = idx === activeQIdx;
            // NTA color scheme
            let bg: string, border: string, txt: string;
            if (cur)       { bg = '#1D4ED8'; border = '#1D4ED8'; txt = '#fff'; }
            else if (a&&m) { bg = '#EA580C'; border = '#EA580C'; txt = '#fff'; }
            else if (a)    { bg = '#16A34A'; border = '#16A34A'; txt = '#fff'; }
            else if (m)    { bg = '#7C3AED'; border = '#7C3AED'; txt = '#fff'; }
            else           { bg = '#fff';    border = '#C4CEC8'; txt = '#6B7280'; }
            return (
              <TouchableOpacity
                key={q.id}
                style={[s.bubble, { backgroundColor: bg, borderColor: border },
                  cur && s.bubbleCurrent]}
                onPress={() => goToQuestion(activeSectionIdx, idx)}
              >
                <Text style={[s.bubbleText, { color: txt }]}>{idx + 1}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* NTA legend */}
        <View style={s.legend}>
          {([
            ['#1D4ED8', 'Current'],
            ['#16A34A', 'Answered'],
            ['#7C3AED', 'Review'],
            ['#EA580C', 'Ans+Rev'],
          ] as [string, string][]).map(([c, l]) => (
            <View key={l} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: c }]} />
              <Text style={s.legendLabel}>{l}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 4. Question card ─────────────────────────────────────────── */}
      <ScrollView
        ref={questionScrollRef}
        style={s.qScroll}
        contentContainerStyle={s.qContent}
        keyboardShouldPersistTaps="handled"
      >
        {currentQuestion ? (
          <>
            {/* Question meta strip */}
            <View style={s.qMeta}>
              <View style={s.qMetaLeft}>
                <Text style={s.qMetaNum}>Question {currentQuestion.question_order}</Text>
                <View style={s.divider} />
                <View style={s.qMetaChip}><Text style={s.qMetaChipText}>{currentSection.code}</Text></View>
                <View style={[s.qMetaChip, s.qMetaChipType]}>
                  <Text style={[s.qMetaChipText, s.qMetaChipTypeText]}>
                    {currentQuestion.question_type === 'MCQ' ? 'Single Choice' : 'Integer Type'}
                  </Text>
                </View>
              </View>
              {isMarked && (
                <View style={s.markedPill}><Text style={s.markedPillText}>🚩 Marked</Text></View>
              )}
            </View>

            {/* Question body card */}
            <View style={s.qCard}>

              {/* Images — responsive width + double-tap to zoom full-screen */}
              {(currentQuestion.question_media?.length ?? 0) > 0 && (
                <View style={s.imgRow}>
                  {currentQuestion.question_media.map((m, i) => (
                    <View key={i} style={i > 0 ? { marginTop: 10 } : undefined}>
                      <ZoomableImage uri={m.local_uri ?? `${imgBase}${m.access_url}`} token={imgToken} />
                    </View>
                  ))}
                </View>
              )}

              {/* Question text */}
              {!!currentQuestion.question_text && (
                <Text style={s.qText}>{currentQuestion.question_text}</Text>
              )}

              {(!currentQuestion.question_text && (currentQuestion.question_media?.length ?? 0) === 0) && (
                <Text style={s.qTextMuted}>Question content not available.</Text>
              )}

              {/* MCQ options */}
              {currentQuestion.question_type === 'MCQ' && (
                <View style={s.optionsWrap}>
                  {(currentQuestion.question_options ?? []).map((opt, oi) => {
                    const sel = curAns?.selected_option_id === opt.id;
                    const revealed = practiceRevealed[currentQuestion.id];
                    const correct = isPractice && revealed && !!opt.is_correct;
                    const labelColors = ['#1D4ED8', '#7C3AED', '#EA580C', '#15803D'];
                    const defaultLabelBg = labelColors[oi % labelColors.length];
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        style={[
                          s.optRow,
                          sel && s.optRowSel,
                          correct && s.optRowCorrect,
                        ]}
                        onPress={() => saveAnswer(currentQuestion.id, sel ? undefined : opt.id, undefined)}
                        activeOpacity={0.7}
                      >
                        <View style={[
                          s.optBadge,
                          { backgroundColor: sel || correct ? (correct ? '#15803D' : T.primary) : defaultLabelBg },
                        ]}>
                          <Text style={s.optBadgeText}>{opt.option_label}</Text>
                        </View>
                        <Text style={[s.optText, sel && s.optTextSel]} numberOfLines={6}>
                          {opt.option_text ?? ''}
                        </Text>
                        {sel && !correct && (
                          <View style={s.selIndicator} />
                        )}
                        {correct && <Text style={s.correctMark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Integer input */}
              {currentQuestion.question_type === 'INTEGER' && (
                <View style={s.intWrap}>
                  <Text style={s.intLabel}>YOUR ANSWER</Text>
                  <TextInput
                    style={s.intInput}
                    keyboardType="numeric"
                    placeholder="Type integer (e.g. −42, 0, 100)"
                    placeholderTextColor={T.textMuted}
                    value={curAns?.integer_answer ?? ''}
                    onChangeText={val => saveAnswer(currentQuestion.id, undefined, val)}
                  />
                  <Text style={s.intHint}>Only integers allowed. Negative values are valid.</Text>
                </View>
              )}

              {/* Practice reveal */}
              {isPractice && (
                <View style={s.practiceWrap}>
                  {!practiceRevealed[currentQuestion.id] ? (
                    <TouchableOpacity
                      style={s.checkBtn}
                      onPress={() => {
                        const cnt = (practiceChecks[currentQuestion.id] ?? 0) + 1;
                        setPracticeChecks(c => ({ ...c, [currentQuestion.id]: cnt }));
                        if (cnt >= 3) setPracticeRevealed(r => ({ ...r, [currentQuestion.id]: true }));
                      }}
                    >
                      <Text style={s.checkBtnText}>
                        Check Answer  ({practiceChecks[currentQuestion.id] ?? 0}/3)
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={s.revealCard}>
                      <Text style={s.revealTitle}>Correct Answer</Text>
                      {currentQuestion.question_type === 'MCQ' ? (() => {
                        const correct = currentQuestion.question_options.find(o => o.is_correct);
                        return (
                          <Text style={s.revealAnswer}>
                            ({correct?.option_label ?? '?'})  {correct?.option_text ?? ''}
                          </Text>
                        );
                      })() : (
                        <Text style={s.revealAnswer}>{currentQuestion.correct_integer_answer}</Text>
                      )}
                    </View>
                  )}
                </View>
              )}

            </View>
          </>
        ) : (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>No questions available in this section.</Text>
          </View>
        )}
      </ScrollView>

      {/* ── 5. Bottom action bar ─────────────────────────────────────── */}
      <View style={s.bottomBar}>
        <TouchableOpacity
          style={[s.bbPrev, isFirst && s.bbDim]}
          disabled={isFirst}
          onPress={goPrev}
        >
          <Text style={s.bbPrevText}>◀  Previous</Text>
        </TouchableOpacity>

        {isPractice ? (
          <TouchableOpacity style={s.bbMark} onPress={() => doSubmit(false)}>
            <Text style={s.bbMarkText}>View Score</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.bbMark, isMarked && s.bbMarkActive]}
            onPress={toggleMark}
          >
            <Text style={[s.bbMarkText, isMarked && s.bbMarkTextActive]}>
              {isMarked ? '🚩  Unmark' : '🏳  Mark Review'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[s.bbNext, isLast && s.bbDim]}
          disabled={isLast}
          onPress={goNext}
        >
          <Text style={s.bbNextText}>Next  ▶</Text>
        </TouchableOpacity>
      </View>

      {/* ── Submit confirmation dialog ────────────────────────────────── */}
      <Modal visible={showSubmitDialog} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Submit Examination</Text>
              <TouchableOpacity onPress={() => setShowSubmitDialog(false)}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.modalSub}>Please review your progress before submitting. This action cannot be undone.</Text>

            {/* Stats grid */}
            <View style={s.statGrid}>
              <StatBox value={questions.length} label="Total" color="#374151" />
              <StatBox value={globalStats.answered + globalStats.answeredMarked} label="Answered" color="#16A34A" />
              <StatBox value={globalStats.unanswered} label="Unanswered" color="#DC2626" />
              <StatBox value={globalStats.marked + globalStats.answeredMarked} label="Marked" color="#7C3AED" />
            </View>

            {/* Per-section breakdown */}
            <Text style={s.breakdownHeading}>Section Summary</Text>
            <View style={s.breakdownBox}>
              {sections.map((sec, si) => {
                const st = sectionStats(sec.questions, answers);
                const pct = sec.questions.length > 0
                  ? Math.round((st.answered + st.answeredMarked) / sec.questions.length * 100)
                  : 0;
                return (
                  <View key={sec.code} style={[s.breakdownRow, si < sections.length - 1 && s.breakdownRowBorder]}>
                    <Text style={s.breakdownSec}>{sec.code}</Text>
                    <Text style={s.breakdownVal}>
                      {st.answered + st.answeredMarked}/{sec.questions.length}
                    </Text>
                    <View style={s.breakdownBarTrack}>
                      <View style={[s.breakdownBarFill, { width: `${pct}%` as any, backgroundColor: pct === 100 ? '#16A34A' : T.primary }]} />
                    </View>
                    <Text style={s.breakdownPct}>{pct}%</Text>
                  </View>
                );
              })}
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowSubmitDialog(false)}>
                <Text style={s.modalCancelText}>Go Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalConfirm, submitting && { opacity: 0.5 }]}
                disabled={submitting}
                onPress={() => doSubmit(false)}
              >
                <Text style={s.modalConfirmText}>{submitting ? 'Submitting…' : 'Confirm & Submit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function StatBox({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_BG = '#D9EDE2';   // sage green background, matching RMC mobile

// ── Styles ────────────────────────────────────────────────────────────────────

// Width-based font scaling so exam content (question, options, answers) grows on
// larger devices instead of staying fixed. Portrait-locked exam → module-level
// Dimensions is fine. Clamped so phones stay normal and tablets don't balloon.
const SCREEN_W = Dimensions.get('window').width;
const FS = Math.min(Math.max(SCREEN_W / 390, 0.95), 1.4);
const f = (n: number) => Math.round(n * FS);

const s = StyleSheet.create({

  // ── Root / Loading / Error ─────────────────────────────────────────
  root:       { flex: 1, backgroundColor: PAGE_BG },
  loadScreen: { flex: 1, backgroundColor: PAGE_BG, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadCard:   { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', width: '100%', elevation: 4, shadowColor: '#0C4E36', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12 },
  loadTitle:  { fontSize: 17, fontWeight: '700', color: T.textPrimary, marginTop: 18, marginBottom: 6 },
  loadSub:    { fontSize: 13, color: T.textMuted },
  errorTitle: { fontSize: 20, fontWeight: '800', color: T.danger, marginBottom: 10, textAlign: 'center' },
  errorBody:  { fontSize: 14, color: T.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  errorBtn:   { backgroundColor: T.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 100 },
  errorBtnText:{ color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── Security overlay ───────────────────────────────────────────────
  secOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#02080A', zIndex: 9999, justifyContent: 'center', alignItems: 'center', padding: 32 },
  secIcon:    { fontSize: 64, marginBottom: 12 },
  secTitle:   { fontSize: 22, fontWeight: '900', color: '#EF4444', letterSpacing: 1.5, marginBottom: 20, textAlign: 'center' },
  secMsg:     { fontSize: 15, color: '#CBD5E1', textAlign: 'center', lineHeight: 26, marginBottom: 16 },
  secWarn:    { fontSize: 13, color: '#FCD34D', fontWeight: '700', textAlign: 'center', lineHeight: 20, marginBottom: 44, paddingHorizontal: 8 },
  secBtn:     { backgroundColor: T.primary, paddingVertical: 17, paddingHorizontal: 44, borderRadius: 100 },
  secBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  // ── Exam header ────────────────────────────────────────────────────
  header: {
    backgroundColor: T.primary,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  headerTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  headerTitleWrap: { flex: 1, marginRight: 12 },
  headerLabel:     { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 3 },
  headerTitle:     { fontSize: 16, fontWeight: '800', color: '#fff', lineHeight: 22 },
  headerRight:     { alignItems: 'flex-end', gap: 6 },
  lockPip:         { width: 7, height: 7, borderRadius: 4, alignSelf: 'flex-end' },
  lockPipOk:       { backgroundColor: '#4ADE80' },
  lockPipWarn:     { backgroundColor: '#FCD34D' },
  timerBox:        { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', minWidth: 88 },
  timerBoxUrgent:  { backgroundColor: '#DC2626' },
  timerLabel:      { fontSize: 8, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 1 },
  timerValue:      { fontSize: 18, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'], letterSpacing: 1 },
  timerValueUrgent:{ color: '#FEF08A' },
  headerProgress:  {},
  progressBarTrack:{ height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, marginBottom: 8, overflow: 'hidden' },
  progressBarFill: { height: 4, backgroundColor: '#4ADE80', borderRadius: 2 },
  progressMeta:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressText:    { fontSize: 11, color: 'rgba(255,255,255,0.72)', fontWeight: '500' },
  submitBtn:       { backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 100 },
  submitBtnText:   { color: T.primary, fontWeight: '800', fontSize: 12, letterSpacing: 0.2 },

  // ── Section pills ──────────────────────────────────────────────────
  sectionBar:    { backgroundColor: PAGE_BG, paddingVertical: 10 },
  sectionScroll: { paddingHorizontal: 14, gap: 8 },
  secPill:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 100, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1.5, borderColor: '#C8DBCE' },
  secPillActive: { backgroundColor: T.primary, borderColor: T.primary },
  secPillText:   { fontSize: 12, fontWeight: '800', color: T.textSecondary, letterSpacing: 0.5 },
  secPillTextActive: { color: '#fff' },
  secPillBadge:  { backgroundColor: '#E8F2EC', borderRadius: 100, paddingHorizontal: 6, paddingVertical: 1 },
  secPillBadgeActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  secPillBadgeText: { fontSize: 10, fontWeight: '700', color: T.primary },
  secPillBadgeTextActive: { color: '#fff' },

  // ── Question palette ───────────────────────────────────────────────
  palette:        { backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 14, marginBottom: 10, paddingBottom: 10, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  paletteHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  paletteLabel:   { fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  paletteCount:   { fontSize: 12, fontWeight: '800', color: T.primary },
  paletteBubbles: { paddingHorizontal: 12, gap: 6 },
  bubble:         { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
  bubbleCurrent:  { borderWidth: 2.5, elevation: 3, shadowColor: '#1D4ED8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
  bubbleText:     { fontSize: 11, fontWeight: '800' },
  legend:         { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 8, gap: 14 },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:      { width: 9, height: 9, borderRadius: 5 },
  legendLabel:    { fontSize: 10, color: T.textMuted, fontWeight: '500' },

  // ── Question scroll area ───────────────────────────────────────────
  qScroll:   { flex: 1 },
  qContent:  { paddingHorizontal: 12, paddingBottom: 24 },
  emptyState:{ padding: 40, alignItems: 'center' },
  emptyText: { color: T.textMuted, fontSize: 15 },

  // Question meta strip
  qMeta:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  qMetaLeft:   { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  qMetaNum:    { fontSize: f(13), fontWeight: '800', color: T.textPrimary },
  divider:     { width: 1, height: 14, backgroundColor: '#CBD5DB' },
  qMetaChip:   { backgroundColor: T.primaryLight, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 100 },
  qMetaChipText: { fontSize: 10, fontWeight: '800', color: T.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  qMetaChipType: { backgroundColor: '#EDE9FE' },
  qMetaChipTypeText: { color: '#6D28D9' },
  markedPill:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#FCD34D' },
  markedPillText: { fontSize: 11, fontWeight: '700', color: '#92400E' },

  // Question card
  qCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    elevation: 2,
    shadowColor: '#0C3D26',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },

  // Images
  imgRow: { marginBottom: 16 },
  qImg:   { width: 300, height: 190, borderRadius: 12, marginRight: 10, backgroundColor: '#F0F5F2' },

  // Question text
  qText:     { fontSize: f(16), color: T.textPrimary, lineHeight: f(28), marginBottom: 20, fontWeight: '500' },
  qTextMuted:{ fontSize: f(14), color: T.textMuted, lineHeight: f(22), marginBottom: 16, fontStyle: 'italic' },

  // MCQ options
  optionsWrap: { gap: 10, marginTop: 4 },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAF9',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DDE8E2',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 14,
    minHeight: 56,
  },
  optRowSel:     { backgroundColor: '#EAF6F0', borderColor: T.primary, borderWidth: 2 },
  optRowCorrect: { backgroundColor: '#DCFCE7', borderColor: '#16A34A', borderWidth: 2 },
  optBadge: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  optBadgeText:  { fontSize: f(14), fontWeight: '900', color: '#fff' },
  optText:       { flex: 1, fontSize: f(15), color: T.textPrimary, lineHeight: f(22) },
  optTextSel:    { color: T.primary, fontWeight: '600' },
  selIndicator:  { width: 8, height: 8, borderRadius: 4, backgroundColor: T.primary, flexShrink: 0 },
  correctMark:   { fontSize: 20, color: '#16A34A', fontWeight: '900', flexShrink: 0 },

  // Integer input
  intWrap:  { marginTop: 8 },
  intLabel: { fontSize: 10, fontWeight: '800', color: T.primary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 },
  intInput: {
    borderWidth: 2, borderColor: '#C8DDD4', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    fontSize: f(22), fontWeight: '700', color: T.textPrimary,
    backgroundColor: '#F8FAF9', textAlign: 'center',
  },
  intHint: { fontSize: 11, color: T.textMuted, marginTop: 8, textAlign: 'center' },

  // Practice
  practiceWrap: { marginTop: 20, borderTopWidth: 1, borderTopColor: '#E5EDE9', paddingTop: 16 },
  checkBtn:     { backgroundColor: T.primary, borderRadius: 100, paddingVertical: 14, alignItems: 'center' },
  checkBtnText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  revealCard:   { backgroundColor: '#DCFCE7', borderRadius: 12, borderWidth: 1.5, borderColor: '#16A34A', padding: 16 },
  revealTitle:  { fontSize: 12, fontWeight: '800', color: '#15803D', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  revealAnswer: { fontSize: f(16), color: T.textPrimary, lineHeight: f(24), fontWeight: '600' },

  // ── Bottom action bar ──────────────────────────────────────────────
  bottomBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#E0EAE4',
    gap: 8,
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 6,
  },
  bbPrev: {
    flex: 1, paddingVertical: 13,
    backgroundColor: '#F0F5F2', borderRadius: 100,
    borderWidth: 1.5, borderColor: '#C8D8CE',
    alignItems: 'center',
  },
  bbPrevText: { fontSize: 13, fontWeight: '700', color: T.textSecondary },
  bbMark: {
    flex: 1.4, paddingVertical: 13,
    backgroundColor: '#F0F5F2', borderRadius: 100,
    borderWidth: 1.5, borderColor: '#C8D8CE',
    alignItems: 'center',
  },
  bbMarkActive:     { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  bbMarkText:       { fontSize: 13, fontWeight: '700', color: T.textSecondary },
  bbMarkTextActive: { color: '#92400E' },
  bbNext: {
    flex: 1, paddingVertical: 13,
    backgroundColor: T.primary, borderRadius: 100,
    alignItems: 'center',
    elevation: 3, shadowColor: T.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
  },
  bbNextText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  bbDim:      { opacity: 0.32 },

  // ── Submit modal ───────────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(5,18,10,0.6)', justifyContent: 'flex-end' },
  modalCard:    { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 32 },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle:   { fontSize: 20, fontWeight: '900', color: T.textPrimary },
  modalClose:   { fontSize: 18, color: T.textMuted, padding: 4 },
  modalSub:     { fontSize: 13, color: T.textSecondary, lineHeight: 20, marginBottom: 20 },

  statGrid:  { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#F4FBF7', borderRadius: 14, paddingVertical: 16, marginBottom: 20 },
  statBox:   { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 28, fontWeight: '900', marginBottom: 3 },
  statLabel: { fontSize: 10, color: T.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },

  breakdownHeading: { fontSize: 12, fontWeight: '800', color: T.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  breakdownBox:     { backgroundColor: '#F8FAF9', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 20 },
  breakdownRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  breakdownRowBorder:{ borderBottomWidth: 1, borderBottomColor: '#EAF0EC' },
  breakdownSec:     { fontSize: 12, fontWeight: '800', color: T.textPrimary, width: 80 },
  breakdownVal:     { fontSize: 12, color: T.textSecondary, width: 40, textAlign: 'right' },
  breakdownBarTrack:{ flex: 1, height: 6, backgroundColor: '#E0EAE4', borderRadius: 3, overflow: 'hidden' },
  breakdownBarFill: { height: 6, borderRadius: 3 },
  breakdownPct:     { fontSize: 11, fontWeight: '700', color: T.textMuted, width: 34, textAlign: 'right' },

  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancel:  { flex: 1, backgroundColor: '#F0F5F2', paddingVertical: 15, borderRadius: 100, alignItems: 'center', borderWidth: 1.5, borderColor: '#C8D8CE' },
  modalCancelText: { color: T.textSecondary, fontWeight: '700', fontSize: 15 },
  modalConfirm: { flex: 1.4, backgroundColor: '#DC2626', paddingVertical: 15, borderRadius: 100, alignItems: 'center', elevation: 2 },
  modalConfirmText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
