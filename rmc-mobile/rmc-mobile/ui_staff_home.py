import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace Staff Home
sh_regex = r'const renderStaffHome = \(\) => \(\s*<ScrollView.*?>\s*<View style=\{styles\.heroBranding\}>.*?</SectionCard>\s*</ScrollView>\s*\);'
# Wait, the regex might be tricky. Let's try to match from contentContainerStyle={styles.content}> to the end of the scrollview.
# Actually I'll use a simpler approach: replace the inner content of renderStaffHome.

# I'll first define the new styles for Staff context
new_styles = '''
  staffHero: { marginBottom: 24, marginTop: 10 },
  staffHeroTitle: { color: '#111827', fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  staffHeroSub: { color: '#6B7280', fontSize: 13, fontWeight: '600', marginTop: 4 },
  staffKpiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 24 },
  staffKpiCard: { width: '48%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2 },
  staffKpiValue: { color: '#0D4E35', fontSize: 24, fontWeight: '900' },
  staffKpiLabel: { color: '#6B7280', fontSize: 11, fontWeight: '800', marginTop: 4, textTransform: 'uppercase' },
'''

code = code.replace("idCardPro: {", new_styles + "\n  idCardPro: {")

# Now re-route renderStaffHome
sh_content_regex = r'const renderStaffHome = \(\) => \(\s*<ScrollView.*?>\s*(.*?)\s*</ScrollView>\s*\);'
new_staff_home = '''const renderStaffHome = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.staffHero}>
        <Text style={styles.staffHeroTitle}>Command Center</Text>
        <Text style={styles.staffHeroSub}>Welcome back, {session?.type === 'staff' ? (session.user.full_name || session.user.username) : 'Staff'}</Text>
      </View>

      {currentSession ? (
        <View style={{ backgroundColor: '#111827', borderRadius: 24, padding: 24, marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
             <Text style={{ color: '#E4EBE5', fontSize: 18, fontWeight: '800' }}>Active Session</Text>
             <View style={{ backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '900' }}>LIVE</Text>
             </View>
          </View>
          <Text style={{ color: '#8EA496', fontSize: 14, marginBottom: 20 }}>{currentSession.session_name} is active for {currentSession.batch_id}.</Text>
          <View style={{ gap: 12 }}>
            <PrimaryButton title="Scan Student QR" onPress={() => setAttendanceScannerVisible(true)} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
               <View style={{ flex: 1 }}><PrimaryButton title="Manual Roll" onPress={() => setStaffTab('attendance')} tone="secondary" /></View>
               <View style={{ flex: 1 }}><PrimaryButton title="Stop" onPress={closeAttendanceSession} tone="danger" /></View>
            </View>
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 3, marginBottom: 24 }}>
           <Text style={{ color: '#111827', fontSize: 18, fontWeight: '800', marginBottom: 6 }}>Quick Setup</Text>
           <Text style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>Start a new attendance session to begin verification.</Text>
           <PillTabs items={batches.map((batch) => ({ key: batch.name, label: batch.name }))} value={selectedBatch} onChange={setSelectedBatch} />
           <View style={{ marginTop: 16 }}>
             <PrimaryButton title="Start Attendance" onPress={startAttendanceSession} disabled={!selectedBatch} />
           </View>
        </View>
      )}

      <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 16, marginLeft: 4 }}>INSTITUTE KPI</Text>
      <View style={styles.staffKpiGrid}>
         <View style={styles.staffKpiCard}>
            <Text style={styles.staffKpiValue}>{staffSummary.totalStudents}</Text>
            <Text style={styles.staffKpiLabel}>Students</Text>
         </View>
         <View style={styles.staffKpiCard}>
            <Text style={styles.staffKpiValue}>{batches.length}</Text>
            <Text style={styles.staffKpiLabel}>Batches</Text>
         </View>
         <View style={styles.staffKpiCard}>
            <Text style={[styles.staffKpiValue, { color: staffSummary.unreadLeads > 0 ? '#10B981' : '#0D4E35' }]}>{staffSummary.unreadLeads}</Text>
            <Text style={styles.staffKpiLabel}>leads</Text>
         </View>
         <View style={styles.staffKpiCard}>
            <Text style={styles.staffKpiValue}>{systemStats?.sms_balance || '0'}</Text>
            <Text style={styles.staffKpiLabel}>SMS PUSH</Text>
         </View>
      </View>

      <View style={{ backgroundColor: '#E4EBE5', borderRadius: 24, padding: 24, marginBottom: 32 }}>
         <Text style={{ color: '#0D4E35', fontSize: 16, fontWeight: '800' }}>Cloud Storage</Text>
         <Text style={{ color: '#111827', fontSize: 24, fontWeight: '900', marginTop: 4 }}>{systemStats?.db_size ? formatBytes(systemStats.db_size) : 'Calcul...'}</Text>
         <Text style={{ color: '#6B7280', fontSize: 11, fontWeight: '800', marginTop: 4 }}>AES-256 ENCRYPTED DATABASE</Text>
      </View>
    </ScrollView>
  );'''

code = re.sub(sh_content_regex, new_staff_home, code, flags=re.DOTALL)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Applied Staff Portal modernization.")

