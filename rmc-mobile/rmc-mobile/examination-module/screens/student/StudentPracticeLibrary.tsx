import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { examFetch, getExamBaseUrl, STORAGE_EXAM_TOKEN } from '../../services/api';
import { prefetchPaperImages, deleteCachedPaper } from '../../services/examPaperCache';

const PRACTICE_STORAGE_KEY = '@rmc_practice_papers';
const SERVER_PAPERS_STORAGE_KEY = '@rmc_server_practice_papers';

interface OfflineMediaItem {
  id: number;
  access_url: string;
  /** file:// path once pre-downloaded during "Get" — rendered offline, no per-question wait. */
  local_uri?: string;
  mime_type: string;
  width?: number | null;
  height?: number | null;
  sort_order: number;
}

type DownloadProgress = { id: number; done: number; total: number; phase: 'paper' | 'images' };

interface OfflineQuestion {
  id: number;
  section_code: 'PHYSICS' | 'CHEMISTRY' | 'MATHS';
  question_type: 'MCQ' | 'INTEGER';
  question_order: number;
  question_text: string | null;
  question_media?: OfflineMediaItem[];
  solution_media?: OfflineMediaItem[];
  // Backend sends question_options (not options) — both keys preserved here for compatibility
  options?: Array<{ id: number; option_label: string; option_text: string; is_correct?: boolean }>;
  question_options?: Array<{ id: number; option_label: string; option_text: string; is_correct?: boolean }>;
  correct_option_label?: string | null;
  correct_integer_answer?: string | null;
}

interface PracticePaper {
  examId: number;
  title: string;
  questions: OfflineQuestion[];
  downloadedAt: number;
  lastScore?: number | null;
  lastMaxScore?: number | null;
  lastAttemptedAt?: number | null;
}

interface ServerPracticePaper {
  paperId: number;
  title: string;
  questionCount: number;
  isDownloaded: boolean;
  questions?: OfflineQuestion[];
  downloadedAt?: number;
  lastAttemptedAt?: number | null;
}

interface AvailableExam {
  id: number;
  title: string;
  status: string;
  duration_seconds: number;
  exam_date_time?: string;
}

const loadLocalPapers = async (): Promise<PracticePaper[]> => {
  const raw = await AsyncStorage.getItem(PRACTICE_STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
};

const saveLocalPapers = async (papers: PracticePaper[]) => {
  await AsyncStorage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(papers));
};

