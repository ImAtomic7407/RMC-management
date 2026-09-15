import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Update Student Login
sl_regex = r'const renderStudentLogin = \(\) => \(\s*<ScrollView.*?>\s*<SectionCard title="Student Portal".*?</SectionCard>\s*</ScrollView>\s*\);'
new_sl = '''const renderStudentLogin = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={{ marginBottom: 30 }}>
         <Text style={{ color: '#111827', fontSize: 32, fontWeight: '900', letterSpacing: -1 }}>Student Portal</Text>
         <Text style={{ color: '#6B7280', fontSize: 14, fontWeight: '600', marginTop: 4 }}>Concept se selection tak starts here.</Text>
      </View>

      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 3 }}>
        <LabeledInput label="Student UID" value={studentUid} onChangeText={setStudentUid} placeholder="RMC-..." autoCapitalize="characters" />
        <View style={{ marginVertical: 20, flexDirection: 'row', alignItems: 'center' }}>
           <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
           <Text style={{ marginHorizontal: 10, color: '#9CA3AF', fontSize: 12, fontWeight: '700' }}>OR TRIO-LOCK</Text>
           <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
        </View>
        <LabeledInput label="Your Name" value={studentName} onChangeText={setStudentName} placeholder="Full name" />
        <LabeledInput label="Father Name" value={studentFather} onChangeText={setStudentFather} placeholder="Father name" />
        <LabeledInput label="Phone" value={studentPhone} onChangeText={setStudentPhone} placeholder="+91..." keyboardType="phone-pad" />
        
        <View style={{ marginTop: 20 }}>
          <PrimaryButton title="Login Now" onPress={handleStudentLogin} />
          <View style={{ height: 12 }} />
          <PrimaryButton title="Scan Student QR" onPress={() => setStudentScannerVisible(true)} tone="secondary" />
        </View>
      </View>
    </ScrollView>
  );'''

code = re.sub(sl_regex, new_sl, code, flags=re.DOTALL)

# Update Staff Login
staf_regex = r'const renderStaffLogin = \(\) => \(\s*<ScrollView.*?>\s*<SectionCard title="Admin Login".*?</SectionCard>\s*</ScrollView>\s*\);'
new_staf = '''const renderStaffLogin = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={{ marginBottom: 30 }}>
         <Text style={{ color: '#111827', fontSize: 32, fontWeight: '900', letterSpacing: -1 }}>Admin Workspace</Text>
         <Text style={{ color: '#6B7280', fontSize: 14, fontWeight: '600', marginTop: 4 }}>Authorized access for RMC staff only.</Text>
      </View>

      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 3 }}>
        <LabeledInput label="Staff Username" value={staffUsername} onChangeText={setStaffUsername} placeholder="teacher01" autoCapitalize="none" />
        <View style={{ height: 16 }} />
        <LabeledInput label="Security Password" value={staffPassword} onChangeText={setStaffPassword} placeholder="••••••••" secureTextEntry />
        
        <View style={{ marginTop: 30 }}>
          <PrimaryButton title="Enter Workspace" onPress={handleStaffLogin} />
          <View style={{ height: 12 }} />
          <PrimaryButton title="Scan Staff ID" onPress={() => setStaffScannerVisible(true)} tone="secondary" />
        </View>
      </View>
    </ScrollView>
  );'''

code = re.sub(staf_regex, new_staf, code, flags=re.DOTALL)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Modernized Login screens.")

