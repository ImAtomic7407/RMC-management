import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { examFetch } from '../../services/api';
import { examWs } from '../../services/websocket';
import { T } from '../../theme';

interface AttemptInfo {
  id: number;
  status: string;
  started_at?: string | null;
  submitted_at?: string | null;
}

interface GateSession {
  id: number;
  student: {
    id: number;
    uid: string;
    full_name: string;
    batch?: { name: string } | null;
  };
  gate_status: string;
  device_bind_status: string;
  created_at?: string;
  attempt?: AttemptInfo | null;
  // Accumulated client-side from realtime violation events
  lastViolationType?: string | null;
  lastViolationSeverity?: string | null;
  violationCount?: number;
  leftScreenAt?: string | null;
  autoSubmitted?: boolean;
}

type StudentStatus = 'AUTO_SUBMITTED' | 'LEFT' | 'COMPLETED' | 'ACTIVE' | 'NOT_STARTED';

const FOCUS_VIOLATION_TYPES = ['APP_BACKGROUND', 'APP_SWITCH', 'MULTI_WINDOW', 'OVERLAY_OR_ASSISTANT_TRIGGERED'];

// Plain-language meaning for each status — shown to a non-technical proctor.
const STATUS_META: Record<StudentStatus, { label: string; plain: string; color: string; bg: string }> = {
  AUTO_SUBMITTED: { label: 'CHEATING', plain: 'Left the app twice — auto-submitted', color: T.danger,  bg: T.dangerBg },
  LEFT:           { label: 'OUT OF APP', plain: 'Stepped out of the exam — warned', color: T.warning, bg: T.warningBg },
  COMPLETED:      { label: 'DONE',       plain: 'Finished and submitted',           color: T.success, bg: T.successBg },
  ACTIVE:         { label: 'IN EXAM',    plain: 'Writing the exam now',              color: T.primary, bg: T.primaryLight },
  NOT_STARTED:    { label: 'WAITING',    plain: 'Verified, not started yet',         color: T.textMuted, bg: T.surfaceAlt },
};

function getStudentStatus(session: GateSession): StudentStatus {
  // 2nd unpin (CRITICAL APP_SWITCH) or a flagged auto-submit = cheating.
  if (session.autoSubmitted || (session.lastViolationType === 'APP_SWITCH' && session.lastViolationSeverity === 'CRITICAL')) {
    return 'AUTO_SUBMITTED';
  }
  if (session.attempt?.status === 'AUTO_SUBMITTED') return 'AUTO_SUBMITTED';
  // Cleanly finished and submitted.
  if (session.attempt?.submitted_at || session.attempt?.status === 'SUBMITTED') return 'COMPLETED';
  // Currently out of the app (warned, 1st strike).
  if (session.lastViolationType && FOCUS_VIOLATION_TYPES.includes(session.lastViolationType)) return 'LEFT';
  // In the exam.
  if (session.attempt?.status === 'IN_PROGRESS') return 'ACTIVE';
  if (session.gate_status === 'VERIFIED' || session.gate_status === 'ADMITTED') return 'ACTIVE';
  return 'NOT_STARTED';
}

