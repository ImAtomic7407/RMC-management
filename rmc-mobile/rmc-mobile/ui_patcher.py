import re

with open('A:/RMC_Local_Installer/scratch/App_backup.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update idCardPro and IdCardFront components
id_card_front_str = '''const IdCardFront = ({ student, frontInterpolate, frontOpacity, baseUrl }: { student: StudentProfile, frontInterpolate: Animated.AnimatedInterpolation<string>, frontOpacity: Animated.AnimatedInterpolation<number>, baseUrl: string }) => (
  <Animated.View style={[styles.idCardPro, { transform: [{ rotateY: frontInterpolate }], opacity: frontOpacity }]}>
    <View style={styles.idCardHeader}>
      <View style={styles.idCardHeaderLeft}>
        <Text style={styles.idCardLogoText}>RMC</Text>
        <Text style={styles.idCardSubLogoText}>INSTITUTE</Text>
      </View>
      <View style={styles.idCardHeaderCenter}>
        <Text style={styles.idCardCenterSmall}>IDENTITY</Text>
        <Text style={styles.idCardCenterSmall}>CARD</Text>
      </View>
      <View style={styles.idCardHeaderRight}>
        <Text style={styles.idCardYearBig}>2025-26</Text>
      </View>
    </View>
    <View style={styles.idCardDivider} />
    
    <View style={styles.idCardBody}>
      <View style={styles.idWatermark}><Text style={styles.idWatermarkText}>RMC</Text></View>
      <Text style={styles.idBodyLogoMain}>RMC</Text>
      <Text style={styles.idBodyLogoSub}>Concept Se Selection tak</Text>
      
      <View style={styles.idBatchPill}>
        <Text style={styles.idBatchPillText}>{student.current_batch || 'GENERAL_BATCH'}</Text>
      </View>
      
      <View style={styles.idFacesRow}>
        <View style={styles.idQrFrame}>
          <QRCode value={JSON.stringify({ n: student.name, u: student.student_uid, r: 'student' })} size={90} color="#000" backgroundColor="#FFF" />
        </View>
        <View style={styles.idPhotoFrame}>
          <Image source={student.photo_path ? { uri: makeAbsoluteUrl(baseUrl, student.photo_path) } : require('./assets/avatar_placeholder.png')} style={styles.idPhotoReal} />
        </View>
      </View>
      
      <View style={styles.idDetailsBlock}>
        <Text style={styles.idNameText}>{(student.name || 'UNKNOWN').toUpperCase()}</Text>
        <Text style={styles.idUidText}>{student.student_uid || 'UID-N/A'}</Text>
        <Text style={styles.idFnoText}>FNO: {student.phone || 'N/A'}  FBC: {student.fbc_no || '-'}</Text>
        <Text style={styles.idParentText}>Father's Name: {student.father_name || 'N/A'}</Text>
        <Text style={styles.idGuardianText}>GUARDIAN: {student.guardian_phone || 'N/A'} | CLASS: {student.current_batch || 'N/A'}</Text>
      </View>
      
      <View style={styles.idCardFooter}>
        <Text style={styles.idCardFooterLink}>Show Details {"->"}</Text>
      </View>
    </View>
  </Animated.View>
);'''

code = re.sub(
    r'const IdCardFront =.*?Animated\.View>\s*\n\);', 
    id_card_front_str, 
    code, 
    flags=re.DOTALL
)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Replaced IdCardFront component.")
