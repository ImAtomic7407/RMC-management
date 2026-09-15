# RMC Mobile

Android client for the existing `server/server.js` RMC backend.

## What it includes

- Configurable server URL for LAN, tunnel, or production host
- Student login by UID, trio-lock details, or QR
- Student portal for materials, notices, and personal notifications
- Staff login by password or QR
- Staff attendance flow with batch selection, active-session controls, roster view, and QR marking
- Host-only staff card creation

## Run

```bash
cd "G:\node.js(RMC)\rmc-mobile"
npm install
npm run start
```

Then press `a` in Expo, or run:

```bash
npm run android
```

## Server notes

- The mobile app expects the Node server to be reachable from the phone.
- Use a LAN URL like `http://192.168.x.x:3000` or your cloud tunnel URL.
- The app uses the server's cookie-based session and the added `/api/session`, `/api/logout`, and `/api/student/logout` JSON routes.

## Release Builds

Preview APK:

```bash
npm run build:preview
```

Production AAB for Play Store:

```bash
npm run build:production
```

The app is also configured for local signed Android release builds through `android/app/build.gradle`. See [deployment.md](../docs/deployment.md) for keystore and hosting steps.