export function TeacherGateMonitor({
  route,
  navigation,
  embedded = false,
}: {
  route: any;
  navigation: any;
  embedded?: boolean;
}) {
  const { examId, title } = route.params as { examId: number; title: string };

  const [sessions, setSessions] = useState<GateSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const sessionsRef = useRef<GateSession[]>([]);
  sessionsRef.current = sessions;

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const resp = await examFetch(`/exams/${examId}/gate/sessions`);
      const raw: GateSession[] = resp.gate_sessions || [];
      const merged = raw.map((s) => {
        const existing = sessionsRef.current.find((e) => e.id === s.id);
        return existing
          ? { ...s, lastViolationType: existing.lastViolationType, lastViolationSeverity: existing.lastViolationSeverity, violationCount: existing.violationCount, leftScreenAt: existing.leftScreenAt, autoSubmitted: existing.autoSubmitted }
          : s;
      });
      setSessions(sortSessions(merged));
      setLastUpdated(new Date());
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [examId]);

  useEffect(() => {
    load();

    const unsub = examWs.subscribe('exam.updated', (event) => {
      // Ignore events for other exams (the WS stream is global across exams).
      if (event.exam_id !== examId) return;
      if (event.payload?.action !== 'violation_logged') return;
      const { gate_session_id, violation_type, severity } = event.payload ?? {};
      if (!gate_session_id || !violation_type) return;
      setSessions((prev) => {
        const updated = prev.map((s) => {
          if (s.id !== gate_session_id) return s;
          const isAutoSubmit = violation_type === 'APP_SWITCH' && severity === 'CRITICAL';
          return {
            ...s,
            lastViolationType: violation_type,
            lastViolationSeverity: severity ?? null,
            violationCount: (s.violationCount ?? 0) + 1,
            autoSubmitted: s.autoSubmitted || isAutoSubmit,
            leftScreenAt: FOCUS_VIOLATION_TYPES.includes(violation_type)
              ? new Date().toISOString()
              : s.leftScreenAt,
          };
        });
        return sortSessions(updated);
      });
    });

    const pollInterval = setInterval(() => load(false), 30_000);

    return () => {
      unsub();
      clearInterval(pollInterval);
    };
  }, [load]);

  const renderItem = ({ item }: { item: GateSession }) => {
    const status = getStudentStatus(item);
    const meta = STATUS_META[status];
    return (
      <View style={[styles.row, { borderLeftColor: meta.color }]}>
        <View style={styles.rowInfo}>
          <Text style={styles.studentName}>{item.student.full_name}</Text>
          <Text style={styles.studentMeta}>
            {item.student.uid}
            {item.student.batch ? ` · ${item.student.batch.name}` : ''}
          </Text>
          <Text style={[styles.plain, { color: meta.color }]}>{meta.plain}</Text>
          {(status === 'LEFT' || status === 'AUTO_SUBMITTED') && item.leftScreenAt && (
            <Text style={styles.leftAt}>
              {status === 'AUTO_SUBMITTED' ? 'Force-submitted at ' : 'Left at '}
              {new Date(item.leftScreenAt).toLocaleTimeString()}
              {item.violationCount && item.violationCount > 1 ? ` · ${item.violationCount} alerts` : ''}
            </Text>
          )}
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
          <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>
    );
  };

  const counts = sessions.reduce(
    (acc, s) => { acc[getStudentStatus(s)] += 1; return acc; },
    { AUTO_SUBMITTED: 0, LEFT: 0, COMPLETED: 0, ACTIVE: 0, NOT_STARTED: 0 } as Record<StudentStatus, number>,
  );

  const body = (
    <>
      {/* Stats strip — simple, color-coded */}
      <View style={styles.statsStrip}>
        <Stat n={sessions.length} label="Total" color={T.textPrimary} />
        <Stat n={counts.ACTIVE} label="In Exam" color={T.primary} border />
        <Stat n={counts.LEFT} label="Out of App" color={T.warning} border />
        <Stat n={counts.AUTO_SUBMITTED} label="Cheating" color={T.danger} border />
        <Stat n={counts.COMPLETED} label="Done" color={T.success} border />
      </View>

      {counts.AUTO_SUBMITTED > 0 && (
        <View style={[styles.banner, { backgroundColor: T.dangerBg, borderColor: T.danger }]}>
          <Text style={[styles.bannerText, { color: T.danger }]}>
            ⚠ {counts.AUTO_SUBMITTED} student{counts.AUTO_SUBMITTED > 1 ? 's' : ''} auto-submitted for leaving the app twice
          </Text>
        </View>
      )}
      {counts.LEFT > 0 && counts.AUTO_SUBMITTED === 0 && (
        <View style={[styles.banner, { backgroundColor: T.warningBg, borderColor: T.warning }]}>
          <Text style={[styles.bannerText, { color: T.warning }]}>
            {counts.LEFT} student{counts.LEFT > 1 ? 's' : ''} currently out of the exam app
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={T.primary} />
          <Text style={styles.loadingText}>Loading students…</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id.toString()}
          initialNumToRender={10}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={T.primary} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No students have entered the gate yet.</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </>
  );

  if (embedded) return <View style={styles.container}>{body}</View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.headerSub}>Live Monitor{lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString()}` : ''}</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => load(true)}>
          <Text style={styles.refreshBtnText}>↺</Text>
        </TouchableOpacity>
      </View>
      {body}
    </View>
  );
}

function Stat({ n, label, color, border }: { n: number; label: string; color: string; border?: boolean }) {
  return (
    <View style={[styles.stat, border && styles.statBorderLeft]}>
      <Text style={[styles.statNum, { color }]}>{n}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function statusSortOrder(s: GateSession): number {
  const st = getStudentStatus(s);
  if (st === 'AUTO_SUBMITTED') return 0; // cheaters on top
  if (st === 'LEFT') return 1;
  if (st === 'ACTIVE') return 2;
  if (st === 'COMPLETED') return 3;
  return 4;
}

function sortSessions(sessions: GateSession[]): GateSession[] {
  return [...sessions].sort((a, b) => {
    const orderDiff = statusSortOrder(a) - statusSortOrder(b);
    if (orderDiff !== 0) return orderDiff;
    const aTime = a.leftScreenAt ? new Date(a.leftScreenAt).getTime() : 0;
    const bTime = b.leftScreenAt ? new Date(b.leftScreenAt).getTime() : 0;
    return bTime - aTime;
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, backgroundColor: T.surface,
    borderBottomWidth: 1, borderBottomColor: T.border, paddingTop: 48,
  },
  backLink: { color: T.primary, fontSize: 14, marginRight: 10, fontWeight: '700' },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: '800', color: T.textPrimary },
  headerSub: { fontSize: 11, color: T.textSecondary },
  refreshBtn: { backgroundColor: T.surfaceAlt, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  refreshBtnText: { color: T.primary, fontWeight: 'bold', fontSize: 16 },

  statsStrip: {
    flexDirection: 'row', backgroundColor: T.surface,
    borderBottomWidth: 1, borderBottomColor: T.border, paddingVertical: 10,
  },
  stat: { flex: 1, alignItems: 'center' },
  statBorderLeft: { borderLeftWidth: 1, borderLeftColor: T.border },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, color: T.textSecondary, marginTop: 2 },

  banner: { paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 1 },
  bannerText: { fontWeight: '700', fontSize: 13, textAlign: 'center' },

  listContent: { paddingBottom: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: T.surface, borderLeftWidth: 4,
  },
  rowInfo: { flex: 1 },
  studentName: { fontSize: 14, fontWeight: '700', color: T.textPrimary },
  studentMeta: { fontSize: 11, color: T.textSecondary, marginTop: 2 },
  plain: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  leftAt: { fontSize: 10, color: T.textMuted, marginTop: 2 },

  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, marginLeft: 8 },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { color: T.textSecondary, marginTop: 12 },
  emptyText: { color: T.textMuted, textAlign: 'center', fontSize: 14 },
});
