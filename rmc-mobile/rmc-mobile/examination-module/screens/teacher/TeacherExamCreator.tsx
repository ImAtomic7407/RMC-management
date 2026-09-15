import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from 'react-native';
import { examFetch } from '../../services/api';

interface Batch {
  id: number;
  name: string;
}

export function TeacherExamCreator({ navigation }: { navigation: any }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  // Form Fields
  const [title, setTitle] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState('180');
  const [examMode, setExamMode] = useState<'LIVE' | 'PRACTICE'>('LIVE');
  const [instructions, setInstructions] = useState('');

  // Default marks configurations
  const [phyCount, setPhyCount] = useState('10');
  const [phyMarks, setPhyMarks] = useState('4');
  const [phyNegative, setPhyNegative] = useState('1');

  const [chemCount, setChemCount] = useState('10');
  const [chemMarks, setChemMarks] = useState('4');
  const [chemNegative, setChemNegative] = useState('1');

  const [mathCount, setMathCount] = useState('10');
  const [mathMarks, setMathMarks] = useState('4');
  const [mathNegative, setMathNegative] = useState('1');

  const fetchBatches = async () => {
    try {
      const response = await examFetch('/identity/batches');
      const loadedBatches = response.batches || [];
      setBatches(loadedBatches);
      if (loadedBatches.length > 0) {
        setSelectedBatchId(loadedBatches[0].id);
      }
    } catch (err: any) {
      Alert.alert('Load Error', err.message || 'Failed to fetch student batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  const handleCreateExam = async () => {
    if (!title.trim()) {
      Alert.alert('Validation Error', 'Exam title is required.');
      return;
    }
    if (!selectedBatchId) {
      Alert.alert('Validation Error', 'Please select a batch.');
      return;
    }

    try {
      setLoading(true);

      const requestBody = {
        title: title.trim(),
        batch_id: selectedBatchId,
        exam_mode: examMode,
        duration_seconds: parseInt(durationMins, 10) * 60,
        instructions: instructions.trim() || null,
        exam_date_time: new Date().toISOString(), // Defaulting to now
        solution_release_policy: 'AFTER_EXAM_END',
        sections: [
          {
            section_code: 'PHYSICS',
            question_count_target: parseInt(phyCount, 10),
            default_marks: parseFloat(phyMarks),
            default_negative_marks: parseFloat(phyNegative),
          },
          {
            section_code: 'CHEMISTRY',
            question_count_target: parseInt(chemCount, 10),
            default_marks: parseFloat(chemMarks),
            default_negative_marks: parseFloat(chemNegative),
          },
          {
            section_code: 'MATHS',
            question_count_target: parseInt(mathCount, 10),
            default_marks: parseFloat(mathMarks),
            default_negative_marks: parseFloat(mathNegative),
          },
        ],
      };

      await examFetch('/exams', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      Alert.alert('Success', 'Exam created successfully');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Creation Failed', err.message || 'Failed to save exam.');
    } finally {
      setLoading(false);
    }
  };

  if (loading && batches.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading batches metadata...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionHeader}>Basic Settings</Text>

        <Text style={styles.label}>Exam Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. JEE Mains Test 1"
          placeholderTextColor="#64748B"
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.label}>Select Student Batch</Text>
        <View style={styles.pickerContainer}>
          {batches.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[
                styles.pickerItem,
                selectedBatchId === b.id && styles.activePickerItem,
              ]}
              onPress={() => setSelectedBatchId(b.id)}
            >
              <Text
                style={[
                  styles.pickerItemText,
                  selectedBatchId === b.id && styles.activePickerItemText,
                ]}
              >
                {b.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.row}>
          <View style={styles.flexHalf}>
            <Text style={styles.label}>Duration (minutes)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={durationMins}
              onChangeText={setDurationMins}
            />
          </View>

          <View style={styles.flexHalf}>
            <Text style={styles.label}>Exam Mode</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  examMode === 'LIVE' && styles.activeModeButton,
                ]}
                onPress={() => setExamMode('LIVE')}
              >
                <Text style={styles.modeButtonText}>LIVE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  examMode === 'PRACTICE' && styles.activeModeButton,
                ]}
                onPress={() => setExamMode('PRACTICE')}
              >
                <Text style={styles.modeButtonText}>PRACTICE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.label}>Instructions</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          multiline
          placeholder="General rules..."
          placeholderTextColor="#64748B"
          value={instructions}
          onChangeText={setInstructions}
        />

        <Text style={styles.sectionHeader}>Section Specifications</Text>

        {/* Physics Specs */}
        <Text style={styles.sectionTitle}>⚛️ Physics Section</Text>
        <View style={styles.row}>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Questions</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={phyCount} onChangeText={setPhyCount} />
          </View>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Marks (+)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={phyMarks} onChangeText={setPhyMarks} />
          </View>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Negative (-)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={phyNegative} onChangeText={setPhyNegative} />
          </View>
        </View>

        {/* Chemistry Specs */}
        <Text style={styles.sectionTitle}>🧪 Chemistry Section</Text>
        <View style={styles.row}>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Questions</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={chemCount} onChangeText={setChemCount} />
          </View>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Marks (+)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={chemMarks} onChangeText={setChemMarks} />
          </View>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Negative (-)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={chemNegative} onChangeText={setChemNegative} />
          </View>
        </View>

        {/* Maths Specs */}
        <Text style={styles.sectionTitle}>📐 Mathematics Section</Text>
        <View style={styles.row}>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Questions</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={mathCount} onChangeText={setMathCount} />
          </View>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Marks (+)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={mathMarks} onChangeText={setMathMarks} />
          </View>
          <View style={styles.flexThird}>
            <Text style={styles.subLabel}>Negative (-)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={mathNegative} onChangeText={setMathNegative} />
          </View>
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleCreateExam}>
          <Text style={styles.submitBtnText}>Create Draft Exam</Text>
        </TouchableOpacity>
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
  sectionHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#E2E8F0',
    marginTop: 16,
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 6,
    marginTop: 12,
  },
  subLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#F8FAFC',
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  multilineInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  flexHalf: {
    width: '48%',
  },
  flexThird: {
    width: '31%',
  },
  modeButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    marginRight: 6,
  },
  activeModeButton: {
    borderColor: '#3B82F6',
    backgroundColor: '#1E293B',
  },
  modeButtonText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  pickerItem: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  activePickerItem: {
    borderColor: '#3B82F6',
    backgroundColor: '#3E4E68',
  },
  pickerItemText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  activePickerItemText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
  submitBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 40,
  },
  submitBtnText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 12,
  },
});
