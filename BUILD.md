# Build / Deployment Notes — Package Scanner

## Build profiles (`eas.json`)

| Profile | Output | When to use |
|---------|--------|-------------|
| `development` | Debug APK with **expo-dev-client** | Iterative dev with hot-reload over LAN/USB. `npx expo start --dev-client` connects to it. |
| `preview`  ⭐ | **Release-style APK**, internally distributed | Sideload onto your phone for QA. **This is what you want for testing the ML Kit scanner.** |
| `production` | AAB (Android App Bundle) | Submit to Play Store. |

## How to produce the preview APK

You have two paths:

### Path A — Emergent Publish (zero local setup)
1. Click **Publish** in Emergent (top-right).
2. Choose **Android**, profile **preview**.
3. Provide / generate keystore when prompted.
4. ~10–15 min later: download the APK from the build artifact link.
5. Transfer the APK to your phone (USB or email), tap to install (enable "Install unknown apps" for the source app).
6. Open → grant camera permission → live ML Kit OCR runs.

### Path B — Local EAS Build (after `Save to GitHub` + clone)
```bash
git clone <your-repo>
cd <repo>/frontend
yarn install                          # patch-package auto-runs via postinstall
npm install -g eas-cli
eas login                             # use your own Expo account
eas build --profile preview --platform android
```
EAS performs `expo prebuild` on its servers, applies the OCR-plus patch, compiles, signs, and returns an APK URL.

## Critical setup that's already in place
- **`expo-dev-client`** installed — required for development/preview builds.
- **`eas.json`** — `development` / `preview` / `production` profiles. `preview` is APK + release build.
- **`patches/react-native-vision-camera-ocr-plus+2.0.1.patch`** — fixes the upstream `Camera.js` trailing-token bug. Auto-applied on every `yarn install` via the `postinstall` script.
- **`app.json`** — camera permissions for Android/iOS, unique `android.package` + iOS `bundleIdentifier` (required by EAS).
- **`react-native-worklets@0.10.0`** pinned (>= 0.8 needed by ocr-plus).
- Runtime feature-detection in `app/(tabs)/index.tsx` — silently falls back to `ScannerFallback` if the native module isn't linked (so Expo Go preview never crashes).

## Things you might want to change before building
- **`app.json` → `android.package`** — currently `com.emergent.packagescanner`. If you have a real package name, swap it.
- **`app.json` → `name`** — currently "Package Scanner".
- **App icon / splash** — under `assets/images/`.

## Things the build server will do automatically
- Run `yarn install` → triggers `postinstall` → applies patches/*.patch.
- Run `npx expo prebuild` → generates fresh `android/` directory.
- Compile with Gradle.
- Sign with your keystore.
- Upload artifact.

## Local verification done in this container
- `npx expo prebuild --platform android --no-install --clean` succeeds.
- `patch-package` apply succeeds on fresh `yarn install`.
- ESLint clean.
- Backend API + sheet sync work; Search & Settings tabs work in preview.

## Why no APK is produced inside this container
Android SDK / Gradle / JDK is not available in the Emergent dev container, and there is no artifact-download channel back to your machine for binaries. Both Path A (Emergent Publish) and Path B (EAS) are the supported routes.
