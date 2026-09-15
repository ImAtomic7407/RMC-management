import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

welcome_regex = r'const renderWelcome = \(\) => \(\s*<ScrollView.*?>\s*<SectionCard title="Welcome to RMC".*?</SectionCard>'
new_welcome = '''const renderWelcome = () => (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <View style={{ backgroundColor: '#111827', width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#0c4e36', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 5 }}>
          <Text style={{ color: '#E4EBE5', fontSize: 24, fontWeight: '900', letterSpacing: -1 }}>R</Text>
        </View>
        <Text style={{ color: '#111827', fontSize: 28, fontWeight: '900', marginTop: 12, letterSpacing: -1 }}>RMC Portal</Text>
        <Text style={{ color: '#6B7280', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 4 }}>CONCEPT SE SELECTION TAK</Text>
      </View>
      
      <View style={{ backgroundColor: '#111827', borderRadius: 20, padding: 24, marginBottom: 16 }}>
        <Text style={{ color: '#E4EBE5', fontSize: 20, fontWeight: '800', marginBottom: 8 }}>Welcome to RMC</Text>
        <Text style={{ color: '#8EA496', fontSize: 13, lineHeight: 20, marginBottom: 20 }}>Access your digital academic ecosystem. Sign in as a student to view materials, attendance, and ID cards, or register below.</Text>
        <PrimaryButton title="Launch Dashboard" onPress={() => setGuestTab('student')} />
      </View>

      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 16 }}>
         <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2 }}>
            <Text style={{ fontSize: 24 }}>??</Text>
            <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '900', marginTop: 12 }}>24+ ACTIVE</Text>
            <Text style={{ color: '#6B7280', fontSize: 11, fontWeight: '800' }}>BATCHES</Text>
         </View>
         <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2 }}>
            <Text style={{ fontSize: 24 }}>??</Text>
            <Text style={{ color: '#0D4E35', fontSize: 13, fontWeight: '900', marginTop: 12 }}>AES SECURE</Text>
            <Text style={{ color: '#6B7280', fontSize: 11, fontWeight: '800' }}>PROTOCOL</Text>
         </View>
      </View>

      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, shadowColor: '#0c4e36', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 2, marginBottom: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
         <View>
             <Text style={{ color: '#111827', fontSize: 14, fontWeight: '900' }}>STUDENT ID</Text>
             <Text style={{ color: '#6B7280', fontSize: 11, fontWeight: '800', marginTop: 2 }}>RMC-240892</Text>
         </View>
         <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: '#E4EBE5', alignItems: 'center', justifyContent: 'center' }}>
             <Text style={{ fontSize: 24 }}>??</Text>
         </View>
      </View>'''

code = re.sub(welcome_regex, new_welcome, code, flags=re.DOTALL)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Applied Welcome structure.")

