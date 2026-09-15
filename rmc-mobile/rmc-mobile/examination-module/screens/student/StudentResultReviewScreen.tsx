import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getExamBaseUrl, STORAGE_EXAM_TOKEN } from '../../services/api';
import { ZoomableImage } from '../../components/ZoomableImage';

// ── Shared display shape ───────────────────────────────────────────────────────

interface MediaItem {
  id: number;
  access_url: string;
  local_uri?: string;
}

interface DisplayOption {
  id: number;
  option_label: string;
  option_text: string;
}

interface DisplayQuestion {
  id: number;
  section_code: string;
  question_type: 'MCQ' | 'INTEGER';
  question_text: string | null;
  question_media: MediaItem[];
  solution_media: MediaItem[];
  options: DisplayOption[];
  student_selected_label: string | null;
  correct_option_label: string | null;
  student_integer: string | null;
  correct_integer: string | null;
  status: 'CORRECT' | 'WRONG' | 'UNATTEMPTED';
}

// ── Server review shape (from rev.review.sections[].questions) ─────────────────

interface ServerQuestion {
  version_question_id: number;
  section_code: string;
  question_type: 'MCQ' | 'INTEGER';
  question_text: string | null;
  question_media?: MediaItem[];
  options?: Array<{ version_option_id: number; option_label: string; option_text: string }>;
  student_answer?: { selected_option_label: string | null; selected_option_id: number | null; integer_answer: string | null } | null;
  correct_answer?: { correct_option_label: string | null; correct_integer_answer: string | null } | null;
  status?: 'CORRECT' | 'WRONG' | 'UNATTEMPTED';
  solution?: { solution_media: MediaItem[] } | null;
}

// ── Practice question shape (from startStudentPracticeSession) ─────────────────

interface PracticeOption {
  id: number;
  option_label: string;
  option_text: string;
  is_correct?: boolean;
}

interface PracticeQuestion {
  id: number;
  section_code: string;
  question_type: 'MCQ' | 'INTEGER';
  question_text: string | null;
  question_media?: MediaItem[];
  solution_media?: MediaItem[];
  question_options?: PracticeOption[];
  options?: PracticeOption[];
  correct_integer_answer?: string | null;
}

type PracticeAnswers = Record<number, { selected_option_id?: number | null; integer_answer?: string | null }>;

interface PracticeScore {
  correct: number;
  wrong: number;
  skip: number;
  score: number;
  total: number;
}

// ── Cache ──────────────────────────────────────────────────────────────────────

interface ReviewCache {
  questions: ServerQuestion[];
  cachedAt: number;
}

// ── Converters ─────────────────────────────────────────────────────────────────

function fromServerQuestion(q: ServerQuestion): DisplayQuestion {
  return {
    id: q.version_question_id,
    section_code: q.section_code,
    question_type: q.question_type,
    question_text: q.question_text ?? null,
    question_media: q.question_media ?? [],
    solution_media: q.solution?.solution_media ?? [],
    options: (q.options ?? []).map(o => ({
      id: o.version_option_id,
      option_label: o.option_label,
      option_text: o.option_text,
    })),
    student_selected_label: q.student_answer?.selected_option_label ?? null,
    correct_option_label: q.correct_answer?.correct_option_label ?? null,
    student_integer: q.student_answer?.integer_answer ?? null,
    correct_integer: q.correct_answer?.correct_integer_answer ?? null,
    status: q.status ?? 'UNATTEMPTED',
  };
}

