import re

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Remove the appVersionBar from the Root render
appver_regex = r'<View style=\{styles\.appVersionBar\}>.*?</View>'
code = re.sub(appver_regex, '', code, flags=re.DOTALL)

with open('A:/RMC_Local_Installer/rmc-mobile/App.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Removed AppVersionBar.")
