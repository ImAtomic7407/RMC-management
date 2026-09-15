import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Remove PillTabs for Student
code = re.sub(r'<PillTabs items=\{studentTabs\} value=\{studentTab\} onChange=\{\(value\) => setStudentTab\(value as StudentTab\)\} />', '', code)

# We wrap renderStudentPortal inside a view and add bottom nav
portal_regex = r'const renderStudentPortal = \(student: StudentProfile\) => \(\s*<ScrollView(.*?)>\s*(.*?)\s*</ScrollView>\s*\);'

# Replace with:
def replacer(match):
    scroll_attrs = match.group(1)
    scroll_content = match.group(2)
    return f'''const renderStudentPortal = (student: StudentProfile) => (
    <View style={{{{ flex: 1 }}}}>
      <ScrollView{scroll_attrs}>
        {scroll_content}
      </ScrollView>
      <View style={{{{ flexDirection: 'row', backgroundColor: '#FFFFFF', paddingBottom: 30, paddingTop: 10, paddingHorizontal: 10, borderTopLeftRadius: 30, borderTopRightRadius: 30, shadowColor: '#0c4e36', shadowOpacity: 0.1, shadowOffset: {{{{ width: 0, height: -4 }}}}, shadowRadius: 10, elevation: 15 }}}}>
        <Pressable style={{{{ flex: 1, alignItems: 'center', justifyContent: 'center' }}}} onPress={{() => setStudentTab('overview')}}>
           <View style={{{{ width: 64, height: 44, borderRadius: 22, backgroundColor: studentTab === 'overview' ? '#0D4E35' : 'transparent', alignItems: 'center', justifyContent: 'center' }}}}>
              <Text style={{{{ color: studentTab === 'overview' ? '#FFF' : '#8EA496', fontSize: 18 }}}}>??</Text>
           </View>
           <Text style={{{{ color: studentTab === 'overview' ? '#0D4E35' : '#8EA496', fontSize: 10, fontWeight: '900', marginTop: 4 }}}}>HOME</Text>
        </Pressable>
        <Pressable style={{{{ flex: 1, alignItems: 'center', justifyContent: 'center' }}}} onPress={{() => setStudentTab('doubts')}}>
           <View style={{{{ width: 64, height: 44, borderRadius: 22, backgroundColor: studentTab === 'doubts' ? '#0D4E35' : 'transparent', alignItems: 'center', justifyContent: 'center' }}}}>
              <Text style={{{{ color: studentTab === 'doubts' ? '#FFF' : '#8EA496', fontSize: 18 }}}}>?</Text>
           </View>
           <Text style={{{{ color: studentTab === 'doubts' ? '#0D4E35' : '#8EA496', fontSize: 10, fontWeight: '900', marginTop: 4 }}}}>DOUBTS</Text>
        </Pressable>
        <Pressable style={{{{ flex: 1, alignItems: 'center', justifyContent: 'center' }}}}>
           <View style={{{{ width: 64, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}}}>
              <Text style={{{{ color: '#8EA496', fontSize: 18 }}}}>??</Text>
           </View>
           <Text style={{{{ color: '#8EA496', fontSize: 10, fontWeight: '900', marginTop: 4 }}}}>MATERIALS</Text>
        </Pressable>
        <Pressable style={{{{ flex: 1, alignItems: 'center', justifyContent: 'center' }}}}>
           <View style={{{{ width: 64, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}}}>
              <Text style={{{{ color: '#8EA496', fontSize: 18 }}}}>??</Text>
           </View>
           <Text style={{{{ color: '#8EA496', fontSize: 10, fontWeight: '900', marginTop: 4 }}}}>SCHEDULE</Text>
        </Pressable>
      </View>
    </View>
  );'''

code = re.sub(portal_regex, replacer, code, flags=re.DOTALL)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Applied Bottom Nav structure.")

