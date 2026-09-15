import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { examFetch } from '../../services/api';
import { T } from '../../theme';

const CACHE_KEY = '@rmc_teacher_exam_list_v1';

export interface Exam {
  id: number;
  title: string;
  duration_seconds: number;
  status: 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'PUBLISHED' | 'CLOSED' | 'RESULT_RELEASED';
  exam_mode: 'LIVE' | 'PRACTICE';
  exam_date_time?: string;
  batch?: { name: string };
}

async function readCache(): Promise<Exam[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw).exams ?? null;
  } catch { return null; }
}

async function writeCache(exams: Exam[]) {
  try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ exams, ts: Date.now() })); } catch {}
}

export function TeacherDashboard({ navigation, headerless = false }: { navigation: any; headerless?: boolean }) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const fetchExams = async (isManualRefresh = false) => {
    try {
      setError(null);
      const response = await examFetch('/exams');
      const list: Exam[] = response.exams || response || [];
      setExams(list);
      setFromCache(false);
      writeCache(list);
    } catch (err: any) {
      const cached = await readCache();
      if (cached) {
        setExams(cached);
        setFromCache(true);
        if (isManualRefresh) setError('Could not refresh — showing saved data');
      } else {
        setError(err.message || 'Failed to load exams');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    readCache().then(cached => {
      if (cached) { setExams(cached); setFromCache(true); setLoading(false); }
    });
    fetchExams();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchExams(true);
  };

  const openExam = (item: Exam) => {
    navigation.navigate('TeacherExamDetail', {
      examId: item.id,
      title: item.title,
      status: item.status,
      exam_date_time: item.exam_date_time,
      duration_seconds: item.duration_seconds,
      batchName: item.batch?.name,
    });
  };

  const renderExamItem = ({ item }: { item: Exam }) => {
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => openExam(item)}>
        <View style={styles.cardHeader}>
          <Text style={styles.examTitle}>{item.title}</Text>
          <View style={[styles.badge, styles[`badge_${item.status}`]]}>
            <Text style={styles.badgeText}>{item.status}</Text>
          </View>
        </View>

        <Text style={styles.cardDetail}>📦 Batch: {item.batch?.name || 'All Batches'}</Text>
        <Text style={styles.cardDetail}>⏱️ Duration: {Math.floor(item.duration_seconds / 60)} minutes</Text>

        <View style={styles.cardFooter}>
          <Text style={styles.openHint}>
            {item.status === 'LIVE' ? 'Monitor · Scan · Manage' : 'Tap to open'}
          </Text>
          <Text style={styles.openChevron}>›</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {!headerless && <StatusBar barStyle="dark-content" backgroundColor={T.surface} />}
      {!headerless && (
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>Teacher Dashboard</Text>
              <Text style={styles.headerSubtitle}>Manage examination operations</Text>
            </View>
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => navigation.navigate('TeacherExamCreator')}
            >
              <Text style={styles.createBtnText}>+ New Exam</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {headerless && (
        <View style={styles.inlineCreateRow}>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => navigation.navigate('TeacherExamCreator')}
          >
            <Text style={styles.createBtnText}>+ Quick Create Exam</Text>
          </TouchableOpacity>
        </View>
      )}

      {error && !fromCache ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); fetchExams(); }}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading && exams.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={T.primary} />
          <Text style={styles.loadingText}>Fetching exams roster...</Text>
        </View>
      ) : (
        <FlatList
          data={exams}
          renderItem={renderExamItem}
          keyExtractor={(item) => item.id.toString()}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={styles.listContent}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No exams created yet. Click "+ New Exam" to start.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: T.bg },
  header:       { padding: 20, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border },
  headerRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle:  { fontSize: 22, fontWeight: '800', color: T.textPrimary },
  headerSubtitle:{ fontSize: 13, color: T.textSecondary, marginTop: 4 },
  createBtn:    { backgroundColor: T.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: T.radiusSm },
  createBtnText:{ color: '#fff', fontWeight: '800', fontSize: 13 },
  listContent:    { padding: 16 },
  card:         { backgroundColor: T.surface, borderRadius: T.radius, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: T.border, elevation: 2, shadowColor: T.shadowColor, shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:4 },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  examTitle:    { fontSize: 16, fontWeight: '700', color: T.textPrimary, flex: 1, marginRight: 8 },
  badge:        { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText:    { fontSize: 10, fontWeight: '800', color: '#fff' },
  badge_DRAFT:          { backgroundColor: T.statusDraft },
  badge_SCHEDULED:      { backgroundColor: T.statusScheduled },
  badge_LIVE:           { backgroundColor: T.statusLive },
  badge_PUBLISHED:      { backgroundColor: T.statusPractice },
  badge_CLOSED:         { backgroundColor: T.statusClosed },
  badge_RESULT_RELEASED:{ backgroundColor: T.statusReleased },
  cardDetail:   { fontSize: 13, color: T.textSecondary, marginBottom: 6 },
  cardFooter:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 10 },
  openHint:     { fontSize: 12, fontWeight: '700', color: T.primary },
  openChevron:  { fontSize: 20, fontWeight: '700', color: T.primary },
  buttonContainer:{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 12 },
  actionBtn:    { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, marginRight: 8, marginBottom: 8 },
  publishBtn:   { backgroundColor: '#7C3AED' },
  startBtn:     { backgroundColor: T.statusLive },
  closeBtn:     { backgroundColor: T.statusClosed },
  scannerBtn:   { backgroundColor: T.success },
  monitorBtn:   { backgroundColor: T.statusScheduled },
  btnText:      { color: '#fff', fontWeight: '800', fontSize: 12 },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText:  { color: T.textSecondary, marginTop: 12, fontSize: 15 },
  errorText:    { color: T.danger, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  retryButton:  { backgroundColor: T.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: T.radiusSm },
  retryButtonText:{ color: '#fff', fontWeight: '700' },
  emptyContainer:{ padding: 40, alignItems: 'center' },
  emptyText:    { color: T.textMuted, fontSize: 15, textAlign: 'center' },
  inlineCreateRow:{ padding: 12, borderBottomWidth: 1, borderBottomColor: T.border, alignItems: 'flex-end', backgroundColor: T.surface },
});
