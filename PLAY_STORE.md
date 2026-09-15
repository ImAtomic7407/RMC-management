# Play Store Publishing

Steps to build and publish the RMC Mobile app to Google Play Store.

## Prerequisites
- Google Play Developer account
- Signing keystore (`.keystore` file with private key, never commit to git)
- App privacy policy
- Android Studio (for building)

## Generate Signing Keystore (one-time)

```bash
keytool -genkey -v -keystore release.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias my_key
```

Keep this file **SAFE and NEVER commit to git**.

## Set Signing Credentials

**Windows PowerShell**:
```powershell
$env:KEYSTORE_PATH = "C:\path\to\release.keystore"
$env:KEYSTORE_PASSWORD = "your_password"
$env:KEY_ALIAS = "my_key"
$env:KEY_PASSWORD = "your_password"
```

**Linux/Mac**:
```bash
export KEYSTORE_PATH="/path/to/release.keystore"
export KEYSTORE_PASSWORD="your_password"
export KEY_ALIAS="my_key"
export KEY_PASSWORD="your_password"
```

## Build Release AAB (Android App Bundle)

```bash
cd rmc-mobile
npm run build:aab

# Output: android/app/build/outputs/bundle/release/app-release.aab
```

## Upload to Play Console

1. Go to https://play.google.com/console
2. Select app → **Releases** → **Production**
3. **Create release** → Upload `app-release.aab`
4. Fill release notes, review policies
5. **Roll out** → confirm

**First release takes 2-4 hours for review.**

## For Each Update

- Increment `versionCode` in `android/app/build.gradle`
- Rebuild: `npm run build:aab`
- Upload to Play Console
- Test in internal/beta track first

## Key Files to Know

- Build config: `android/app/build.gradle` (signing, minification, version)
- App entry: `App.tsx` (features, dev overrides)
- Exam server URL: `App.tsx` → `EXAM_SERVER_URL_OVERRIDE`

For APK testing or manual distribution, use `npm run build:apk`.
