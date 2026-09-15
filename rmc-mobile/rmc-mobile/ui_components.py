import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Define new styles
new_styles = '''
  quickActionCard: { width: '31%', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, alignItems: 'center', shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2 },
  quickActionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E4EBE5', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  quickActionText: { color: '#111827', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  studentHeaderRow: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, alignItems: 'center', shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2, marginBottom: 24, marginTop: 10 },
  studentAvatarBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0D4E35', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  studentAvatarText: { color: '#FFF', fontSize: 20 },
  studentInfoCol: { flex: 1 },
  studentNameHeader: { color: '#111827', fontSize: 16, fontWeight: '900' },
  studentIdHeader: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  studentBatchPill: { backgroundColor: '#E4EBE5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  studentBatchText: { color: '#0D4E35', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
'''

code = code.replace("quickActionCard:", "//").replace("idCardPro: {", new_styles + "\n  idCardPro: {")


# Now replace renderStudentOverview
overview_regex = r'const renderStudentOverview = \(\) => \(\s*<>.*?</>\s*\);'
new_overview = '''const renderStudentOverview = () => (
    <>
      <View style={{ marginBottom: 16 }}>
        <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 8, marginLeft: 4 }}>MEMBER CARD</Text>
        {session?.type === 'student' ? <DigitalIdCard student={session.student} /> : null}
      </View>
      
      <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginTop: 16, marginBottom: 8, marginLeft: 4 }}>QUICK ACTIONS</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 24 }}>
          <Pressable style={styles.quickActionCard} onPress={() => setStudentTab('overview')}>
            <View style={styles.quickActionIcon}><Text style={{ fontSize: 20 }}>??</Text></View>
            <Text style={styles.quickActionText}>View Notes</Text>
          </Pressable>
          <Pressable style={styles.quickActionCard} onPress={() => setStudentTab('doubts')}>
            <View style={styles.quickActionIcon}><Text style={{ fontSize: 20 }}>?</Text></View>
            <Text style={styles.quickActionText}>Ask Doubt</Text>
          </Pressable>
          <Pressable style={styles.quickActionCard}>
            <View style={styles.quickActionIcon}><Text style={{ fontSize: 20 }}>??</Text></View>
            <Text style={styles.quickActionText}>Schedule</Text>
          </Pressable>
          <Pressable style={styles.quickActionCard}>
            <View style={styles.quickActionIcon}><Text style={{ fontSize: 20 }}>??</Text></View>
            <Text style={styles.quickActionText}>Results</Text>
          </Pressable>
          <Pressable style={styles.quickActionCard}>
            <View style={styles.quickActionIcon}><Text style={{ fontSize: 20 }}>??</Text></View>
            <Text style={styles.quickActionText}>Assignments</Text>
          </Pressable>
          <Pressable style={styles.quickActionCard}>
            <View style={styles.quickActionIcon}><Text style={{ fontSize: 20 }}>??</Text></View>
            <Text style={styles.quickActionText}>Performance</Text>
          </Pressable>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
         <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginLeft: 4 }}>RECENT INBOX</Text>
         <Text style={{ color: '#0D4E35', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' }}>View All</Text>
      </View>

      <View style={{ marginBottom: 24 }}>
        {[...studentNotices, ...studentNotifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 3).map((notice) => (
          <View key={notice.id} style={[styles.listBlock, { borderLeftWidth: 4, borderLeftColor: '#0D4E35', gap: 4, backgroundColor: '#FFFFFF' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
               <Text style={[styles.rowTitle, { fontSize: 15 }]}>{notice.title || 'Notification'}</Text>
               <Text style={{ fontSize: 11, color: '#6B7280' }}>{prettyDate(notice.created_at)}</Text>
            </View>
            <Text style={[styles.rowText, { marginTop: 0 }]} numberOfLines={2}>{notice.content}</Text>
          </View>
        ))}
        {([...studentNotices, ...studentNotifications].length === 0) && (
           <Text style={styles.emptyBody}>No recent notifications.</Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', backgroundColor: '#E4EBE5', borderRadius: 16, padding: 20, justifyContent: 'space-between', marginBottom: 40 }}>
         <View style={{ alignItems: 'center', flex: 1, borderRightWidth: 1, borderRightColor: '#d3d9e0' }}>
            <Text style={{ color: '#111827', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>ATTENDANCE</Text>
            <Text style={{ color: '#0D4E35', fontSize: 22, fontWeight: '900', marginTop: 8 }}>28</Text>
         </View>
         <View style={{ alignItems: 'center', flex: 1, borderRightWidth: 1, borderRightColor: '#d3d9e0' }}>
            <Text style={{ color: '#111827', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>SCORE</Text>
            <Text style={{ color: '#0D4E35', fontSize: 22, fontWeight: '900', marginTop: 8 }}>80%</Text>
         </View>
         <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ color: '#111827', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>RANK</Text>
            <Text style={{ color: '#0D4E35', fontSize: 22, fontWeight: '900', marginTop: 8 }}>Top</Text>
         </View>
      </View>
    </>
  );'''

code = re.sub(overview_regex, new_overview, code, flags=re.DOTALL)

# Replace renderStudentPortal layout logic
portal_regex = r'<SectionCard title=\{student\.name\}.*?</SectionCard>'
new_portal_header = '''<View style={styles.studentHeaderRow}>
        <View style={styles.studentAvatarBox}>
          <Text style={styles.studentAvatarText}>??</Text>
        </View>
        <View style={styles.studentInfoCol}>
           <Text style={styles.studentNameHeader}>{student.name}</Text>
           <Text style={styles.studentIdHeader}>ID: {student.student_uid}</Text>
        </View>
        <View style={styles.studentBatchPill}>
           <Text style={styles.studentBatchText}>{student.current_batch || 'N/A'}</Text>
        </View>
      </View>'''

code = re.sub(portal_regex, new_portal_header, code, flags=re.DOTALL)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated view components.")

