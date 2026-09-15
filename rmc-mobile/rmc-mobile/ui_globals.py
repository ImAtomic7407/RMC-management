import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# I will append new styles for ID card and User Info to the stylesheet
new_styles = '''
  idCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  idCardHeaderLeft: { gap: 0 },
  idCardLogoText: { color: '#004b87', fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  idCardSubLogoText: { color: '#004b87', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: -4 },
  idCardHeaderCenter: { alignItems: 'center', marginHorizontal: 10 },
  idCardCenterSmall: { color: '#687076', fontSize: 12, fontWeight: '800' },
  idCardHeaderRight: { },
  idCardYearBig: { color: '#004b87', fontSize: 26, fontWeight: '900' },
  idCardDivider: { height: 1, backgroundColor: '#d3d9e0', width: '100%' },
  idCardBody: { backgroundColor: '#F8FAFC', padding: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, alignItems: 'center', overflow: 'hidden' },
  idWatermark: { position: 'absolute', top: 50, left: 10, right: 0, bottom: 0, opacity: 0.03, alignItems: 'center', justifyContent: 'center' },
  idWatermarkText: { fontSize: 140, fontWeight: '900', color: '#000000', textAlign: 'center' },
  idBodyLogoMain: { color: '#cc2b2b', fontSize: 32, fontWeight: '900', letterSpacing: 2 },
  idBodyLogoSub: { color: '#004b87', fontSize: 13, fontWeight: '800', marginTop: -4 },
  idBatchPill: { backgroundColor: '#E2E8F0', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, marginTop: 10, marginBottom: 12 },
  idBatchPillText: { color: '#cc2b2b', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  idFacesRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 10, marginBottom: 12 },
  idQrFrame: { width: 100, height: 100, backgroundColor: '#FFF', borderRadius: 8, borderWidth: 1, borderColor: '#d3d9e0', alignItems: 'center', justifyContent: 'center', padding: 4 },
  idPhotoFrame: { width: 100, height: 110, borderRadius: 8, borderWidth: 1, borderColor: '#d3d9e0', overflow: 'hidden', backgroundColor: '#F1F5F9' },
  idPhotoReal: { width: '100%', height: '100%' },
  idDetailsBlock: { alignItems: 'center', gap: 2, width: '100%', marginTop: 4 },
  idNameText: { color: '#111827', fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  idUidText: { color: '#111827', fontSize: 13, fontWeight: '800' },
  idFnoText: { color: '#111827', fontSize: 12, fontWeight: '800' },
  idParentText: { color: '#111827', fontSize: 13, fontWeight: '700', marginTop: 2 },
  idGuardianText: { color: '#6B7280', fontSize: 11, fontWeight: '800', marginTop: 2, textTransform: 'uppercase' },
  idCardFooter: { marginTop: 12, paddingVertical: 8 },
  idCardFooterLink: { color: '#6B7280', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
'''

code = code.replace("idCardPro: {", new_styles + "\n  idCardPro: {")

# To apply light theme, we manually replace root color and SectionCard color.
# The user wants "floating yet compact and spaced design"
# Re-route the student tabs to look like Quick Actions.
code = code.replace("root: { flex: 1, backgroundColor: '#132014' }", "root: { flex: 1, backgroundColor: '#F4F9F4' }")
code = code.replace("backgroundColor: '#1A2B1D'", "backgroundColor: '#FFFFFF'")
code = code.replace("shadowColor: '#3E5041'", "shadowColor: '#0c4e36'")
code = code.replace("color: '#FFFFFF'", "color: '#111827'")
# Quick actions box text uses a dark green text
code = code.replace("color: '#1A2B1D'", "color: '#0D4E35'")
# Secondary button color update
code = code.replace("backgroundColor: '#3E5041'", "backgroundColor: '#E4EBE5'")

# Wait, IdCardFront has inline overrides if needed, but styling was just defined above using specific HEX colors rather than #111827 directly so they will be replaced.
# Actually my injected string idCardLogoText: { color: '#004b87' ... } uses #004b87. 
# If I inject that into the string *after* the replace, it won't be harmed. Let's do that!

with open('A:/RMC_Local_Installer/scratch/App_backup.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Let's perform replacements on standard styling:
text = text.replace("root: { flex: 1, backgroundColor: '#132014' }", "root: { flex: 1, backgroundColor: '#F4F9F4' }")
text = text.replace("backgroundColor: '#1A2B1D'", "backgroundColor: '#FFFFFF'")
text = text.replace("color: '#FFFFFF'", "color: '#111827'")
text = text.replace("shadowColor: '#3E5041'", "shadowColor: '#0c4e36'")
text = text.replace("backgroundColor: '#3E5041'", "backgroundColor: '#E4EBE5'")

text = text.replace("idCardPro: {", new_styles + "\n  idCardPro: {")

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated style definitions.")

