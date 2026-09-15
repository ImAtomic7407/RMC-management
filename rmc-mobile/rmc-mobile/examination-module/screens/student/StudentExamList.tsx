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
import { examWs } from '../../services/websocket';
import { T } from '../../theme';

const CACHE_KEY = '@rmc_exam_list_live_v2'; // v2 = excludes practice-mode exams

export interface Exam {
  id: number;
  title: string;
  duration_seconds: number;
  status: 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'PUBLISHED' | 'CLOSED' | 'RESULT_RELEASED';
  exam_mode: 'LIVE' | 'PRACTICE';
  instructions?: string;
  exam_date_time?: string;
}

async function readExamCache(): Promise<Exam[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { exams } = JSON.parse(raw);
    return exams ?? null;
  } catch {
    return null;
  }
}

async function writeExamCache(exams: Exam[]) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ exams, ts: Date.now() }));
  } catch {}
}

export function StudentExamList({ navigation, headerless = false }: { navigation: any; headerless?: boolean }) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const fetchExams = async (isManualRefresh = false) => {
    try {
      setError(null);
      const r = await examFetch('/student/exams');
      // Exclude practice-mode exams — they live in the Practice tab
      const list: Exam[] = (r.exams || r || []).filter((e: Exam) => e.exam_mode !== 'PRACTICE');
      setExams(list);
      setFromCache(false);
      writeExamCache(list);
    } catch (e: any) {
      const cached = await readExamCache();
      if (cached) {
        setExams(cached);
        setFromCache(true);
        if (isManualRefresh) setError('Could not refresh — showing saved data');
      } else {
        setError(e.message || 'Failed to load exams');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // Show cached data immediately while network loads — never show loading if cache exists
    readExamCache().then(cached => {
      if (cached) {
        setExams(cached);
        setFromCache(true);
        setLoading(false);  // Hide spinner if cache exists
        fetchExams();       // Refresh in background silently
        return;
      }
      // No cache — try network
      fetchExams();
    });
    examWs.connect();
    const unsub = examWs.subscribe('exam.updated', () => { fetchExams(); });
    return () => { unsub(); examWs.disconnect(); };
  }, []);

  const handleRefresh = () => { setRefreshing(true); fetchExams(true); };

  const handleSelectExam = (exam: Exam) => {
    if (exam.exam_mode === 'PRACTICE' && (exam.status === 'CLOSED' || exam.status === 'RESULT_RELEASED')) {
      navigation.navigate('SecureAttemptScreen', { examId: exam.id, title: exam.title, isPractice: true });
      return;
    }
    if (exam.status === 'LIVE' || exam.exam_mode === 'PRACTICE') {
      navigation.navigate('StudentWaitingRoom', { examId: exam.id, title: exam.title });
    }
  };

  const statusBg = (status: Exam['status'], mode: Exam['exam_mode']) => {
    if (mode === 'PRACTICE')      return T.statusPractice;
    if (status === 'LIVE')        return T.statusLive;
    if (status === 'SCHEDULED')   return T.statusScheduled;
    if (status === 'CLOSED')      return T.statusClosed;
    if (status === 'RESULT_RELEASED') return T.statusReleased;
    return T.statusDraft;
  };

  const renderExam = ({ item }: { item: Exam }) => {
    const isClickable = item.status === 'LIVE' || item.exam_mode === 'PRACTICE';
    const bg = statusBg(item.status, item.exam_mode);
    const label = item.exam_mode === 'PRACTICE' ? 'PRACTICE' : item.status;

    return (
      <TouchableOpacity
        style={[s.card, !isClickable && s.cardDim]}
        disabled={!isClickable}
        onPress={() => handleSelectExam(item)}
        activeOpacity={0.75}
      >
        <View style={s.cardTop}>
          <Text style={s.cardTitle}>{item.title}</Text>
          <View style={[s.badge, { backgroundColor: bg }]}>
            <Text style={s.badgeTxt}>{label}</Text>
          </View>
        </View>

        <Text style={s.detail}>Duration: {Math.floor(item.duration_seconds / 60)} minutes</Text>
        {item.exam_date_time && (
          <Text style={s.detail}>Scheduled: {new Date(item.exam_date_time).toLocaleString()}</Text>
        )}

        <View style={s.action}>
          {isClickable ? (
            <Text style={[s.actionTxt, { color: bg }]}>
              {item.exam_mode === 'PRACTICE' ? 'Start Practice →' : 'Enter Exam Room →'}
            </Text>
          ) : (
            <Text style={s.actionMuted}>
              {item.status === 'SCHEDULED' ? 'Waiting to start…'
                : item.status === 'RESULT_RELEASED' ? 'Results available'
                : 'Exam closed'}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.root}>
      {!headerless && <StatusBar barStyle="dark-content" backgroundColor={T.surface} />}
      {!headerless && (
        <View style={s.header}>
          <Text style={s.hTitle}>RMC Examinations</Text>
          <Text style={s.hSub}>Your scheduled tests & practice papers</Text>
        </View>
      )}

      {error && !fromCache ? (
        <View style={s.ctr}>
          <Text style={s.errTxt}>⚠ {error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); fetchExams(); }}>
            <Text style={s.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading && exams.length === 0 ? (
        <View style={s.ctr}>
          <ActivityIndicator size="large" color={T.primary} />
          <Text style={s.loadTxt}>Fetching exams...</Text>
        </View>
      ) : (
        <FlatList
          data={exams}
          renderItem={renderExam}
          keyExtractor={(i) => i.id.toString()}
          contentContainerStyle={s.list}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          onRefresh={handleRefresh}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Text style={s.emptyTxt}>No live or upcoming exams at the moment.</Text>
              <Text style={s.emptyHint}>Check the Practice tab for past papers. Pull down to refresh.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: T.bg },
  header:     { padding: 20, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border },
  hTitle:     { fontSize: 22, fontWeight: '800', color: T.textPrimary },
  hSub:       { fontSize: 13, color: T.textSecondary, marginTop: 4 },
  list:       { padding: 16 },
  card:       { backgroundColor: T.surface, borderRadius: T.radius, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: T.border, elevation: 2, shadowColor: T.shadowColor, shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:4 },
  cardDim:    { opacity: 0.55 },
  cardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardTitle:  { fontSize: 16, fontWeight: '700', color: T.textPrimary, flex: 1, marginRight: 8 },
  badge:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontWeight: '800', color: '#fff' },
  detail:     { fontSize: 13, color: T.textSecondary, marginBottom: 4 },
  action:     { marginTop: 10, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 10, alignItems: 'flex-end' },
  actionTxt:  { fontSize: 13, fontWeight: '700' },
  actionMuted:{ fontSize: 13, color: T.textMuted },
  ctr:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadTxt:    { color: T.textSecondary, marginTop: 12, fontSize: 15 },
  errTxt:     { color: T.danger, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  retryBtn:   { backgroundColor: T.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: T.radiusSm },
  retryTxt:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyWrap:     { padding: 40, alignItems: 'center' },
  emptyTxt:      { color: T.textSecondary, fontSize: 15, textAlign: 'center' },
  emptyHint:     { color: T.textMuted, fontSize: 12, marginTop: 8 },
});