function fromPracticeQuestion(q: PracticeQuestion, answers: PracticeAnswers): DisplayQuestion {
  const opts = q.question_options ?? q.options ?? [];
  const ans = answers[q.id];
  const chosenOpt = opts.find(o => o.id === ans?.selected_option_id) ?? null;
  const correctOpt = opts.find(o => o.is_correct) ?? null;
  const studentLabel = chosenOpt?.option_label ?? null;
  const correctLabel = correctOpt?.option_label ?? null;

  let status: 'CORRECT' | 'WRONG' | 'UNATTEMPTED';
  if (q.question_type === 'MCQ') {
    if (!studentLabel) status = 'UNATTEMPTED';
    else if (studentLabel === correctLabel) status = 'CORRECT';
    else status = 'WRONG';
  } else {
    const studentInt = ans?.integer_answer?.trim() ?? null;
    const correctInt = q.correct_integer_answer?.trim() ?? null;
    if (!studentInt) status = 'UNATTEMPTED';
    else if (studentInt === correctInt) status = 'CORRECT';
    else status = 'WRONG';
  }

  return {
    id: q.id,
    section_code: q.section_code,
    question_type: q.question_type,
    question_text: q.question_text ?? null,
    question_media: q.question_media ?? [],
    solution_media: q.solution_media ?? [],
    options: opts.map(o => ({ id: o.id, option_label: o.option_label, option_text: o.option_text })),
    student_selected_label: studentLabel,
    correct_option_label: correctLabel,
    student_integer: ans?.integer_answer?.trim() ?? null,
    correct_integer: q.correct_integer_answer ?? null,
    status,
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StudentResultReviewScreen({ route, navigation }: { route: any; navigation: any }) {
  const {
    attemptId,
    title,
    practiceQuestions,
    practiceAnswers,
    practiceScore,
  } = route.params as {
    attemptId?: number;
    title: string;
    practiceQuestions?: PracticeQuestion[];
    practiceAnswers?: PracticeAnswers;
    practiceScore?: PracticeScore;
  };

  const isPracticeReview = !!practiceQuestions;

  const [questions, setQuestions] = useState<DisplayQuestion[]>([]);
  const [loading, setLoading] = useState(!isPracticeReview);
  const [activeSection, setActiveSection] = useState<string>('');
  const [imgToken, setImgToken] = useState<string | null>(null);
  const imgBase = getExamBaseUrl().replace(/\/api$/, '');

  // Load auth token for image rendering
  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_EXAM_TOKEN).then(t => {
      if (t) setImgToken(t);
    }).catch(() => {});
  }, []);

  // Load server-cached review or convert practice questions
  useEffect(() => {
    if (isPracticeReview) {
      const converted = (practiceQuestions ?? []).map(q =>
        fromPracticeQuestion(q, practiceAnswers ?? {})
      );
      setQuestions(converted);
      if (converted.length > 0) setActiveSection(converted[0].section_code);
      return;
    }

    (async () => {
      try {
        if (!attemptId) return;
        const raw = await AsyncStorage.getItem(`@rmc_review_${attemptId}`);
        if (raw) {
          const cache: ReviewCache = JSON.parse(raw);
          const converted = (cache.questions ?? []).map(fromServerQuestion);
          setQuestions(converted);
          if (converted.length > 0) setActiveSection(converted[0].section_code);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [attemptId, isPracticeReview]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (!questions.length) {
    return (
      <View style={styles.centered}>
        <Text style={styles.expiredIcon}>⏳</Text>
        <Text style={styles.expiredTitle}>Review Not Available</Text>
        <Text style={styles.expiredBody}>
          {isPracticeReview
            ? 'No questions found for this practice session.'
            : 'The server-side review data has expired or is not yet available.\n\nYou can still practice this exam from the Practice Papers tab.'}
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sections = [...new Set(questions.map(q => q.section_code))];
  const sectionQuestions = questions.filter(q => q.section_code === activeSection);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>

      {/* Practice score banner */}
      {isPracticeReview && practiceScore && (
        <View style={styles.scoreBanner}>
          <Text style={styles.scoreBannerText}>
            Score: {practiceScore.score}/{practiceScore.total * 4}
            {'  '}✓ {practiceScore.correct}{'  '}✗ {practiceScore.wrong}{'  '}— {practiceScore.skip}
          </Text>
        </View>
      )}

      {!isPracticeReview && (
        <Text style={styles.cacheNote}>Cached locally — available offline</Text>
      )}

      {/* Section tabs */}
      <View style={styles.sectionBar}>
        {sections.map(sec => (
          <TouchableOpacity
            key={sec}
            style={[styles.secTab, activeSection === sec && styles.secTabActive]}
            onPress={() => setActiveSection(sec)}
          >
            <Text style={[styles.secTabText, activeSection === sec && styles.secTabTextActive]}>
              {sec}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {sectionQuestions.map((q, idx) => {
          const isCorrect = q.status === 'CORRECT';
          const isUnattempted = q.status === 'UNATTEMPTED';
          const cardBorder = isUnattempted ? '#F59E0B' : isCorrect ? '#10B981' : '#EF4444';

          return (
            <View key={q.id} style={[styles.qCard, { borderLeftColor: cardBorder }]}>
              <View style={styles.qMeta}>
                <Text style={styles.qNum}>Q{idx + 1} · {q.question_type}</Text>
                <Text style={[
                  styles.verdict,
                  isUnattempted ? styles.verdictSkip : isCorrect ? styles.verdictRight : styles.verdictWrong,
                ]}>
                  {isUnattempted ? 'SKIPPED' : isCorrect ? 'CORRECT' : 'WRONG'}
                </Text>
              </View>

              {/* Question images — responsive + double-tap to zoom */}
              {q.question_media.length > 0 && (
                <View style={styles.imgRow}>
                  {q.question_media.map((m, i) => (
                    <View key={i} style={i > 0 ? { marginTop: 10 } : undefined}>
                      <ZoomableImage uri={m.local_uri ?? `${imgBase}${m.access_url}`} token={imgToken} />
                    </View>
                  ))}
                </View>
              )}

              {q.question_text ? (
                <Text style={styles.qText}>{q.question_text}</Text>
              ) : q.question_media.length === 0 ? (
                <Text style={styles.qTextMuted}>(Question content not available)</Text>
              ) : null}

              {/* MCQ answer block */}
              {q.question_type === 'MCQ' && (
                <View style={styles.optionsBlock}>
                  {q.options.length > 0 ? (
                    q.options.map(opt => {
                      const isMine = opt.option_label === q.student_selected_label;
                      const isCorrectOpt = opt.option_label === q.correct_option_label;
                      let bg = '#0F172A';
                      let borderColor = '#334155';
                      if (isCorrectOpt) { bg = '#052E16'; borderColor = '#10B981'; }
                      else if (isMine) { bg = '#2D0A0A'; borderColor = '#EF4444'; }
                      return (
                        <View key={opt.id} style={[styles.optRow, { backgroundColor: bg, borderColor }]}>
                          <Text style={styles.optLabel}>{opt.option_label}</Text>
                          <Text style={styles.optText}>{opt.option_text || '(image option)'}</Text>
                          {isMine && !isCorrectOpt && <Text style={styles.tag}>Your answer</Text>}
                          {isCorrectOpt && <Text style={[styles.tag, styles.tagCorrect]}>Correct</Text>}
                        </View>
                      );
                    })
                  ) : (
                    /* Image-based options — show Your Answer / Correct Answer labels */
                    <View style={styles.imageAnswerBlock}>
                      {q.student_selected_label && (
                        <Text style={styles.imageAnswerLine}>
                          <Text style={styles.imageAnswerLabel}>Your answer: </Text>
                          <Text style={[styles.imageAnswerValue, isCorrect ? styles.valueRight : styles.valueWrong]}>
                            Option {q.student_selected_label}
                          </Text>
                        </Text>
                      )}
                      {!q.student_selected_label && (
                        <Text style={[styles.imageAnswerLine, { color: '#F59E0B' }]}>Not attempted</Text>
                      )}
                      {q.correct_option_label && (
                        <Text style={styles.imageAnswerLine}>
                          <Text style={styles.imageAnswerLabel}>Correct answer: </Text>
                          <Text style={styles.valueRight}>Option {q.correct_option_label}</Text>
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* Integer answer block */}
              {q.question_type === 'INTEGER' && (
                <View style={styles.intBlock}>
                  <View style={styles.intRow}>
                    <Text style={styles.intLabel}>Your answer:</Text>
                    <Text style={[styles.intValue, isCorrect ? styles.valueRight : styles.valueWrong]}>
                      {q.student_integer || '—'}
                    </Text>
                  </View>
                  <View style={styles.intRow}>
                    <Text style={styles.intLabel}>Correct answer:</Text>
                    <Text style={[styles.intValue, styles.valueRight]}>
                      {q.correct_integer ?? '—'}
                    </Text>
                  </View>
                </View>
              )}

              {/* Solution images — responsive + double-tap to zoom */}
              {q.solution_media.length > 0 && (
                <View style={styles.solutionBlock}>
                  <Text style={styles.solutionLabel}>Solution</Text>
                  {q.solution_media.map((m, i) => (
                    <View key={i} style={i > 0 ? { marginTop: 10 } : undefined}>
                      <ZoomableImage uri={m.local_uri ?? `${imgBase}${m.access_url}`} token={imgToken} />
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Width-based font scaling so review content grows on larger devices.
const SCREEN_W = Dimensions.get('window').width;
const FS = Math.min(Math.max(SCREEN_W / 390, 0.95), 1.4);
const f = (n: number) => Math.round(n * FS);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, backgroundColor: '#1E293B',
    borderBottomWidth: 1, borderBottomColor: '#334155',
    paddingTop: 48,
  },
  backLink: { color: '#3B82F6', fontSize: 14, marginRight: 10 },
  headerTitle: { fontSize: 15, fontWeight: 'bold', color: '#F8FAFC', flex: 1 },
  scoreBanner: {
    backgroundColor: '#1E3A5F', paddingVertical: 8, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  scoreBannerText: { color: '#93C5FD', fontWeight: '600', fontSize: 13, textAlign: 'center' },
  cacheNote: {
    textAlign: 'center', fontSize: 11, color: '#334155',
    backgroundColor: '#0F172A', paddingVertical: 4,
  },
  sectionBar: {
    flexDirection: 'row', backgroundColor: '#1E293B',
    borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  secTab: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  secTabActive: { borderBottomColor: '#3B82F6' },
  secTabText: { color: '#64748B', fontWeight: '600', fontSize: 12 },
  secTabTextActive: { color: '#3B82F6' },
  scrollContent: { padding: 14, paddingBottom: 40 },
  qCard: {
    backgroundColor: '#1E293B', borderRadius: 10, padding: 14,
    marginBottom: 12, borderLeftWidth: 4,
  },
  qMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  qNum: { fontSize: 12, fontWeight: 'bold', color: '#3B82F6' },
  verdict: { fontSize: 11, fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  verdictRight: { backgroundColor: '#052E16', color: '#34D399' },
  verdictWrong: { backgroundColor: '#2D0A0A', color: '#F87171' },
  verdictSkip: { backgroundColor: '#2D1B00', color: '#FCD34D' },
  imgRow: { marginBottom: 12 },
  qImg: { width: 300, height: 190, borderRadius: 8, marginRight: 10, backgroundColor: '#1E293B' },
  qText: { fontSize: f(14), color: '#F8FAFC', lineHeight: f(21), marginBottom: 12 },
  qTextMuted: { fontSize: 13, color: '#475569', fontStyle: 'italic', marginBottom: 12 },
  optionsBlock: { gap: 6 },
  optRow: {
    flexDirection: 'row', alignItems: 'center', padding: 10,
    borderRadius: 8, borderWidth: 1, marginBottom: 4,
  },
  optLabel: { color: '#94A3B8', fontWeight: 'bold', width: 22 },
  optText: { color: '#E2E8F0', flex: 1, fontSize: f(13) },
  tag: {
    fontSize: 10, color: '#F87171',
    backgroundColor: '#2D0A0A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    marginLeft: 6,
  },
  tagCorrect: { color: '#34D399', backgroundColor: '#052E16' },
  imageAnswerBlock: { gap: 6 },
  imageAnswerLine: { fontSize: f(14), color: '#E2E8F0' },
  imageAnswerLabel: { color: '#64748B' },
  imageAnswerValue: { fontWeight: 'bold' },
  intBlock: { gap: 8 },
  intRow: { flexDirection: 'row', alignItems: 'center' },
  intLabel: { color: '#64748B', fontSize: f(13), width: 120 },
  intValue: { fontSize: f(15), fontWeight: 'bold' },
  valueRight: { color: '#34D399' },
  valueWrong: { color: '#F87171' },
  solutionBlock: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 10 },
  solutionLabel: { color: '#64748B', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 8 },
  solutionImg: { width: 300, height: 200, borderRadius: 8, marginRight: 10, backgroundColor: '#1E293B' },
  // No-review state
  expiredIcon: { fontSize: 48, marginBottom: 12 },
  expiredTitle: { fontSize: 20, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 12 },
  expiredBody: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  backBtn: { backgroundColor: '#1D4ED8', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  backBtnText: { color: '#F8FAFC', fontWeight: 'bold' },
});
