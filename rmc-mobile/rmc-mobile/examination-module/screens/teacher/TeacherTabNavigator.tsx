import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { TeacherDashboard } from './TeacherDashboard';
import { QuestionPaperManager } from './QuestionPaperManager';
import { TeacherHistoryTab } from './TeacherHistoryTab';
import { T } from '../../theme';

type Tab = 'papers' | 'conduct' | 'history';

export function TeacherTabNavigator({ navigation }: { navigation: any }) {
  const [activeTab, setActiveTab] = useState<Tab>('papers');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'papers', label: 'Question Papers' },
    { key: 'conduct', label: 'Conduct' },
    { key: 'history', label: 'History' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={T.surface} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Exam Management</Text>
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.activeTab]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.content}>
        {activeTab === 'papers' && <QuestionPaperManager navigation={navigation} />}
        {activeTab === 'conduct' && <TeacherDashboard navigation={navigation} headerless />}
        {activeTab === 'history' && <TeacherHistoryTab navigation={navigation} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: T.bg },
  header:      { backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 0 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: T.textPrimary, marginBottom: 12 },
  tabBar:      { flexDirection: 'row' },
  tab:         { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab:   { borderBottomColor: T.primary },
  tabText:     { fontSize: 12, fontWeight: '700', color: T.textMuted },
  activeTabText:{ color: T.primary },
  content:     { flex: 1 },
});
