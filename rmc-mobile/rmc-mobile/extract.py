import sys

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

start_w = text.find('const renderWelcome = () => (')
if start_w == -1:
    start_w = text.find('const renderWelcome = ')

end_w = text.find('const renderStudentLogin = () => (')

print(text[start_w:end_w])

