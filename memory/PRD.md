# Package Scanner – PRD

## Overview
Mobile scanner (Expo React Native) for warehouse/delivery staff to identify
Amazon/Flipkart packages by reading the printed Order ID with the camera and looking
it up in a Google-Sheet-synced local database. All OCR runs **on-device** using Google
ML Kit Text Recognition v2.

## Architecture
- **Frontend**: Expo Router (file-based tabs).
- **Live OCR**: `react-native-vision-camera` v5 + `react-native-vision-camera-ocr-plus`
  v2 (Nitro Modules; Google ML Kit v2 on Android & iOS).
- **Camera config**: `useCameraFormat` requests 1280×720 / 30 fps; the Camera is
  capped to `fps={15}` and `frameSkipThreshold: 2` (effective OCR ≈ 7 Hz, well within
  the spec).
- **Cropping**: `scanRegion` on the OCR plugin restricts recognition to the centered
  rectangle (left 10% / top 42% / width 80% / height 16%) — exactly the rectangle the
  user sees on screen. Frames outside the rectangle are never analyzed.
- **Backend** (FastAPI + MongoDB) is now used **only** for syncing the Google Sheet,
  serving orders + search + lookup. No image ever leaves the device. `/api/ocr` is
  retained as an *optional debug-only* endpoint and is NOT invoked from the app.
- **Local cache**: synced orders are stored on the device (`@/src/utils/storage`) so
  scanning is fully offline after the first sync.

## OCR Pipeline (Production)
1. `<OcrCamera>` (vision-camera-ocr-plus) streams frames from CameraX at 15 fps.
2. ML Kit v2 runs Latin text recognition inside the `scanRegion` only.
3. Plugin callback fires with `{ resultText }` on every recognized frame.
4. Client regex extracts Order IDs:
   - `OD[A-Z0-9]{15,22}` (Flipkart)
   - `\d{3}-\d{7}-\d{7}` (Amazon US)
   - `\d{15,22}` (long numeric)
5. **Two-consecutive-frame confirmation** — same ID must appear in ≥ 2 frames before
   acceptance (eliminates one-off OCR misreads).
6. Once accepted: vibrate (`Haptics.notificationAsync(Success)`), screen flash, look
   up locally (with fuzzy 0↔O, 1↔I/L, 5↔S, 8↔B, 2↔Z fallback), and present
   `ScanResultSheet`. Camera deactivates until user taps **Scan Next**.
7. If ML Kit returns nothing or no match: the consecutive counter resets so the same
   package will not re-fire until it leaves and re-enters the frame.

## Runtime Modes
| Mode | Behavior |
|---|---|
| Expo Go / web preview | `ScannerFallback` renders. Search / History / Settings / Sync all work. |
| Native dev / production build | `MLKitScanner` renders — full on-device OCR. |

Detection uses `NativeModules.CameraDevices` presence — no JS errors thrown in Expo
Go because the heavy `MLKitScanner` module is loaded with `require()` only after the
native check passes.

## Key Files
- `frontend/app/(tabs)/index.tsx` – Runtime feature switch.
- `frontend/src/components/MLKitScanner.tsx` – Production vision-camera + ML Kit pipeline.
- `frontend/src/components/ScannerFallback.tsx` – Preview-mode notice + sync.
- `frontend/src/components/ScanResultSheet.tsx` – Bottom-sheet result.
- `frontend/app/(tabs)/{search,history,settings}.tsx` – Other tabs (unchanged).
- `frontend/src/lib/api.ts` – Backend client + offline cache + Order-ID regex + fuzzy lookup.
- `backend/server.py` – Sheets sync, orders, search, lookup. `/api/ocr` retained as
  optional debug-only endpoint (never called by the production frontend).

## Sheet Configuration
- Public CSV export (`Anyone with the link can view`).
- Columns: B=Order ID, C=Date, D=Customer, E=Phone, F=Product, R=Amount.
- Synced via **Refresh** button. Sheet is **only** queried on Refresh, never per scan.

## Known Constraints
- Expo Go does **not** support native modules → preview shows fallback. Live OCR
  activates after the user clicks **Publish** in Emergent (generates a dev/prod build).
- Patched `react-native-vision-camera-ocr-plus@2.0.1` post-install — the published
  `lib/{module,commonjs}/Camera.js` had a trailing-token publish artifact that breaks
  the babel parser (last `}` and a corrupted source-map comment). The patch trims the
  trailing junk so Metro can bundle. Once upstream republishes (issue can be filed),
  the patch becomes redundant.
- `react-native-worklets` is pinned at `0.10.0` (vision-camera-ocr-plus v2 requires
  `>= 0.8.0`). `react-native-reanimated@4.1.1` peer is `worklets >= 0.5.0`, so the
  bump is safe; only a "doctor" warning is emitted.

## Future
- Optional audio beep alongside haptic (bundle a 100 ms WAV asset + `expo-audio`).
- WhatsApp integration, payment confirmation, collection log, barcode support, cloud DB.
