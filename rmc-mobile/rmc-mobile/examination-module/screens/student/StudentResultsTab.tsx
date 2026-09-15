import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { examFetch } from '../../services/api';
import { examWs } from '../../services/websocket';

const KEY_ATTEMPTS = '@rmc_my_attempts';

export interface LocalAttemptMeta {
  attemptId: number;
  examId: number;
  title: string;
  submittedAt: string;
  reviewCached?: boolean;
  score?: number | null;
  totalScore?: number | null;
  percentage?: string | null;
  correct?: number | null;
  wrong?: number | null;
  unattempted?: number | null;
  resultStatus?: 'pending' | 'released';
}

export async function saveAttemptMeta(meta: LocalAttemptMeta) {
  const raw = await AsyncStorage.getItem(KEY_ATTEMPTS);
  const list: LocalAttemptMeta[] = raw ? JSON.parse(raw) : [];
  const idx = list.findIndex((a) => a.attemptId === meta.attemptId);
  if (idx >= 0) list[idx] = { ...list[idx], ...meta };
  else list.unshift(meta);
  await AsyncStorage.setItem(KEY_ATTEMPTS, JSON.stringify(list));
}

async function mergeServerResults(list: LocalAttemptMeta[]): Promise<LocalAttemptMeta[]> {
  try {
    const resp = await examFetch('/student/results');
    const serverResults: any[] = resp.results || [];
    const updated = [...list];
    for (const sr of serverResults) {
      const idx = updated.findIndex((a) => a.attemptId === sr.attempt_id);
      const patch: Partial<LocalAttemptMeta> = {
        attemptId: sr.attempt_id,
        examId: sr.exam_id,
        title: sr.exam?.title ?? sr.title ?? 'Exam',
        submittedAt: sr.submitted_at ?? sr.submittedAt ?? new Date().toISOString(),
        score: sr.total_score != null ? Number(sr.total_score) : null,
        percentage: sr.percentage != null ? String(sr.percentage) : null,
        correct: sr.correct_count ?? null,
        wrong: sr.wrong_count ?? null,
        unattempted: sr.unattempted_count ?? null,
        resultStatus: 'released',
      };
      if (idx >= 0) updated[idx] = { ...updated[idx], ...patch };
      else updated.push(patch as LocalAttemptMeta);
    }
    return updated;
  } catch {
    return list;
  }
}

async function cacheReviewIfMissing(meta: LocalAttemptMeta): Promise<boolean> {
  if (meta.reviewCached) return false;
  try {
    const rev = await examFetch(`/student/results/${meta.attemptId}/review`);
    const sections: any[] = rev?.review?.sections;
    if (sections?.length) {
      const questions = sections.flatMap((s: any) => s.questions ?? []);
      await AsyncStorage.setItem(
        `@rmc_review_${meta.attemptId}`,
        JSON.stringify({ questions, cachedAt: Date.now() })
      );
      return true;
    }
  } catch {
    // server may have already deleted after TTL — that's fine
  }
  return false;
}

export function StudentResultsTab({ navigation }: { navigation: any }) {
  const [attempts, setAttempts] = useState<LocalAttemptMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const raw = await AsyncStorage.getItem(KEY_ATTEMPTS);
      let list: LocalAttemptMeta[] = raw ? JSON.parse(raw) : [];
      list = await mergeServerResults(list);

      // Auto-cache review for any released result not yet cached
      let anyUpdated = false;
      for (let i = 0; i < list.length; i++) {
        if (list[i].resultStatus === 'released' && !list[i].reviewCached) {
          const cached = await cacheReviewIfMissing(list[i]);
          if (cached) {
            list[i] = { ...list[i], reviewCached: true };
            anyUpdated = true;
          }
        }
      }
      if (anyUpdated) {
        await AsyncStorage.setItem(KEY_ATTEMPTS, JSON.stringify(list));
      }
      setAttempts(list);
    } catch {
      // fall through — show empty list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Backend emits all exam realtime events as type "exam.updated" with payload.action.
    // result release uses action "result_released" inside that envelope.
    const unsub = examWs.subscribe('exam.updated', (event) => {
      if (event.payload?.action === 'result_released') load();
    });
    return unsub;
  }, [load]);

  const handleTap = (item: LocalAttemptMeta) => {
    navigation.navigate('StudentResultReview', {
      attemptId: item.attemptId,
      examId: item.examId,
      title: item.title,
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <FlatList
      data={attempts}
      keyExtractor={(item) => item.attemptId.toString()}
      initialNumToRender={8}
      maxToRenderPerBatch={10}
      windowSize={7}
      removeClippedSubviews
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#3B82F6" />
      }
      renderItem={({ item }) => {
        const hasScore = item.score != null;
        const hasReview = item.reviewCached;
        return (
          <TouchableOpacity style={styles.card} onPress={() => handleTap(item)} activeOpacity={0.75}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              {hasScore ? (
                <View style={styles.scoreBadge}>
                  <Text style={styles.scoreBadgeText}>{Number(item.score)}</Text>
                  {item.percentage != null && (
                    <Text style={styles.pctText}>{parseFloat(item.percentage).toFixed(1)}%</Text>
                  )}
                </View>
              ) : (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingText}>Pending</Text>
                </View>
              )}
            </View>
            {hasScore && (
              <View style={styles.statRow}>
                <StatChip label="Right" value={item.correct ?? '—'} color="#10B981" />
                <StatChip label="Wrong" value={item.wrong ?? '—'} color="#EF4444" />
                <StatChip label="Skipped" value={item.unattempted ?? '—'} color="#F59E0B" />
              </View>
            )}
            <View style={styles.cardFooter}>
              <Text style={styles.dateText}>
                Submitted: {new Date(item.submittedAt).toLocaleString()}
              </Text>
              <Text style={[styles.reviewLabel, !hasReview && styles.reviewLabelFaded]}>
                {hasReview ? 'Review →' : item.resultStatus === 'released' ? 'Review expired' : 'Results pending'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Submitted Exams</Text>
          <Text style={styles.emptySubtitle}>Your results appear here after submission. Pull to refresh.</Text>
        </View>
      }
    />
  );
}

function StatChip({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View style={styles.chip}>
      <Text style={[styles.chipValue, { color }]}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' },
  list: { padding: 16, paddingBottom: 32, backgroundColor: '#0F172A', flexGrow: 1 },
  card: {
    backgroundColor: '#1E293B', borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#334155',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 10 },
  scoreBadge: {
    backgroundColor: '#064E3B', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    alignItems: 'center', minWidth: 56,
  },
  scoreBadgeText: { color: '#34D399', fontWeight: 'bold', fontSize: 16 },
  pctText: { color: '#6EE7B7', fontSize: 10, marginTop: 2 },
  pendingBadge: {
    backgroundColor: '#1C1917', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#44403C',
  },
  pendingText: { color: '#78716C', fontSize: 12, fontWeight: '600' },
  statRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#334155' },
  chip: { alignItems: 'center' },
  chipValue: { fontSize: 16, fontWeight: 'bold' },
  chipLabel: { fontSize: 10, color: '#64748B', marginTop: 2 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateText: { color: '#64748B', fontSize: 11 },
  reviewLabel: { color: '#3B82F6', fontSize: 12, fontWeight: '600' },
  reviewLabelFaded: { color: '#475569' },
  empty: { flex: 1, alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
});
