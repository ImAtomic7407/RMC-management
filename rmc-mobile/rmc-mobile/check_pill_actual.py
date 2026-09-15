import sys

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

start_p = text.find('function PillTabs')
print(text[start_p:start_p+800])

