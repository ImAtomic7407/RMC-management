import sys

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

start_sh = text.find('const renderStaffHome = () => (')
if start_sh == -1:
    start_sh = text.find('const renderStaffHome = ')

print(text[start_sh:start_sh+3000])

