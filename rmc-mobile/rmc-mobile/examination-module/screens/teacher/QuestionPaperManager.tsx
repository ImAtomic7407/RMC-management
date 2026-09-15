import React, { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as SecureStore from 'expo-secure-store';
import { examFetch, getExamBaseUrl, STORAGE_EXAM_TOKEN } from '../../services/api';
import { T } from '../../theme';

type ViewMode = 'list' | 'create' | 'questions' | 'add-question' | 'schedule';
type SectionCode = 'PHYSICS' | 'CHEMISTRY' | 'MATHS';
type QuestionType = 'MCQ' | 'INTEGER';
type ExamMode = 'LIVE' | 'PRACTICE';
type SolutionPolicy = 'AFTER_EXAM_END' | 'AFTER_RESULT_RELEASE' | 'NEVER' | 'PRACTICE_UNLOCK_RULE';

interface MediaItem {
  id: number;
  purpose: string;
  mime_type: string;
  access_url: string;
}

interface Paper {
  id: number;
  title: string;
  status: string;
  category?: string | null;
}

interface Question {
  id: number;
  section_code: SectionCode;
  question_type: QuestionType;
  question_order: number;
  question_text?: string | null;
  question_media?: MediaItem[];
  options?: Array<{ option_label: string; option_text: string }>;
  correct_option_label?: string | null;
  correct_integer_answer?: string | null;
}

interface Batch {
  id: number;
  name: string;
}

// ─── Drum Roller ───────────────────────────────────────────────────────────────
const ITEM_H = 52;
const VISIBLE = 5;
const PAD = Math.floor(VISIBLE / 2); // 2

function DrumRoller({
  min, max, value, onChange,
}: {
  min: number; max: number; value: number; onChange: (v: number) => void;
}) {
  const items = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const y = (value - min) * ITEM_H;
    setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 80);
  }, []);

  const settle = (e: any) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const idx = Math.round(y / ITEM_H);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    scrollRef.current?.scrollTo({ y: clamped * ITEM_H, animated: false });
    onChange(items[clamped]);
  };

  return (
    <View style={drum.wrap}>
      <View style={drum.selBox} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        contentContainerStyle={{ paddingTop: ITEM_H * PAD, paddingBottom: ITEM_H * PAD }}
      >
        {items.map((v) => {
          const active = v === value;
          return (
            <View key={v} style={drum.item}>
              <Text style={[drum.txt, active && drum.txtActive]}>
                {String(v).padStart(2, '0')}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const drum = StyleSheet.create({
  wrap:      { height: ITEM_H * VISIBLE, width: 80, overflow: 'hidden', backgroundColor: T.surface, borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.border },
  selBox:    { position: 'absolute', top: ITEM_H * PAD, height: ITEM_H, width: '100%', borderTopWidth: 2, borderBottomWidth: 2, borderColor: T.primary, backgroundColor: T.primaryLight, zIndex: 1 },
  item:      { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },
  txt:       { fontSize: 18, color: T.textMuted, fontWeight: '400' },
  txtActive: { fontSize: 26, color: T.primary, fontWeight: '800' },
});

// ─── Media Thumbnail ───────────────────────────────────────────────────────────
// memo + resizeMethod="resize": Android downsamples the full-res image to the
// thumbnail size during decode, so a tiny 80x60 preview no longer pays the
// memory/CPU cost of decoding a full-resolution bitmap. Huge smoothness win.
const MediaThumb = memo(function MediaThumb({ media, token }: { media: MediaItem; token: string | null }) {
  if (!media.mime_type.startsWith('image/')) return null;
  const base = getExamBaseUrl().replace(/\/api$/, '');
  // ?w=240 → backend returns a small, disk-cached thumbnail (crisp at up to 3x DPI
  // for the 80px-wide preview) instead of the full-resolution upload.
  const sep = media.access_url.includes('?') ? '&' : '?';
  const thumbUri = `${base}${media.access_url}${sep}w=240`;
  return (
    <Image
      source={{ uri: thumbUri, headers: token ? { Authorization: `Bearer ${token}` } : {} }}
      style={s.thumb}
      resizeMode="cover"
      resizeMethod="resize"
      fadeDuration={0}
    />
  );
});

// ─── Main ──────────────────────────────────────────────────────────────────────
export function QuestionPaperManager({ navigation }: { navigation: any }) {
  const [view, setView] = useState<ViewMode>('list');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [paperQuestions, setPaperQuestions] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionCode>('PHYSICS');

  // Create
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');

  // Add question
  const [qSection, setQSection] = useState<SectionCode>('PHYSICS');
  const [qType, setQType] = useState<QuestionType>('MCQ');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState({ A: '', B: '', C: '', D: '' });
  const [qCorrectLabel, setQCorrectLabel] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [qIntegerAnswer, setQIntegerAnswer] = useState('');
  const [qMarks, setQMarks] = useState('4');
  const [qNegative, setQNegative] = useState('1');

  // Schedule
  const [batches, setBatches] = useState<Batch[]>([]);
  const [schedTitle, setSchedTitle] = useState('');
  const [schedBatchIds, setSchedBatchIds] = useState<number[]>([]);
  const [schedMode, setSchedMode] = useState<ExamMode>('LIVE');
  const [schedDate, setSchedDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [schedHrs, setSchedHrs] = useState(3);
  const [schedMins, setSchedMins] = useState(0);
  const [schedPolicy, setSchedPolicy] = useState<SolutionPolicy>('AFTER_RESULT_RELEASE');

  useEffect(() => { SecureStore.getItemAsync(STORAGE_EXAM_TOKEN).then(setToken); }, []);

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await examFetch('/question-papers');
      setPapers(r.question_papers || []);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load papers');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPapers(); }, []);

  const openPaper = async (p: Paper) => {
    setSelectedPaper(p); setQuestionsLoading(true); setView('questions');
    try {
      const r = await examFetch(`/question-papers/${p.id}/questions`);
      setPaperQuestions(r.questions || []);
      setSchedTitle(p.title);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setQuestionsLoading(false); }
  };

  const handleCreatePaper = async () => {
    if (!newTitle.trim()) { Alert.alert('Validation', 'Title required'); return; }
    setSubmitting(true);
    try {
      const r = await examFetch('/question-papers', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(), category: newCategory.trim() || null,
          sections: [
            { section_code: 'PHYSICS',   question_count_target: 30, default_marks: 4, default_negative_marks: 1 },
            { section_code: 'CHEMISTRY', question_count_target: 30, default_marks: 4, default_negative_marks: 1 },
            { section_code: 'MATHS',     question_count_target: 30, default_marks: 4, default_negative_marks: 1 },
          ],
        }),
      });
      Alert.alert('Created', `"${r.paper.title}" created!`);
      setNewTitle(''); setNewCategory('');
      await fetchPapers(); setView('list');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSubmitting(false); }
  };

  const handleAddQuestion = async () => {
    if (!selectedPaper || !qText.trim()) { Alert.alert('Validation', 'Question text required'); return; }
    if (qType === 'MCQ' && ['A','B','C','D'].some((l) => !qOptions[l as 'A'].trim())) { Alert.alert('Validation', 'All 4 options required'); return; }
    if (qType === 'INTEGER' && !qIntegerAnswer.trim()) { Alert.alert('Validation', 'Integer answer required'); return; }
    setSubmitting(true);
    try {
      const body: any = { section_code: qSection, question_type: qType, question_text: qText.trim(), marks: parseFloat(qMarks) || 4, negative_marks: parseFloat(qNegative) || 1 };
      if (qType === 'MCQ') {
        body.options = (['A','B','C','D'] as const).map((l) => ({ option_label: l, option_text: qOptions[l].trim() }));
        body.correct_option_label = qCorrectLabel;
      } else { body.correct_integer_answer = qIntegerAnswer.trim(); }
      await examFetch(`/question-papers/${selectedPaper.id}/questions`, { method: 'POST', body: JSON.stringify(body) });
      const r = await examFetch(`/question-papers/${selectedPaper.id}/questions`);
      setPaperQuestions(r.questions || []);
      setQText(''); setQOptions({ A:'',B:'',C:'',D:'' }); setQIntegerAnswer('');
      setActiveSection(qSection);
      Alert.alert('Added', 'Question added'); setView('questions');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSubmitting(false); }
  };

  const openSchedule = async () => {
    setView('schedule');
    try { const r = await examFetch('/identity/batches'); setBatches(r.batches || []); } catch {}
  };

  const toggleBatch = (id: number) =>
    setSchedBatchIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const handleSchedule = async () => {
    if (!selectedPaper || !schedTitle.trim()) { Alert.alert('Validation', 'Title required'); return; }
    const dur = schedHrs * 3600 + schedMins * 60;
    if (dur <= 0) { Alert.alert('Validation', 'Duration must be > 0'); return; }
    setSubmitting(true);
    try {
      const body: any = {
        question_paper_id: selectedPaper.id,
        title: schedTitle.trim(),
        exam_mode: schedMode,
        scheduled_at: schedDate.toISOString(),
        duration_seconds: dur,
        solution_release_policy: schedPolicy,
      };
      if (schedBatchIds.length === 1) body.batch_id = schedBatchIds[0];
      else if (schedBatchIds.length > 1) body.batch_ids = schedBatchIds;
      const r = await examFetch('/exams/schedule', { method: 'POST', body: JSON.stringify(body) });
      Alert.alert('Scheduled', `"${r.exam.title}" scheduled for ${new Date(r.exam.scheduled_at).toLocaleString()}`);
      setView('questions');
    } catch (e: any) { Alert.alert('Schedule Error', e.message); }
    finally { setSubmitting(false); }
  };

  const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const fmtTime = (d: Date) => d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12: true });

  const sectionQs = useMemo(
    () => paperQuestions.filter((q) => q.section_code === activeSection),
    [paperQuestions, activeSection],
  );

  // LIST
  if (view === 'list') return (
    <View style={s.root}>
      <View style={s.listHeader}>
        <TouchableOpacity style={s.createBtn} onPress={() => setView('create')}><Text style={s.createBtnTxt}>+ New Paper</Text></TouchableOpacity>
        <TouchableOpacity style={s.refreshBtn} onPress={fetchPapers}><Text style={s.refreshBtnTxt}>↺</Text></TouchableOpacity>
      </View>
      {loading ? <View style={s.ctr}><ActivityIndicator size="large" color={T.primary} /></View> : (
        <FlatList data={papers} keyExtractor={(i) => i.id.toString()} contentContainerStyle={s.list}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item }) => (
            <TouchableOpacity style={s.paperCard} onPress={() => openPaper(item)} activeOpacity={0.75}>
              <View style={s.paperRow}>
                <Text style={s.paperTitle} numberOfLines={2}>{item.title}</Text>
                <View style={[s.pill, { backgroundColor: item.status === 'ACTIVE' ? T.success : T.textMuted }]}>
                  <Text style={s.pillTxt}>{item.status}</Text>
                </View>
              </View>
              {item.category && <Text style={s.paperCat}>{item.category}</Text>}
              <Text style={s.paperMeta}>ID #{item.id}  ·  Tap to view questions →</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<View style={s.ctr}><Text style={s.empty}>No question papers yet.{'\n'}Tap "+ New Paper" to start.</Text></View>}
        />
      )}
    </View>
  );

  // CREATE
  if (view === 'create') return (
    <ScrollView style={s.root} contentContainerStyle={s.form}>
      <TouchableOpacity onPress={() => setView('list')} style={s.back}><Text style={s.backTxt}>← Back to Papers</Text></TouchableOpacity>
      <Text style={s.formTitle}>New Question Paper</Text>
      <Text style={s.lbl}>Title *</Text>
      <TextInput style={s.input} value={newTitle} onChangeText={setNewTitle} placeholder="e.g. JEE Mock 2025 — Set A" placeholderTextColor={T.textMuted} />
      <Text style={s.lbl}>Category (optional)</Text>
      <TextInput style={s.input} value={newCategory} onChangeText={setNewCategory} placeholder="e.g. JEE Advanced, NEET" placeholderTextColor={T.textMuted} />
      <View style={s.infoCard}>
        <Text style={s.infoTxt}>Creates 3 sections (Physics, Chemistry, Maths) — 30 questions each, 4 marks / −1 negative.</Text>
      </View>
      <TouchableOpacity style={[s.primaryBtn, submitting && s.btnDisabled]} disabled={submitting} onPress={handleCreatePaper}>
        {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.primaryBtnTxt}>Create Paper</Text>}
      </TouchableOpacity>
    </ScrollView>
  );

  // QUESTIONS
  if (view === 'questions' && selectedPaper) return (
    <View style={s.root}>
      <View style={s.detailHdr}>
        <TouchableOpacity onPress={() => setView('list')}><Text style={s.backTxt}>← Papers</Text></TouchableOpacity>
        <Text style={s.detailTitle} numberOfLines={1}>{selectedPaper.title}</Text>
        <TouchableOpacity style={s.schedBtn} onPress={openSchedule}><Text style={s.schedBtnTxt}>Schedule →</Text></TouchableOpacity>
      </View>
      <View style={s.secTabs}>
        {(['PHYSICS','CHEMISTRY','MATHS'] as const).map((sec) => {
          const cnt = paperQuestions.filter((q) => q.section_code === sec).length;
          return (
            <TouchableOpacity key={sec} style={[s.secTab, activeSection === sec && s.secTabActive]} onPress={() => setActiveSection(sec)}>
              <Text style={[s.secTabTxt, activeSection === sec && s.secTabTxtActive]}>{sec.slice(0,3)} ({cnt})</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {questionsLoading ? <View style={s.ctr}><ActivityIndicator size="large" color={T.primary} /></View> : (
        <FlatList data={sectionQs} keyExtractor={(i) => i.id.toString()} contentContainerStyle={s.list}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          windowSize={5}
          removeClippedSubviews
          ListHeaderComponent={
            <TouchableOpacity style={s.addQBtn} onPress={() => { setQSection(activeSection); setView('add-question'); }}>
              <Text style={s.addQBtnTxt}>+ Add {activeSection} Question</Text>
            </TouchableOpacity>
          }
          renderItem={({ item, index }) => {
            const images = (item.question_media || []).filter((m) => m.mime_type.startsWith('image/'));
            const hasText = !!item.question_text?.trim();
            const hasImg  = images.length > 0;
            return (
              <View style={s.qCard}>
                <View style={s.qCardHdr}>
                  <Text style={s.qIdx}>Q{index + 1}</Text>
                  <View style={[s.typePill, item.question_type === 'MCQ' ? s.typeMcq : s.typeInt]}>
                    <Text style={s.typeTxt}>{item.question_type}</Text>
                  </View>
                </View>
                {hasImg && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                    {images.map((m) => <MediaThumb key={m.id} media={m} token={token} />)}
                  </ScrollView>
                )}
                {hasText
                  ? <Text style={s.qTxt} numberOfLines={hasImg ? 2 : 3}>{item.question_text}</Text>
                  : !hasImg && <Text style={s.qTxtMuted}>(no text, no media)</Text>
                }
                {item.question_type === 'MCQ' && item.options?.map((o) => (
                  <Text key={o.option_label} style={[s.optPrev, o.option_label === item.correct_option_label && s.optCorrect]}>
                    {o.option_label}. {o.option_text}{o.option_label === item.correct_option_label ? '  ✓' : ''}
                  </Text>
                ))}
                {item.question_type === 'INTEGER' && (
                  <Text style={s.intAns}>Answer: {item.correct_integer_answer}</Text>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={s.empty}>No questions in this section yet.</Text>}
        />
      )}
    </View>
  );

  // ADD QUESTION
  if (view === 'add-question') return (
    <ScrollView style={s.root} contentContainerStyle={s.form}>
      <TouchableOpacity onPress={() => setView('questions')} style={s.back}><Text style={s.backTxt}>← Back</Text></TouchableOpacity>
      <Text style={s.formTitle}>Add Question</Text>
      <Text style={s.lbl}>Section</Text>
      <View style={s.row}>
        {(['PHYSICS','CHEMISTRY','MATHS'] as const).map((sec) => (
          <TouchableOpacity key={sec} style={[s.tog, qSection === sec && s.togOn]} onPress={() => setQSection(sec)}>
            <Text style={[s.togTxt, qSection === sec && s.togTxtOn]}>{sec.slice(0,4)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.lbl}>Type</Text>
      <View style={s.row}>
        {(['MCQ','INTEGER'] as const).map((t) => (
          <TouchableOpacity key={t} style={[s.tog, qType === t && s.togOn]} onPress={() => setQType(t)}>
            <Text style={[s.togTxt, qType === t && s.togTxtOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.lbl}>Question Text *</Text>
      <TextInput style={[s.input, s.multiline]} value={qText} onChangeText={setQText} placeholder="Write the question..." placeholderTextColor={T.textMuted} multiline numberOfLines={4} />
      {qType === 'MCQ' ? (
        <>
          {(['A','B','C','D'] as const).map((l) => (
            <View key={l}>
              <Text style={s.lbl}>Option {l}</Text>
              <TextInput style={s.input} value={qOptions[l]} onChangeText={(v) => setQOptions((p) => ({ ...p, [l]: v }))} placeholder={`Option ${l}`} placeholderTextColor={T.textMuted} />
            </View>
          ))}
          <Text style={s.lbl}>Correct Answer</Text>
          <View style={s.row}>
            {(['A','B','C','D'] as const).map((l) => (
              <TouchableOpacity key={l} style={[s.tog, qCorrectLabel === l && s.togCorrect]} onPress={() => setQCorrectLabel(l)}>
                <Text style={[s.togTxt, qCorrectLabel === l && s.togTxtOn]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : (
        <>
          <Text style={s.lbl}>Correct Integer *</Text>
          <TextInput style={s.input} value={qIntegerAnswer} onChangeText={setQIntegerAnswer} placeholder="e.g. 42" placeholderTextColor={T.textMuted} keyboardType="numeric" />
        </>
      )}
      <View style={s.twoCol}>
        <View style={{ flex: 1 }}><Text style={s.lbl}>Marks</Text><TextInput style={s.input} value={qMarks} onChangeText={setQMarks} keyboardType="numeric" /></View>
        <View style={{ flex: 1 }}><Text style={s.lbl}>Negative Marks</Text><TextInput style={s.input} value={qNegative} onChangeText={setQNegative} keyboardType="numeric" /></View>
      </View>
      <TouchableOpacity style={[s.primaryBtn, submitting && s.btnDisabled]} disabled={submitting} onPress={handleAddQuestion}>
        {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.primaryBtnTxt}>Add Question</Text>}
      </TouchableOpacity>
    </ScrollView>
  );

  // SCHEDULE
  if (view === 'schedule' && selectedPaper) {
    const POLICIES: { value: SolutionPolicy; label: string; desc: string }[] = [
      { value: 'AFTER_EXAM_END',       label: 'After Exam Ends',   desc: 'Visible immediately when exam closes' },
      { value: 'AFTER_RESULT_RELEASE', label: 'After Results',     desc: 'Only after teacher publishes results' },
      { value: 'NEVER',                label: 'Never',             desc: 'Solutions never shown to students' },
      { value: 'PRACTICE_UNLOCK_RULE', label: 'Practice Unlock',   desc: 'Unlock per-question after attempt' },
    ];
    return (
      <ScrollView style={s.root} contentContainerStyle={s.form}>
        <TouchableOpacity onPress={() => setView('questions')} style={s.back}><Text style={s.backTxt}>← Back</Text></TouchableOpacity>
        <Text style={s.formTitle}>Schedule Exam</Text>
        <Text style={s.schedSub}>Paper: {selectedPaper.title}</Text>

        <Text style={s.lbl}>Exam Title *</Text>
        <TextInput style={s.input} value={schedTitle} onChangeText={setSchedTitle} placeholder="e.g. JEE Mock — Batch A" placeholderTextColor={T.textMuted} />

        <Text style={s.lbl}>Mode</Text>
        <View style={s.row}>
          {(['LIVE','PRACTICE'] as const).map((m) => (
            <TouchableOpacity key={m} style={[s.tog, schedMode === m && s.togOn]} onPress={() => setSchedMode(m)}>
              <Text style={[s.togTxt, schedMode === m && s.togTxtOn]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Multi-select batches */}
        <Text style={s.lbl}>Assign to Batches</Text>
        {batches.length === 0
          ? <Text style={s.empty}>No batches found</Text>
          : (
            <View style={s.batchGrid}>
              {batches.map((b) => {
                const on = schedBatchIds.includes(b.id);
                return (
                  <TouchableOpacity key={b.id} style={[s.batchChip, on && s.batchChipOn]} onPress={() => toggleBatch(b.id)}>
                    <View style={[s.chkBox, on && s.chkBoxOn]}>
                      {on && <Text style={s.chkMark}>✓</Text>}
                    </View>
                    <Text style={[s.batchChipTxt, on && s.batchChipTxtOn]}>{b.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        {schedBatchIds.length > 0 && <Text style={s.batchSel}>{schedBatchIds.length} batch{schedBatchIds.length > 1 ? 'es' : ''} selected</Text>}

        {/* Date & Time */}
        <Text style={s.lbl}>Date & Time</Text>
        <View style={s.dtRow}>
          <TouchableOpacity style={s.dtBtn} onPress={() => setShowDatePicker(true)}>
            <Text style={s.dtLbl}>DATE</Text>
            <Text style={s.dtVal}>{fmtDate(schedDate)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dtBtn} onPress={() => setShowTimePicker(true)}>
            <Text style={s.dtLbl}>TIME</Text>
            <Text style={s.dtVal}>{fmtTime(schedDate)}</Text>
          </TouchableOpacity>
        </View>
        {showDatePicker && (
          <DateTimePicker value={schedDate} mode="date" display="default" minimumDate={new Date()}
            onChange={(_: DateTimePickerEvent, d?: Date) => {
              setShowDatePicker(false);
              if (d) setSchedDate((p) => { const n = new Date(d); n.setHours(p.getHours(), p.getMinutes(), 0, 0); return n; });
            }}
          />
        )}
        {showTimePicker && (
          <DateTimePicker value={schedDate} mode="time" display="default" is24Hour={false}
            onChange={(_: DateTimePickerEvent, d?: Date) => {
              setShowTimePicker(false);
              if (d) setSchedDate((p) => { const n = new Date(p); n.setHours(d.getHours(), d.getMinutes(), 0, 0); return n; });
            }}
          />
        )}

        {/* Duration drum rollers */}
        <Text style={s.lbl}>Duration</Text>
        <View style={s.drumRow}>
          <View style={s.drumUnit}>
            <DrumRoller min={0} max={12} value={schedHrs} onChange={setSchedHrs} />
            <Text style={s.drumLbl}>Hours</Text>
          </View>
          <Text style={s.drumSep}>:</Text>
          <View style={s.drumUnit}>
            <DrumRoller min={0} max={59} value={schedMins} onChange={setSchedMins} />
            <Text style={s.drumLbl}>Mins</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
            <Text style={s.durTotal}>{schedHrs}h {String(schedMins).padStart(2,'0')}m</Text>
            <Text style={s.durSecs}>{(schedHrs*3600+schedMins*60).toLocaleString()} seconds</Text>
          </View>
        </View>

        {/* Solution release policy */}
        <Text style={s.lbl}>Solution Release Policy</Text>
        {POLICIES.map((p) => (
          <TouchableOpacity key={p.value} style={[s.policyCard, schedPolicy === p.value && s.policyCardOn]} onPress={() => setSchedPolicy(p.value)}>
            <View style={s.policyRow}>
              <View style={[s.radio, schedPolicy === p.value && s.radioOn]}>
                {schedPolicy === p.value && <View style={s.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.policyLbl, schedPolicy === p.value && s.policyLblOn]}>{p.label}</Text>
                <Text style={s.policyDesc}>{p.desc}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={[s.primaryBtn, submitting && s.btnDisabled]} disabled={submitting} onPress={handleSchedule}>
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.primaryBtnTxt}>Schedule Exam</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return null;
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: T.bg },
  ctr:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  list:       { padding: 16 },
  form:       { padding: 20, paddingBottom: 60 },

  listHeader: { flexDirection: 'row', padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.surface },
  createBtn:  { flex: 1, backgroundColor: T.primary, borderRadius: T.radiusSm, paddingVertical: 10, alignItems: 'center' },
  createBtnTxt:{ color: '#fff', fontWeight: '800', fontSize: 14 },
  refreshBtn: { backgroundColor: T.surfaceAlt, borderRadius: T.radiusSm, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: T.border },
  refreshBtnTxt:{ color: T.textSecondary, fontSize: 18 },

  paperCard:  { backgroundColor: T.surface, borderRadius: T.radius, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: T.border, elevation: 2, shadowColor: T.shadowColor, shadowOffset: { width:0,height:2 }, shadowOpacity:0.06, shadowRadius:4 },
  paperRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  paperTitle: { fontSize: 15, fontWeight: '700', color: T.textPrimary, flex: 1, marginRight: 8 },
  pill:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillTxt:    { color: '#fff', fontSize: 10, fontWeight: '800' },
  paperCat:   { color: T.primaryMid, fontSize: 12, marginBottom: 4, fontWeight: '600' },
  paperMeta:  { color: T.textMuted, fontSize: 12 },
  empty:      { color: T.textMuted, textAlign: 'center', fontSize: 14, marginTop: 40, lineHeight: 22 },

  detailHdr:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.surface },
  detailTitle:{ flex: 1, color: T.textPrimary, fontWeight: '700', fontSize: 14, marginHorizontal: 8 },
  schedBtn:   { backgroundColor: T.primary, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  schedBtnTxt:{ color: '#fff', fontWeight: '800', fontSize: 12 },

  secTabs:    { flexDirection: 'row', backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border },
  secTab:     { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  secTabActive:{ borderBottomColor: T.primary },
  secTabTxt:  { fontSize: 12, fontWeight: '700', color: T.textMuted },
  secTabTxtActive:{ color: T.primary },

  addQBtn:    { backgroundColor: T.primary, borderRadius: T.radiusSm, padding: 12, alignItems: 'center', marginBottom: 12 },
  addQBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  qCard:      { backgroundColor: T.surface, borderRadius: T.radiusSm, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: T.border, elevation: 1, shadowColor: T.shadowColor, shadowOffset:{width:0,height:1}, shadowOpacity:0.04, shadowRadius:2 },
  qCardHdr:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  qIdx:       { color: T.primary, fontSize: 13, fontWeight: '800' },
  typePill:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  typeMcq:    { backgroundColor: T.infoBg },
  typeInt:    { backgroundColor: T.primaryLight },
  typeTxt:    { fontSize: 10, fontWeight: '800', color: T.textSecondary },
  thumb:      { width: 80, height: 60, borderRadius: 6, marginRight: 6, backgroundColor: T.surfaceAlt },
  qTxt:       { color: T.textPrimary, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  qTxtMuted:  { color: T.textMuted, fontSize: 13, fontStyle: 'italic', marginBottom: 8 },
  optPrev:    { color: T.textSecondary, fontSize: 12, marginBottom: 2 },
  optCorrect: { color: T.success, fontWeight: '700' },
  intAns:     { color: T.success, fontWeight: '700', fontSize: 13 },

  formTitle:  { fontSize: 20, fontWeight: '800', color: T.textPrimary, marginBottom: 4, marginTop: 8 },
  schedSub:   { color: T.textMuted, fontSize: 13, marginBottom: 20 },
  back:       { marginBottom: 4 },
  backTxt:    { color: T.primary, fontSize: 14, fontWeight: '600' },
  lbl:        { color: T.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input:      { backgroundColor: T.surface, borderRadius: T.radiusSm, padding: 12, color: T.textPrimary, fontSize: 14, borderWidth: 1, borderColor: T.border },
  multiline:  { minHeight: 100, textAlignVertical: 'top' },
  row:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  tog:        { backgroundColor: T.surface, borderRadius: T.radiusSm, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: T.border },
  togOn:      { backgroundColor: T.primary, borderColor: T.primary },
  togCorrect: { backgroundColor: T.success, borderColor: T.success },
  togTxt:     { color: T.textSecondary, fontSize: 13, fontWeight: '600' },
  togTxtOn:   { color: '#fff' },
  twoCol:     { flexDirection: 'row', gap: 12 },
  infoCard:   { backgroundColor: T.infoBg, borderRadius: T.radiusSm, padding: 12, borderWidth: 1, borderColor: '#BFDBFE', marginTop: 14 },
  infoTxt:    { color: '#1D4ED8', fontSize: 13, lineHeight: 18 },
  primaryBtn: { backgroundColor: T.primary, borderRadius: T.radius, padding: 16, alignItems: 'center', marginTop: 24 },
  btnDisabled:{ opacity: 0.5 },
  primaryBtnTxt:{ color: '#fff', fontWeight: '800', fontSize: 16 },

  // Batch
  batchGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  batchChip:  { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: T.radiusSm, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: T.border, gap: 6 },
  batchChipOn:{ borderColor: T.primary, backgroundColor: T.primaryLight },
  chkBox:     { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: T.border, backgroundColor: T.surface, justifyContent: 'center', alignItems: 'center' },
  chkBoxOn:   { borderColor: T.primary, backgroundColor: T.primary },
  chkMark:    { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 14 },
  batchChipTxt:{ color: T.textSecondary, fontSize: 13, fontWeight: '600' },
  batchChipTxtOn:{ color: T.primary },
  batchSel:   { color: T.primaryMid, fontSize: 12, fontWeight: '600', marginTop: 4 },

  // Date/time
  dtRow:      { flexDirection: 'row', gap: 12, marginBottom: 4 },
  dtBtn:      { flex: 1, backgroundColor: T.surface, borderRadius: T.radiusSm, borderWidth: 1, borderColor: T.border, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center' },
  dtLbl:      { fontSize: 10, color: T.textMuted, fontWeight: '800', marginBottom: 4, letterSpacing: 0.5 },
  dtVal:      { fontSize: 14, color: T.textPrimary, fontWeight: '700' },

  // Drum
  drumRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, marginBottom: 4 },
  drumUnit:   { alignItems: 'center', gap: 6 },
  drumLbl:    { fontSize: 10, color: T.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  drumSep:    { fontSize: 32, fontWeight: '800', color: T.textSecondary, marginHorizontal: 4, marginBottom: 20 },
  durTotal:   { fontSize: 22, fontWeight: '800', color: T.primary },
  durSecs:    { fontSize: 11, color: T.textMuted, marginTop: 2 },

  // Policy
  policyCard: { backgroundColor: T.surface, borderRadius: T.radiusSm, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: T.border },
  policyCardOn:{ borderColor: T.primary, backgroundColor: T.primaryLight },
  policyRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  radio:      { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: T.border, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  radioOn:    { borderColor: T.primary },
  radioDot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: T.primary },
  policyLbl:  { fontSize: 14, fontWeight: '700', color: T.textPrimary },
  policyLblOn:{ color: T.primary },
  policyDesc: { fontSize: 12, color: T.textMuted, marginTop: 2 },
});
