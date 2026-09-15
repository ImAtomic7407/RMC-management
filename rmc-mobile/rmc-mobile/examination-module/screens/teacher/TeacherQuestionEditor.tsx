import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from 'react-native';
import { examFetch } from '../../services/api';

interface Option {
  id?: number;
  option_label: 'A' | 'B' | 'C' | 'D';
  option_text: string;
  is_correct?: boolean;
}

interface Question {
  id: number;
  section_code: 'PHYSICS' | 'CHEMISTRY' | 'MATHS';
  question_type: 'MCQ' | 'INTEGER';
  question_text: string;
  correct_integer_answer?: string;
  options?: Option[];
}

export function TeacherQuestionEditor({ route }: { route: any }) {
  const { paperId } = route.params;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states for adding a new question
  const [activeSection, setActiveSection] = useState<'PHYSICS' | 'CHEMISTRY' | 'MATHS'>('PHYSICS');
  const [questionType, setQuestionType] = useState<'MCQ' | 'INTEGER'>('MCQ');
  const [questionText, setQuestionText] = useState('');

  // MCQ state
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [optD, setOptD] = useState('');
  const [correctOption, setCorrectOption] = useState<'A' | 'B' | 'C' | 'D'>('A');

  // Integer state
  const [correctInt, setCorrectInt] = useState('');

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const response = await examFetch(`/question-papers/${paperId}/questions`);
      setQuestions(response.questions || response || []);
    } catch (err: any) {
      Alert.alert('Load Error', err.message || 'Failed to fetch paper questions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [paperId]);

  const handleAddQuestion = async () => {
    if (!questionText.trim()) {
      Alert.alert('Validation Error', 'Question body text is required.');
      return;
    }

    const payload: any = {
      section_code: activeSection,
      question_type: questionType,
      question_text: questionText.trim(),
    };

    if (questionType === 'MCQ') {
      if (!optA.trim() || !optB.trim() || !optC.trim() || !optD.trim()) {
        Alert.alert('Validation Error', 'Please fill in all 4 MCQ options.');
        return;
      }
      payload.options = [
        { option_label: 'A', option_text: optA.trim() },
        { option_label: 'B', option_text: optB.trim() },
        { option_label: 'C', option_text: optC.trim() },
        { option_label: 'D', option_text: optD.trim() },
      ];
      payload.correct_option_label = correctOption;
    } else {
      if (!correctInt.trim()) {
        Alert.alert('Validation Error', 'Please enter a valid correct integer value.');
        return;
      }
      payload.correct_integer_answer = correctInt.trim();
    }

    try {
      setLoading(true);
      await examFetch(`/question-papers/${paperId}/questions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      Alert.alert('Success', 'Question added to paper');
      // Clear form
      setQuestionText('');
      setOptA('');
      setOptB('');
      setOptC('');
      setOptD('');
      setCorrectInt('');
      fetchQuestions();
    } catch (err: any) {
      Alert.alert('Failed to Add', err.message || 'Server rejected question payload');
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>Paper Question Registry</Text>

        {/* Section Tabs */}
        <View style={styles.sectionTabs}>
          {(['PHYSICS', 'CHEMISTRY', 'MATHS'] as const).map((sec) => (
            <TouchableOpacity
              key={sec}
              style={[styles.sectionTab, activeSection === sec && styles.activeSectionTab]}
              onPress={() => setActiveSection(sec)}
            >
              <Text
                style={[
                  styles.sectionTabText,
                  activeSection === sec && styles.activeSectionTabText,
                ]}
              >
                {sec}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Form: Add Question */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>➕ Add Question to {activeSection}</Text>

          <Text style={styles.label}>Question Type</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.typeBtn, questionType === 'MCQ' && styles.activeTypeBtn]}
              onPress={() => setQuestionType('MCQ')}
            >
              <Text style={styles.typeBtnText}>Multiple Choice (MCQ)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, questionType === 'INTEGER' && styles.activeTypeBtn]}
              onPress={() => setQuestionType('INTEGER')}
            >
              <Text style={styles.typeBtnText}>Integer Type</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Question Text</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            multiline
            placeholder="Type the question details..."
            placeholderTextColor="#64748B"
            value={questionText}
            onChangeText={setQuestionText}
          />

          {questionType === 'MCQ' ? (
            <View>
              <Text style={styles.label}>Configure MCQ Options & Correct Answer</Text>
              {/* Option A */}
              <View style={styles.optionInputRow}>
                <TouchableOpacity
                  style={[
                    styles.radioCircle,
                    correctOption === 'A' && styles.radioCircleSelected,
                  ]}
                  onPress={() => setCorrectOption('A')}
                >
                  <Text style={styles.radioLabel}>A</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, styles.flexInput]}
                  placeholder="Option A description..."
                  placeholderTextColor="#64748B"
                  value={optA}
                  onChangeText={setOptA}
                />
              </View>

              {/* Option B */}
              <View style={styles.optionInputRow}>
                <TouchableOpacity
                  style={[
                    styles.radioCircle,
                    correctOption === 'B' && styles.radioCircleSelected,
                  ]}
                  onPress={() => setCorrectOption('B')}
                >
                  <Text style={styles.radioLabel}>B</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, styles.flexInput]}
                  placeholder="Option B description..."
                  placeholderTextColor="#64748B"
                  value={optB}
                  onChangeText={setOptB}
                />
              </View>

              {/* Option C */}
              <View style={styles.optionInputRow}>
                <TouchableOpacity
                  style={[
                    styles.radioCircle,
                    correctOption === 'C' && styles.radioCircleSelected,
                  ]}
                  onPress={() => setCorrectOption('C')}
                >
                  <Text style={styles.radioLabel}>C</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, styles.flexInput]}
                  placeholder="Option C description..."
                  placeholderTextColor="#64748B"
                  value={optC}
                  onChangeText={setOptC}
                />
              </View>

              {/* Option D */}
              <View style={styles.optionInputRow}>
                <TouchableOpacity
                  style={[
                    styles.radioCircle,
                    correctOption === 'D' && styles.radioCircleSelected,
                  ]}
                  onPress={() => setCorrectOption('D')}
                >
                  <Text style={styles.radioLabel}>D</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, styles.flexInput]}
                  placeholder="Option D description..."
                  placeholderTextColor="#64748B"
                  value={optD}
                  onChangeText={setOptD}
                />
              </View>
            </View>
          ) : (
            <View>
              <Text style={styles.label}>Correct Integer Answer</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 5 or -10"
                placeholderTextColor="#64748B"
                value={correctInt}
                onChangeText={setCorrectInt}
                keyboardType="numeric"
              />
            </View>
          )}

          <TouchableOpacity style={styles.submitBtn} onPress={handleAddQuestion}>
            <Text style={styles.submitBtnText}>Add Question</Text>
          </TouchableOpacity>
        </View>

        {/* List of Existing Questions */}
        <Text style={styles.sectionHeader}>Existing Questions</Text>
        {loading ? (
          <ActivityIndicator size="large" color="#3B82F6" />
        ) : questions.filter((q) => q.section_code === activeSection).length === 0 ? (
          <Text style={styles.emptyText}>No questions added to this section yet.</Text>
        ) : (
          questions
            .filter((q) => q.section_code === activeSection)
            .map((q, idx) => (
              <View key={q.id} style={styles.questionCard}>
                <Text style={styles.qNum}>Q{idx + 1} ({q.question_type})</Text>
                <Text style={styles.qText}>{q.question_text}</Text>

                {q.question_type === 'MCQ' ? (
                  <View style={styles.existingOptions}>
                    {q.options?.map((opt) => (
                      <View
                        key={opt.id}
                        style={[
                          styles.existingOptionCard,
                          opt.is_correct && styles.correctOptionCard,
                        ]}
                      >
                        <Text style={styles.optLabel}>{opt.option_label}: </Text>
                        <Text style={styles.optText}>{opt.option_text}</Text>
                        {opt.is_correct && <Text style={styles.correctCheck}>✓ CORRECT</Text>}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.correctAnswerText}>
                    Correct Answer: <Text style={styles.correctAnswerVal}>{q.correct_integer_answer}</Text>
                  </Text>
                )}
              </View>
            ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTabs: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sectionTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  activeSectionTab: {
    backgroundColor: '#3B82F6',
  },
  sectionTabText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#94A3B8',
  },
  activeSectionTabText: {
    color: '#F8FAFC',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#F8FAFC',
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  multilineInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  typeBtn: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    marginRight: 6,
  },
  activeTypeBtn: {
    borderColor: '#3B82F6',
    backgroundColor: '#3B82F6',
  },
  typeBtnText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: 'bold',
  },
  optionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  radioCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 12,
  },
  radioCircleSelected: {
    borderColor: '#10B981',
    backgroundColor: '#10B981',
  },
  radioLabel: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
  flexInput: {
    flex: 1,
  },
  submitBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  submitBtnText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 16,
  },
  questionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  qNum: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginBottom: 6,
  },
  qText: {
    fontSize: 15,
    color: '#F8FAFC',
    lineHeight: 22,
    marginBottom: 12,
  },
  existingOptions: {
    marginTop: 8,
  },
  existingOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  correctOptionCard: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  optLabel: {
    color: '#3B82F6',
    fontWeight: 'bold',
  },
  optText: {
    color: '#94A3B8',
    flex: 1,
  },
  correctCheck: {
    color: '#10B981',
    fontWeight: 'bold',
    fontSize: 11,
  },
  correctAnswerText: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 6,
  },
  correctAnswerVal: {
    color: '#10B981',
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 20,
  },
});
