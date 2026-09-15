import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { examFetch } from '../../services/api';

interface ExamSummary {
  id: number;
  title: string;
  status: string;
  exam_mode: string;
  exam_date_time?: string;
  batch?: { name: string } | null;
}

interface LeaderboardEntry {
  rank: number;
  attempt_id: number;
  student_id: number;
  student_uid: string;
  full_name: string;
  batch_name: string;
  score: string;
  percentage: string;
  correct_count: number;
  wrong_count: number;
  exam: { title: string };
}

function generateLeaderboardHtml(exam: ExamSummary, entries: LeaderboardEntry[], totalQ: number | null): string {
  const medalFor = (rank: number) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
  const rows = entries.map((e) => {
    const skipped = totalQ != null ? totalQ - (e.correct_count ?? 0) - (e.wrong_count ?? 0) : '—';
    return `
    <tr style="background:${e.rank <= 3 ? ['#fef9c3', '#f1f5f9', '#fff7ed'][e.rank - 1] : 'white'}">
      <td style="text-align:center;font-weight:bold;">${medalFor(e.rank)}</td>
      <td>${e.student_uid}</td>
      <td style="font-weight:600">${e.full_name}</td>
      <td>${e.batch_name}</td>
      <td style="text-align:center;font-weight:bold;color:#059669">${e.score}${totalQ ? `/${totalQ * 4}` : ''}</td>
      <td style="text-align:center">${parseFloat(e.percentage).toFixed(2)}%</td>
      <td style="text-align:center;color:#16a34a">${e.correct_count ?? '—'}</td>
      <td style="text-align:center;color:#dc2626">${e.wrong_count ?? '—'}</td>
      <td style="text-align:center;color:#d97706">${skipped}</td>
    </tr>
  `}).join('');

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #1e293b; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .meta { font-size: 12px; color: #64748b; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { background: #1e293b; color: white; padding: 9px 7px; text-align: left; }
      td { border-bottom: 1px solid #e2e8f0; padding: 7px; }
      .footer { margin-top: 20px; font-size: 11px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <h1>${exam.title}</h1>
    <div class="meta">
      ${exam.batch ? `Batch: ${exam.batch.name}  ·  ` : ''}
      ${exam.exam_date_time ? `Date: ${new Date(exam.exam_date_time).toLocaleDateString()}  ·  ` : ''}
      Total students: ${entries.length}${totalQ ? `  ·  Questions: ${totalQ}` : ''}  ·  Generated: ${new Date().toLocaleString()}
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:46px">Rank</th>
          <th style="width:72px">UID</th>
          <th>Name</th>
          <th>Batch</th>
          <th style="width:70px;text-align:center">Score</th>
          <th style="width:50px;text-align:center">%</th>
          <th style="width:42px;text-align:center">Right</th>
          <th style="width:42px;text-align:center">Wrong</th>
          <th style="width:48px;text-align:center">Skipped</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:20px">No results</td></tr>'}
      </tbody>
    </table>
    <div class="footer">RMC Examination Module · Leaderboard is auto-generated from submitted attempts.</div>
  </body>
  </html>`;
}

export function TeacherHistoryTab({ navigation }: { navigation: any }) {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [examsLoading, setExamsLoading] = useState(false);
  const [examsLoaded, setExamsLoaded] = useState(false);

  const [selectedExam, setSelectedExam] = useState<ExamSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [totalQuestions, setTotalQuestions] = useState<number | null>(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadExams = useCallback(async () => {
    setExamsLoading(true);
    try {
      const resp = await examFetch('/exams');
      const all: ExamSummary[] = resp.exams || resp || [];
      setExams(all.filter((e) => e.status === 'CLOSED' || e.status === 'RESULT_RELEASED'));
      setExamsLoaded(true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load exams');
    } finally {
      setExamsLoading(false);
    }
  }, []);

  const selectExam = async (exam: ExamSummary) => {
    setSelectedExam(exam);
    setLbLoading(true);
    setLeaderboard([]);
    setTotalQuestions(null);
    try {
      const [lbResp, examResp] = await Promise.allSettled([
        examFetch(`/leaderboard/exams/${exam.id}`),
        examFetch(`/exams/${exam.id}`),
      ]);
      if (lbResp.status === 'fulfilled') setLeaderboard(lbResp.value.leaderboard || []);
      else Alert.alert('Leaderboard Error', 'Failed to load leaderboard');
      if (examResp.status === 'fulfilled') {
        const e = examResp.value.exam;
        const count =
          e?.total_question_count ??
          e?.question_count ??
          (Array.isArray(e?.sections)
            ? (e.sections as any[]).reduce((s: number, sec: any) => s + (sec.question_count_target ?? 0), 0)
            : null);
        setTotalQuestions(count ?? null);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load data');
    } finally {
      setLbLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!selectedExam) return;
    setRegenerating(true);
    try {
      await examFetch(`/leaderboard/exams/${selectedExam.id}/regenerate`, { method: 'POST' });
      // Reload after regeneration
      const resp = await examFetch(`/leaderboard/exams/${selectedExam.id}`);
      setLeaderboard(resp.leaderboard || []);
      Alert.alert('Done', 'Leaderboard regenerated');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Regeneration failed');
    } finally {
      setRegenerating(false);
    }
  };

  const handleExportPdf = async () => {
    if (!selectedExam || leaderboard.length === 0) {
      Alert.alert('Nothing to Export', 'Load a leaderboard first');
      return;
    }
    setExporting(true);
    try {
      const html = generateLeaderboardHtml(selectedExam, leaderboard, totalQuestions);
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${selectedExam.title} — Leaderboard`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Exported', `PDF saved to:\n${uri}`);
      }
    } catch (err: any) {
      Alert.alert('Export Error', err.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  // Exam picker screen
  if (!selectedExam) {
    return (
      <View style={styles.container}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Select an Exam</Text>
          <TouchableOpacity onPress={loadExams} style={styles.loadBtn} disabled={examsLoading}>
            {examsLoading
              ? <ActivityIndicator size="small" color="#F8FAFC" />
              : <Text style={styles.loadBtnText}>{examsLoaded ? '↺ Refresh' : 'Load Exams'}</Text>}
          </TouchableOpacity>
        </View>

        {!examsLoaded ? (
          <View style={styles.centeredHint}>
            <Text style={styles.hintIcon}>📊</Text>
            <Text style={styles.hintText}>Tap "Load Exams" to see exams with results</Text>
          </View>
        ) : exams.length === 0 ? (
          <View style={styles.centeredHint}>
            <Text style={styles.hintText}>No closed/released exams found</Text>
          </View>
        ) : (
          <FlatList
            data={exams}
            keyExtractor={(item) => item.id.toString()}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews
            contentContainerStyle={styles.examList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.examCard} onPress={() => selectExam(item)}>
                <View style={styles.examCardRow}>
                  <Text style={styles.examCardTitle} numberOfLines={2}>{item.title}</Text>
                  <View style={[
                    styles.examStatusPill,
                    { backgroundColor: item.status === 'RESULT_RELEASED' ? '#10B981' : '#475569' }
                  ]}>
                    <Text style={styles.examStatusPillText}>{item.status === 'RESULT_RELEASED' ? 'RESULTS' : 'CLOSED'}</Text>
                  </View>
                </View>
                {item.batch && <Text style={styles.examCardMeta}>Batch: {item.batch.name}</Text>}
                {item.exam_date_time && (
                  <Text style={styles.examCardMeta}>{new Date(item.exam_date_time).toLocaleString()}</Text>
                )}
                <Text style={styles.examCardAction}>View Leaderboard →</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // Leaderboard view
  return (
    <View style={styles.container}>
      {/* Leaderboard header */}
      <View style={styles.lbHeader}>
        <TouchableOpacity onPress={() => setSelectedExam(null)}>
          <Text style={styles.backText}>← Exams</Text>
        </TouchableOpacity>
        <Text style={styles.lbTitle} numberOfLines={1}>{selectedExam.title}</Text>
        <View style={styles.lbActions}>
          <TouchableOpacity
            style={[styles.actionBtn, regenerating && styles.disabledBtn]}
            disabled={regenerating}
            onPress={handleRegenerate}
          >
            {regenerating
              ? <ActivityIndicator size="small" color="#F8FAFC" />
              : <Text style={styles.actionBtnText}>↺</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.exportBtn, (exporting || leaderboard.length === 0) && styles.disabledBtn]}
            disabled={exporting || leaderboard.length === 0}
            onPress={handleExportPdf}
          >
            {exporting
              ? <ActivityIndicator size="small" color="#F8FAFC" />
              : <Text style={styles.actionBtnText}>PDF ↗</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats bar */}
      {!lbLoading && leaderboard.length > 0 && (
        <View style={styles.statsBar}>
          <Text style={styles.statItem}>Students: {leaderboard.length}</Text>
          {leaderboard[0] && (
            <>
              <Text style={styles.statItem}>
                Top: {leaderboard[0].score}{totalQuestions ? `/${totalQuestions * 4}` : ''}
              </Text>
              <Text style={styles.statItem}>
                {parseFloat(leaderboard[0].percentage).toFixed(1)}%
              </Text>
            </>
          )}
          {totalQuestions && (
            <Text style={styles.statItem}>Qs: {totalQuestions}</Text>
          )}
        </View>
      )}

      {/* Table header */}
      {!lbLoading && (
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { width: 36 }]}>Rank</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Name</Text>
          <Text style={[styles.tableHeaderCell, { width: 64 }]}>Score</Text>
          <Text style={[styles.tableHeaderCell, { width: 36, textAlign: 'center' }]}>Rt</Text>
          <Text style={[styles.tableHeaderCell, { width: 36, textAlign: 'center' }]}>Wr</Text>
          <Text style={[styles.tableHeaderCell, { width: 36, textAlign: 'center' }]}>Sk</Text>
        </View>
      )}

      {lbLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading leaderboard...</Text>
        </View>
      ) : (
        <FlatList
          data={leaderboard}
          keyExtractor={(item) => item.attempt_id.toString()}
          initialNumToRender={12}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={styles.lbList}
          renderItem={({ item }) => {
            const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : null;
            const skipped = totalQuestions != null
              ? totalQuestions - (item.correct_count ?? 0) - (item.wrong_count ?? 0)
              : null;
            const scoreLabel = totalQuestions != null
              ? `${item.score}/${totalQuestions * 4}`
              : item.score;
            return (
              <View style={[styles.lbRow, item.rank <= 3 && styles.lbRowHighlight]}>
                <View style={[styles.lbRankCell, { width: 36 }]}>
                  {medal
                    ? <Text style={styles.medal}>{medal}</Text>
                    : <Text style={styles.rankText}>{item.rank}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbName} numberOfLines={1}>{item.full_name}</Text>
                  <Text style={styles.lbUid}>{item.student_uid} · {item.batch_name}</Text>
                </View>
                <Text style={[styles.lbScore, { width: 64 }]}>{scoreLabel}</Text>
                <Text style={[styles.lbRight, { width: 36 }]}>{item.correct_count ?? '—'}</Text>
                <Text style={[styles.lbWrong, { width: 36 }]}>{item.wrong_count ?? '—'}</Text>
                <Text style={[styles.lbSkipped, { width: 36 }]}>{skipped ?? '—'}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>
                No results yet. Tap ↺ to regenerate if attempts have been submitted.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },

  // Exam picker
  pickerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  pickerTitle: { fontSize: 15, fontWeight: 'bold', color: '#F8FAFC' },
  loadBtn: {
    backgroundColor: '#1D4ED8', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, minWidth: 80, alignItems: 'center',
  },
  loadBtnText: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 13 },
  centeredHint: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  hintIcon: { fontSize: 48, marginBottom: 12 },
  hintText: { color: '#64748B', fontSize: 14, textAlign: 'center' },
  examList: { padding: 16 },
  examCard: {
    backgroundColor: '#1E293B', borderRadius: 10, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: '#334155',
  },
  examCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  examCardTitle: { flex: 1, fontSize: 15, fontWeight: 'bold', color: '#F8FAFC', marginRight: 8 },
  examStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  examStatusPillText: { color: '#F8FAFC', fontSize: 10, fontWeight: 'bold' },
  examCardMeta: { color: '#64748B', fontSize: 12, marginBottom: 2 },
  examCardAction: { color: '#3B82F6', fontSize: 13, fontWeight: '600', marginTop: 8 },

  // Leaderboard
  lbHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderBottomWidth: 1, borderBottomColor: '#334155', backgroundColor: '#1E293B',
  },
  backText: { color: '#3B82F6', fontSize: 13, marginRight: 8 },
  lbTitle: { flex: 1, color: '#F8FAFC', fontWeight: 'bold', fontSize: 13 },
  lbActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    backgroundColor: '#334155', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6, minWidth: 36, alignItems: 'center',
  },
  exportBtn: { backgroundColor: '#1D4ED8' },
  actionBtnText: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 12 },
  disabledBtn: { opacity: 0.4 },

  statsBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: '#172554', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1D4ED8',
  },
  statItem: { color: '#93C5FD', fontSize: 12, fontWeight: '600' },

  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  tableHeaderCell: { color: '#64748B', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase' },

  lbList: { paddingBottom: 32 },
  lbRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  lbRowHighlight: { backgroundColor: '#0F2344' },
  lbRankCell: { alignItems: 'center', marginRight: 10 },
  rankText: { color: '#64748B', fontWeight: 'bold', fontSize: 13 },
  medal: { fontSize: 18 },
  lbName: { color: '#F8FAFC', fontWeight: '600', fontSize: 14 },
  lbUid: { color: '#64748B', fontSize: 11, marginTop: 2 },
  lbScore: { color: '#10B981', fontWeight: 'bold', fontSize: 12, textAlign: 'center' },
  lbRight: { color: '#34D399', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },
  lbWrong: { color: '#F87171', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },
  lbSkipped: { color: '#FCD34D', fontWeight: '600', fontSize: 13, textAlign: 'center' },

  loadingText: { color: '#94A3B8', marginTop: 12 },
  emptyText: { color: '#64748B', textAlign: 'center', fontSize: 14, lineHeight: 20 },
});