export function StudentPracticeLibrary({ navigation }: { navigation: any }) {
  const [papers, setPapers] = useState<PracticePaper[]>([]);
  const [serverPapers, setServerPapers] = useState<ServerPracticePaper[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [browseVisible, setBrowseVisible] = useState(false);
  const [availableExams, setAvailableExams] = useState<AvailableExam[]>([]);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadingServerId, setDownloadingServerId] = useState<number | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  // Pre-download every question (and solution) image to local storage so the
  // attempt renders instantly + offline, with a visible progress bar — instead
  // of streaming each image on-demand mid-exam. Mutates `questions` in place
  // (sets local_uri); failed/locked images just fall back to the server URL.
  const prefetchImages = useCallback(async (key: number, questions: OfflineQuestion[]) => {
    const token = await SecureStore.getItemAsync(STORAGE_EXAM_TOKEN);
    const imgBase = getExamBaseUrl().replace(/\/api$/, '');
    setDownloadProgress({ id: key, done: 0, total: 0, phase: 'images' });
    await prefetchPaperImages(key, questions as any[], imgBase, token, (done, total) => {
      setDownloadProgress({ id: key, done, total, phase: 'images' });
    });
  }, []);

  const refreshLocal = useCallback(async () => {
    setLoadingLocal(true);
    try {
      const stored = await loadLocalPapers();
      setPapers(stored);

      // Load cached server practice papers list
      const serverRaw = await AsyncStorage.getItem(SERVER_PAPERS_STORAGE_KEY);
      if (serverRaw) setServerPapers(JSON.parse(serverRaw));

      // Refresh server papers list in background.
      // Backend returns { papers: [{ paper_id, title, total_question_count, ... }] }
      examFetch('/student/practice/papers').then((resp) => {
        const list: any[] = resp.papers || [];
        const serverRaw2 = serverRaw ? JSON.parse(serverRaw) : [];
        const merged: ServerPracticePaper[] = list.map((p) => {
          const existing: ServerPracticePaper | undefined = serverRaw2.find((s: ServerPracticePaper) => s.paperId === p.paper_id);
          return {
            paperId: p.paper_id,                        // backend field is paper_id, not id
            title: p.title ?? 'Practice Paper',
            questionCount: p.total_question_count ?? 0, // backend field is total_question_count
            isDownloaded: existing?.isDownloaded ?? false,
            questions: existing?.questions,
            downloadedAt: existing?.downloadedAt,
            lastAttemptedAt: existing?.lastAttemptedAt,
          };
        });
        setServerPapers(merged);
        AsyncStorage.setItem(SERVER_PAPERS_STORAGE_KEY, JSON.stringify(merged));
      }).catch(() => {/* offline — show cached list */ });
    } catch {
      setPapers([]);
    } finally {
      setLoadingLocal(false);
    }
  }, []);

  useEffect(() => {
    refreshLocal();
  }, []);

  const openBrowse = async () => {
    setBrowseVisible(true);
    setLoadingBrowse(true);
    try {
      const resp = await examFetch('/student/exams');
      const all: AvailableExam[] = resp.exams || resp || [];
      const practiseable = all.filter(
        (e) => e.status === 'CLOSED' || e.status === 'RESULT_RELEASED'
      );
      setAvailableExams(practiseable);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not load available exams');
      setBrowseVisible(false);
    } finally {
      setLoadingBrowse(false);
    }
  };

  const handleDownload = async (exam: AvailableExam) => {
    setDownloadingId(exam.id);
    setDownloadProgress({ id: exam.id, done: 0, total: 0, phase: 'paper' });
    try {
      const resp = await examFetch(`/student/exams/${exam.id}/practice/start`, { method: 'POST' });
      const questions: OfflineQuestion[] = resp.questions || [];

      // Download all images now (with progress) so the attempt is instant + offline.
      await prefetchImages(exam.id, questions);

      const stored = await loadLocalPapers();
      const existing = stored.findIndex((p) => p.examId === exam.id);
      const paper: PracticePaper = {
        examId: exam.id,
        title: exam.title,
        questions,
        downloadedAt: Date.now(),
        lastScore: null,
        lastMaxScore: null,
        lastAttemptedAt: null,
      };
      if (existing >= 0) {
        stored[existing] = { ...paper, lastScore: stored[existing].lastScore, lastAttemptedAt: stored[existing].lastAttemptedAt };
      } else {
        stored.push(paper);
      }
      await saveLocalPapers(stored);
      setPapers(stored);
      Alert.alert('Downloaded', `"${exam.title}" saved for offline practice — images included.`);
    } catch (err: any) {
      Alert.alert('Download Failed', err.message || 'Could not download practice paper');
    } finally {
      setDownloadingId(null);
      setDownloadProgress(null);
    }
  };

  const handleDelete = (examId: number) => {
    Alert.alert('Remove Paper', 'Delete this paper from offline storage?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const stored = await loadLocalPapers();
          const updated = stored.filter((p) => p.examId !== examId);
          await saveLocalPapers(updated);
          setPapers(updated);
          await deleteCachedPaper(examId).catch(() => {}); // remove downloaded images
        },
      },
    ]);
  };

  const handleOpenPaper = (paper: PracticePaper) => {
    navigation.navigate('SecureAttemptScreen', {
      examId: paper.examId,
      title: paper.title,
      isPractice: true,
      isOffline: true,
      offlineQuestions: paper.questions,
    });
  };

  const handleDownloadServerPaper = async (sp: ServerPracticePaper) => {
    setDownloadingServerId(sp.paperId);
    setDownloadProgress({ id: sp.paperId, done: 0, total: 0, phase: 'paper' });
    try {
      const resp = await examFetch(`/student/practice/papers/${sp.paperId}/start`, { method: 'POST' });
      const questions: OfflineQuestion[] = resp.questions || [];

      // Download all images now (with progress) so the attempt is instant + offline.
      await prefetchImages(sp.paperId, questions);

      const serverRaw = await AsyncStorage.getItem(SERVER_PAPERS_STORAGE_KEY);
      const existing: ServerPracticePaper[] = serverRaw ? JSON.parse(serverRaw) : [];
      const idx = existing.findIndex((s) => s.paperId === sp.paperId);
      const updated: ServerPracticePaper = {
        ...sp,
        isDownloaded: true,
        questions,
        downloadedAt: Date.now(),
      };
      if (idx >= 0) existing[idx] = updated;
      else existing.push(updated);
      await AsyncStorage.setItem(SERVER_PAPERS_STORAGE_KEY, JSON.stringify(existing));
      setServerPapers([...existing]);
      Alert.alert('Downloaded', `"${sp.title}" saved for offline practice — images included.`);
    } catch (err: any) {
      Alert.alert('Download Failed', err.message || 'Could not download paper');
    } finally {
      setDownloadingServerId(null);
      setDownloadProgress(null);
    }
  };

  const handleOpenServerPaper = (sp: ServerPracticePaper) => {
    if (!sp.isDownloaded || !sp.questions?.length) {
      Alert.alert('Not Downloaded', 'Download this paper first to practice offline.');
      return;
    }
    navigation.navigate('SecureAttemptScreen', {
      examId: sp.paperId,
      title: sp.title,
      isPractice: true,
      isOffline: true,
      offlineQuestions: sp.questions,
    });
  };

  const updateLastScore = async (examId: number, score: number, maxScore: number) => {
    const stored = await loadLocalPapers();
    const idx = stored.findIndex((p) => p.examId === examId);
    if (idx >= 0) {
      stored[idx].lastScore = score;
      stored[idx].lastMaxScore = maxScore;
      stored[idx].lastAttemptedAt = Date.now();
      await saveLocalPapers(stored);
      setPapers([...stored]);
    }
  };

  const alreadyDownloaded = new Set(papers.map((p) => p.examId));

  const renderPaper = ({ item }: { item: PracticePaper }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        {item.lastScore != null && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreBadgeText}>
              {item.lastScore}/{item.lastMaxScore}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.cardMeta}>
        {item.questions.length} questions
        {item.lastAttemptedAt
          ? `  ·  Last: ${new Date(item.lastAttemptedAt).toLocaleDateString()}`
          : '  ·  Never attempted'}
      </Text>

      <View style={styles.sectionPills}>
        {(['PHYSICS', 'CHEMISTRY', 'MATHS'] as const).map((sec) => {
          const count = item.questions.filter((q) => q.section_code === sec).length;
          return (
            <View key={sec} style={styles.pill}>
              <Text style={styles.pillText}>{sec.slice(0, 3)} {count}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.startButton}
          onPress={() => handleOpenPaper(item)}
        >
          <Text style={styles.startButtonText}>Start Practice →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDelete(item.examId)}
        >
          <Text style={styles.deleteButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loadingLocal) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={papers}
        renderItem={renderPaper}
        keyExtractor={(item) => `past-${item.examId}`}
        initialNumToRender={8}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {/* Server Practice Papers */}
            {serverPapers.length > 0 && (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>Practice Papers</Text>
                {serverPapers.map((sp) => (
                  <View key={sp.paperId} style={styles.serverCard}>
                    <View style={styles.serverCardInfo}>
                      <Text style={styles.serverCardTitle}>{sp.title}</Text>
                      <Text style={styles.serverCardMeta}>{sp.questionCount} questions</Text>
                    </View>
                    <View style={styles.serverCardActions}>
                      {sp.isDownloaded && (
                        <TouchableOpacity
                          style={styles.serverStartBtn}
                          onPress={() => handleOpenServerPaper(sp)}
                        >
                          <Text style={styles.serverStartBtnText}>Start →</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.serverDownloadBtn, downloadingServerId === sp.paperId && styles.serverDownloadBtnLoading]}
                        disabled={downloadingServerId === sp.paperId}
                        onPress={() => handleDownloadServerPaper(sp)}
                      >
                        {downloadingServerId === sp.paperId
                          ? <ActivityIndicator size="small" color="#F8FAFC" />
                          : <Text style={styles.serverDownloadBtnText}>{sp.isDownloaded ? '↻' : '⬇'}</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Past Exam Papers header */}
            <Text style={styles.sectionLabel}>Past Exam Papers (Offline)</Text>
            <TouchableOpacity style={styles.browseButton} onPress={openBrowse}>
              <Text style={styles.browseButtonText}>⬇  Browse & Download Past Exams</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyTitle}>No Past Exams Downloaded</Text>
            <Text style={styles.emptySubtitle}>
              Tap "Browse & Download Past Exams" above to save past exams for offline practice — no internet required.
            </Text>
          </View>
        }
      />

      {/* Browse Modal */}
      <Modal visible={browseVisible} animationType="slide" onRequestClose={() => setBrowseVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Available Practice Papers</Text>
            <TouchableOpacity onPress={() => setBrowseVisible(false)}>
              <Text style={styles.modalClose}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          {loadingBrowse ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={styles.loadingText}>Loading from server...</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.browseList}>
              {availableExams.length === 0 ? (
                <Text style={styles.emptySubtitle}>No past exams available for practice yet.</Text>
              ) : (
                availableExams.map((exam) => {
                  const isDownloaded = alreadyDownloaded.has(exam.id);
                  const isDownloading = downloadingId === exam.id;
                  return (
                    <View key={exam.id} style={styles.browseCard}>
                      <View style={styles.browseCardInfo}>
                        <Text style={styles.browseCardTitle}>{exam.title}</Text>
                        <Text style={styles.browseCardMeta}>
                          {Math.floor(exam.duration_seconds / 60)} min
                          {exam.exam_date_time
                            ? `  ·  ${new Date(exam.exam_date_time).toLocaleDateString()}`
                            : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.downloadButton,
                          isDownloaded && styles.downloadedButton,
                          isDownloading && styles.downloadingButton,
                        ]}
                        disabled={isDownloading}
                        onPress={() => handleDownload(exam)}
                      >
                        {isDownloading ? (
                          <ActivityIndicator size="small" color="#F8FAFC" />
                        ) : (
                          <Text style={styles.downloadButtonText}>
                            {isDownloaded ? '↻ Update' : '⬇ Get'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Download progress overlay */}
      <Modal visible={!!downloadProgress} transparent animationType="fade">
        <View style={styles.progOverlay}>
          <View style={styles.progCard}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.progTitle}>
              {downloadProgress?.phase === 'paper' ? 'Fetching paper…' : 'Downloading images'}
            </Text>
            {downloadProgress?.phase === 'images' && (downloadProgress?.total ?? 0) > 0 ? (
              <>
                <View style={styles.progBarTrack}>
                  <View
                    style={[
                      styles.progBarFill,
                      { width: `${Math.round((downloadProgress.done / downloadProgress.total) * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progCount}>
                  {downloadProgress.done} / {downloadProgress.total} images
                </Text>
              </>
            ) : (
              <Text style={styles.progCount}>Please wait…</Text>
            )}
            <Text style={styles.progHint}>Downloading now so questions open instantly — even offline.</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  progOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  progCard: { width: '100%', maxWidth: 360, backgroundColor: '#1E293B', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  progTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '800', marginTop: 14 },
  progBarTrack: { width: '100%', height: 10, borderRadius: 6, backgroundColor: '#0F172A', marginTop: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#334155' },
  progBarFill: { height: '100%', backgroundColor: '#8B5CF6', borderRadius: 6 },
  progCount: { color: '#CBD5E1', fontSize: 13, fontWeight: '700', marginTop: 10 },
  progHint: { color: '#64748B', fontSize: 12, textAlign: 'center', marginTop: 12, lineHeight: 17 },
  list: { padding: 16, paddingBottom: 32 },
  browseButton: {
    backgroundColor: '#1E40AF',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  browseButtonText: { color: '#93C5FD', fontWeight: 'bold', fontSize: 14 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 10 },
  scoreBadge: { backgroundColor: '#10B981', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  scoreBadgeText: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 12 },
  cardMeta: { color: '#64748B', fontSize: 12, marginBottom: 10 },
  sectionPills: { flexDirection: 'row', marginBottom: 14 },
  pill: {
    backgroundColor: '#0F172A', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, marginRight: 6,
    borderWidth: 1, borderColor: '#334155',
  },
  pillText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  cardActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  startButton: { backgroundColor: '#8B5CF6', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  startButtonText: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 13 },
  deleteButton: {
    backgroundColor: '#0F172A', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#EF4444',
  },
  deleteButtonText: { color: '#EF4444', fontWeight: 'bold' },
  emptyState: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
  // Modal
  modalContainer: { flex: 1, backgroundColor: '#0F172A' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155',
    backgroundColor: '#1E293B',
    paddingTop: 48,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC' },
  modalClose: { color: '#94A3B8', fontSize: 14 },
  browseList: { padding: 16 },
  browseCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1E293B', borderRadius: 10, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#334155',
  },
  browseCardInfo: { flex: 1, marginRight: 12 },
  browseCardTitle: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 15 },
  browseCardMeta: { color: '#64748B', fontSize: 12, marginTop: 4 },
  downloadButton: {
    backgroundColor: '#8B5CF6', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 60, alignItems: 'center',
  },
  downloadedButton: { backgroundColor: '#10B981' },
  downloadingButton: { backgroundColor: '#475569' },
  downloadButtonText: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 13 },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  sectionLabel: {
    fontSize: 12, fontWeight: 'bold', color: '#64748B',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginTop: 4,
  },
  sectionBlock: { marginBottom: 8 },
  serverCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1E293B', borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#334155',
  },
  serverCardInfo: { flex: 1, marginRight: 10 },
  serverCardTitle: { color: '#F8FAFC', fontWeight: '600', fontSize: 14 },
  serverCardMeta: { color: '#64748B', fontSize: 12, marginTop: 3 },
  serverCardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  serverStartBtn: { backgroundColor: '#8B5CF6', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  serverStartBtnText: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 12 },
  serverDownloadBtn: { backgroundColor: '#1D4ED8', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, minWidth: 36, alignItems: 'center' },
  serverDownloadBtnLoading: { backgroundColor: '#475569' },
  serverDownloadBtnText: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 14 },
});
