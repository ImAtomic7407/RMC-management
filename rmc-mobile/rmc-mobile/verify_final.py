import sys

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Check for renderStudentOverview and renderStudentPortal
print("Overview start:", text.find('const renderStudentOverview = () => ('))
print("Portal start:", text.find('const renderStudentPortal = (student: StudentProfile) => ('))
print("PillTabs check:", 'backgroundColor: props.value === item.key ?' in text)
