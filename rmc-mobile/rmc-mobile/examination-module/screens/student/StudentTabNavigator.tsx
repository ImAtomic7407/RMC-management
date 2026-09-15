import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar } from 'react-native';
import { StudentExamList } from './StudentExamList';
import { StudentPracticeLibrary } from './StudentPracticeLibrary';
import { StudentResultsTab } from './StudentResultsTab';
import { T } from '../../theme';

type Tab = 'live' | 'practice' | 'results';

export function StudentTabNavigator({ navigation }: { navigation: any }) {
  const [activeTab, setActiveTab] = useState<Tab>('live');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={T.surface} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>RMC Examinations</Text>
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'live' && styles.activeTab]}
            onPress={() => setActiveTab('live')}
          >
            <Text style={[styles.tabText, activeTab === 'live' && styles.activeTabText]}>
              Live & Scheduled
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'practice' && styles.activeTab]}
            onPress={() => setActiveTab('practice')}
          >
            <Text style={[styles.tabText, activeTab === 'practice' && styles.activeTabText]}>
              Practice
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'results' && styles.activeTab]}
            onPress={() => setActiveTab('results')}
          >
            <Text style={[styles.tabText, activeTab === 'results' && styles.activeTabText]}>
              My Results
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        {activeTab === 'live' && <StudentExamList navigation={navigation} headerless />}
        {activeTab === 'practice' && <StudentPracticeLibrary navigation={navigation} />}
        {activeTab === 'results' && <StudentResultsTab navigation={navigation} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: {
    backgroundColor: T.surface,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 0,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: T.textPrimary,
    marginBottom: 12,
  },
  tabBar: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: T.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: T.textMuted,
  },
  activeTabText: {
    color: T.primary,
  },
  content: { flex: 1 },
});
