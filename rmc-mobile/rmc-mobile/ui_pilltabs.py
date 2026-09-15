import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# I will update the PillTabs component to look more professional
pill_regex = r'function PillTabs\(props: \{ items: Array<\{ key: string; label: string \}>; value: string; onChange: \(value: string\) =\> void \} \) \{.*?\}'
new_pill = '''function PillTabs(props: { items: Array<{ key: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, paddingHorizontal: 20 }} contentContainerStyle={{ gap: 8, paddingRight: 40, paddingVertical: 10 }}>
      {props.items.map((item) => (
        <Pressable 
          key={item.key} 
          onPress={() => props.onChange(item.key)} 
          style={{ 
            paddingHorizontal: 16, 
            paddingVertical: 10, 
            borderRadius: 12, 
            backgroundColor: props.value === item.key ? '#0D4E35' : '#FFFFFF',
            shadowColor: '#0c4e36',
            shadowOpacity: props.value === item.key ? 0.2 : 0.05,
            shadowOffset: { width: 0, height: 2 },
            shadowRadius: 4,
            elevation: 2,
            borderWidth: props.value === item.key ? 0 : 1,
            borderColor: '#E4EBE5'
          }}
        >
          <Text numberOfLines={1} style={{ 
            color: props.value === item.key ? '#FFFFFF' : '#6B7280', 
            fontSize: 13, 
            fontWeight: '900',
            letterSpacing: 0.5
          }}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}'''

code = re.sub(pill_regex, new_pill, code, flags=re.DOTALL)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Modernized PillTabs component.")

