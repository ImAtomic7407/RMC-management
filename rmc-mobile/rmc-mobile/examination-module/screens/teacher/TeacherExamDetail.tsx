import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, SafeAreaView, StatusBar,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { examFetch } from '../../services/api';
import { T } from '../../theme';
import { TeacherGateMonitor } from './TeacherGateMonitor';

type Status = 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'PUBLISHED' | 'CLOSED' | 'RESULT_RELEASED';
type Tab = 'monitor' | 'scan' | 'results';

interface DetailParams {
  examId: number;
  title: string;
  status: Status;
  exam_date_time?: string;
  duration_seconds?: number;
  batchName?: string;
}

const STATUS_COLOR: Record<Status, string> = {
  DRAFT: T.statusDraft, SCHEDULED: T.statusScheduled, LIVE: T.statusLive,
  PUBLISHED: T.statusPractice, CLOSED: T.statusClosed, RESULT_RELEASED: T.statusReleased,
};

export function TeacherExamDetail({ route, navigation }: { route: any; navigation: any }) {
  const params = route.params as DetailParams;
  const { examId, title } = params;

  const [status, setStatus] = useState<Status>(params.status);
  const [tab, setTab] = useState<Tab>(params.status === 'LIVE' ? 'monitor' : 'monitor');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Keep status fresh (it changes as the teacher acts / exam progresses).
  const refreshStatus = useCallback(async () => {
    try {
      const resp = await examFetch(`/exams/${examId}`);
      const s = (resp.exam?.status ?? resp.status ?? resp?.data?.status) as Status | undefined;
      if (s) setStatus(s);
    } catch { /* keep current */ }
  }, [examId]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const doAction = async (action: 'publish' | 'start' | 'close', confirmMsg?: string) => {
    const run = async () => {
      setBusy(true);
      try {
        await examFetch(`/exams/${examId}/${action}`, { method: 'POST' });
        await refreshStatus();
        if (action === 'start') setTab('monitor');
      } catch (e: any) {
        Alert.alert('Action failed', e.message || 'Could not update the exam.');
      } finally { setBusy(false); }
    };
    if (confirmMsg) {
      Alert.alert('Please confirm', confirmMsg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes', onPress: run },
      ]);
    } else { run(); }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Exam',
      `Delete "${title}" permanently? All student data, attempts, and reports will be erased. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await examFetch(`/exams/${examId}`, { method: 'DELETE' });
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Delete failed', e.message || 'Could not delete the exam.');
            } finally { setDeleting(false); }
          },
        },
      ],
    );
  };

  const renderAction = () => {
    if (status === 'DRAFT') {
      return <ActionBtn label="Publish" color={T.statusPractice} busy={busy} onPress={() => doAction('publish')} />;
    }
    if (status === 'PUBLISHED' || status === 'SCHEDULED') {
      const early = status === 'SCHEDULED' && params.exam_date_time
        && new Date(params.exam_date_time).getTime() > Date.now();
      return (
        <ActionBtn
          label={status === 'SCHEDULED' ? 'Start Now 🚀' : 'Go LIVE 🚀'}
          color={T.statusLive}
          busy={busy}
          onPress={() => doAction('start', early
            ? `This exam is scheduled for ${new Date(params.exam_date_time!).toLocaleString()}. Start it now so students can enter?`
            : undefined)}
        />
      );
    }
    if (status === 'LIVE') {
      return <ActionBtn label="Close Exam 🛑" color={T.statusClosed} busy={busy} onPress={() => doAction('close', 'Close the exam for everyone? Students still writing will be submitted.')} />;
    }
    return null;
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'monitor', label: 'Monitor' },
    { key: 'scan', label: 'Scan Entry' },
    { key: 'results', label: 'Results' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={T.surface} />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backLink}>← Exams</Text>
          </TouchableOpacity>
          <View style={[styles.badge, { backgroundColor: STATUS_COLOR[status] }]}>
            <Text style={styles.badgeText}>{status}</Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Text style={styles.subtitle}>
          {params.batchName ? `${params.batchName} · ` : ''}
          {params.duration_seconds ? `${Math.floor(params.duration_seconds / 60)} min` : ''}
          {params.exam_date_time ? ` · ${new Date(params.exam_date_time).toLocaleString()}` : ''}
        </Text>
        {renderAction() && <View style={styles.actionRow}>{renderAction()}</View>}
        {status !== 'LIVE' && (
          <TouchableOpacity style={styles.deleteBtn} disabled={deleting} onPress={handleDelete}>
            {deleting
              ? <ActivityIndicator color={T.danger} />
              : <Text style={styles.deleteBtnText}>🗑 Delete Exam</Text>}
          </TouchableOpacity>
        )}

        {/* Top tabs */}
        <View style={styles.tabBar}>
          {tabs.map((t) => (
            <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.activeTab]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, tab === t.key && styles.activeTabText]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Tab content */}
      <View style={styles.content}>
        {tab === 'monitor' && (
          <TeacherGateMonitor route={{ params: { examId, title } }} navigation={navigation} embedded />
        )}
        {tab === 'scan' && (
          <ScanTab examId={examId} title={title} status={status} navigation={navigation} />
        )}
        {tab === 'results' && (
          <ResultsTab examId={examId} title={title} status={status} />
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Scan tab ──────────────────────────────────────────────────────────────────
function ScanTab({ examId, title, status, navigation }: { examId: number; title: string; status: Status; navigation: any }) {
  const live = status === 'LIVE' || status === 'SCHEDULED' || status === 'PUBLISHED';
  return (
    <ScrollView contentContainerStyle={styles.padded}>
      <Text style={styles.sectionTitle}>Admit students</Text>
      <Text style={styles.sectionBody}>
        Scan each student's entry QR to verify their identity and bind their device before they can start the exam.
      </Text>
      {!live && (
        <View style={[styles.note, { backgroundColor: T.warningBg }]}>
          <Text style={[styles.noteText, { color: T.warning }]}>Start the exam first to admit students.</Text>
        </View>
      )}
      <TouchableOpacity
        style={[styles.bigBtn, !live && styles.bigBtnDisabled]}
        disabled={!live}
        onPress={() => navigation.navigate('TeacherQrScanner', { examId, title })}
      >
        <Text style={styles.bigBtnText}>📷  Open QR Scanner</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Results tab (leaderboard + PDFs) ──────────────────────────────────────────
interface LbEntry { rank: number; full_name: string | null; score?: string | number; uid?: string }

function ResultsTab({ examId, title, status }: { examId: number; title: string; status: Status }) {
  const [entries, setEntries] = useState<LbEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const ready = status === 'CLOSED' || status === 'RESULT_RELEASED';

  useEffect(() => {
    if (!ready) { setLoading(false); return; }
    (async () => {
      try {
        const resp = await examFetch(`/leaderboard/exams/${examId}`);
        const list: LbEntry[] = resp.entries || resp.leaderboard?.entries || resp.leaderboard || resp.rankings || [];
        setEntries(list);
      } catch { setEntries([]); }
      finally { setLoading(false); }
    })();
  }, [examId, ready]);

  const exportLeaderboardPdf = async () => {
    setExporting('leaderboard');
    try {
      const list = entries ?? [];
      const rows = list.map((e) => `
        <tr>
          <td style="text-align:center;font-weight:700">${e.rank}</td>
          <td>${escapeHtml(e.full_name ?? '—')}</td>
          <td style="text-align:right;font-weight:700">${e.score ?? '—'}</td>
        </tr>`).join('');
      const html = pdfShell(`${title} — Leaderboard`, `
        <table>
          <thead><tr><th style="width:60px">Rank</th><th>Student</th><th style="text-align:right">Score</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" style="text-align:center;color:#888">No results</td></tr>'}</tbody>
        </table>`);
      await printAndShare(html);
    } catch (e: any) { Alert.alert('Export failed', e.message || 'Could not create the PDF.'); }
    finally { setExporting(null); }
  };

  const exportAttendancePdf = async () => {
    setExporting('attendance');
    try {
      // Fetch sessions and leaderboard in parallel.
      const [sessResp, lbResp] = await Promise.all([
        examFetch(`/exams/${examId}/gate/sessions`),
        examFetch(`/leaderboard/exams/${examId}`).catch(() => null),
      ]);
      const sessions: any[] = sessResp.gate_sessions || [];

      // Build score map keyed by student_uid from leaderboard.
      const scoreMap = new Map<string, string>();
      const lbList: any[] = lbResp?.leaderboard || [];
      for (const e of lbList) {
        if (e.student_uid) scoreMap.set(e.student_uid, e.score ?? '—');
      }

      const rows = sessions.map((s) => {
        const a = s.attempt;
        const started = a?.started_at ? new Date(a.started_at).getTime() : null;
        const ended = a?.submitted_at ? new Date(a.submitted_at).getTime() : null;
        const minutes = started && ended ? Math.max(0, Math.round((ended - started) / 60000)) : (started ? null : 0);
        const autoKicked = a?.status === 'AUTO_SUBMITTED';
        const violationCount: number = a?._count?.exam_attempt_violations ?? 0;
        const studentUid: string = s.student?.student_uid ?? s.student?.uid ?? s.uid ?? '';
        const score = scoreMap.get(studentUid) ?? '—';
        return {
          name: s.student?.user?.full_name ?? s.student?.full_name ?? '—',
          uid: studentUid,
          minutes, autoKicked, violationCount, score,
          notStarted: !started,
        };
      });

      // Suspicious first: auto-kicked, then least violations, then shortest time.
      rows.sort((x, y) => {
        if (x.autoKicked !== y.autoKicked) return x.autoKicked ? -1 : 1;
        if (y.violationCount !== x.violationCount) return y.violationCount - x.violationCount;
        const xm = x.minutes ?? 99999, ym = y.minutes ?? 99999;
        return xm - ym;
      });

      const body = rows.map((r) => `
        <tr style="${r.autoKicked ? 'background:#FEF2F2' : r.violationCount > 0 ? 'background:#FFFBEB' : ''}">
          <td>${escapeHtml(r.name)}${r.autoKicked ? ' <b style="color:#DC2626">⚠ KICKED</b>' : ''}</td>
          <td style="color:#666">${escapeHtml(r.uid)}</td>
          <td style="text-align:center">${r.notStarted ? 'Did not start' : r.minutes == null ? 'In progress' : r.minutes + ' min'}</td>
          <td style="text-align:center;color:${r.autoKicked ? '#DC2626' : r.violationCount > 0 ? '#D97706' : '#16A34A'};font-weight:700">
            ${r.autoKicked ? 'Yes (kicked)' : r.violationCount > 0 ? 'Yes (' + r.violationCount + ')' : 'No'}
          </td>
          <td style="text-align:center;font-weight:700">${r.score}</td>
        </tr>`).join('');

      const html = pdfShell(`${title} — Attendance & Report`, `
        <p style="color:#666;font-size:12px">
          Suspicious students (kicked for cheating, or with violations) are listed at the top.<br/>
          Score is available only after results are released.
        </p>
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>UID</th>
              <th style="text-align:center">Time in Exam</th>
              <th style="text-align:center">Cheat Attempt</th>
              <th style="text-align:center">Total Marks</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="5" style="text-align:center;color:#888">No students</td></tr>'}</tbody>
        </table>`);
      await printAndShare(html);
    } catch (e: any) { Alert.alert('Export failed', e.message || 'Could not create the PDF.'); }
    finally { setExporting(null); }
  };

  if (!ready) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>Results and reports are available once the exam is closed.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.padded}>
      <View style={styles.pdfRow}>
        <TouchableOpacity style={styles.pdfBtn} disabled={!!exporting} onPress={exportLeaderboardPdf}>
          <Text style={styles.pdfBtnText}>{exporting === 'leaderboard' ? 'Preparing…' : '⬇ Leaderboard PDF'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.pdfBtn, styles.pdfBtnAlt]} disabled={!!exporting} onPress={exportAttendancePdf}>
          <Text style={styles.pdfBtnText}>{exporting === 'attendance' ? 'Preparing…' : '⬇ Attendance PDF'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Leaderboard</Text>
      {loading ? (
        <ActivityIndicator color={T.primary} style={{ marginTop: 20 }} />
      ) : (entries && entries.length > 0) ? (
        entries.map((e) => (
          <View key={e.rank} style={styles.lbRow}>
            <Text style={styles.lbRank}>{e.rank}</Text>
            <Text style={styles.lbName} numberOfLines={1}>{e.full_name ?? '—'}</Text>
            <Text style={styles.lbScore}>{e.score ?? '—'}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>No leaderboard yet. It generates after results are computed.</Text>
      )}
    </ScrollView>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
function ActionBtn({ label, color, busy, onPress }: { label: string; color: string; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color }]} disabled={busy} onPress={onPress}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function pdfShell(heading: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    body{font-family:-apple-system,Roboto,Arial,sans-serif;padding:28px;color:#10221A}
    h1{color:#0D4E35;font-size:20px;margin:0 0 4px}
    .stamp{color:#888;font-size:11px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#0D4E35;color:#fff;text-align:left;padding:8px}
    td{padding:8px;border-bottom:1px solid #E5E7EB}
  </style></head><body>
    <h1>${escapeHtml(heading)}</h1>
    <div class="stamp">RMC Examination · generated ${new Date().toLocaleString()}</div>
    ${inner}
  </body></html>`;
}

async function printAndShare(html: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share / Save PDF' });
  } else {
    Alert.alert('PDF ready', `Saved to:\n${uri}`);
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: { backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border, paddingTop: 16, paddingHorizontal: 16 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backLink: { color: T.primary, fontSize: 14, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  title: { fontSize: 19, fontWeight: '800', color: T.textPrimary, marginTop: 10 },
  subtitle: { fontSize: 12, color: T.textSecondary, marginTop: 4 },
  actionRow: { marginTop: 12 },
  actionBtn: { paddingVertical: 11, borderRadius: T.radiusSm, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  deleteBtn: { marginTop: 8, paddingVertical: 9, borderRadius: T.radiusSm, alignItems: 'center', borderWidth: 1, borderColor: T.danger },
  deleteBtnText: { color: T.danger, fontWeight: '700', fontSize: 13 },
  tabBar: { flexDirection: 'row', marginTop: 14 },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: T.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: T.textMuted },
  activeTabText: { color: T.primary },
  content: { flex: 1 },

  padded: { padding: 18 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: T.textPrimary, marginBottom: 8, marginTop: 4 },
  sectionBody: { fontSize: 13, color: T.textSecondary, lineHeight: 19, marginBottom: 16 },
  note: { padding: 10, borderRadius: T.radiusSm, marginBottom: 12 },
  noteText: { fontSize: 12, fontWeight: '600' },
  bigBtn: { backgroundColor: T.primary, paddingVertical: 16, borderRadius: T.radius, alignItems: 'center' },
  bigBtnDisabled: { backgroundColor: T.textMuted },
  bigBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  pdfRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  pdfBtn: { flex: 1, backgroundColor: T.primary, paddingVertical: 12, borderRadius: T.radiusSm, alignItems: 'center' },
  pdfBtnAlt: { backgroundColor: T.primaryMid },
  pdfBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  lbRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: T.border },
  lbRank: { width: 34, fontSize: 15, fontWeight: '800', color: T.primary },
  lbName: { flex: 1, fontSize: 14, color: T.textPrimary },
  lbScore: { fontSize: 14, fontWeight: '800', color: T.textPrimary },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: T.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
});
