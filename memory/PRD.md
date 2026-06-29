# Package Scanner – PRD

## Overview
Mobile scanner app (Expo React Native) for warehouse/delivery staff to identify
Amazon/Flipkart packages by reading the printed Order ID with the camera and looking
it up in a Google-Sheet-synced local database.

## Architecture
- **Frontend**: Expo Router (file-based tabs), expo-camera, expo-haptics, expo-clipboard, expo-sharing.
- **Backend**: FastAPI + MongoDB (motor). Stores synced orders + settings.
- **OCR**: backend `/api/ocr` uses Emergent LLM key (gpt-4o-mini vision via
  `emergentintegrations`) so the preview works inside Expo Go. For production native
  builds, swap to on-device ML Kit (`@react-native-ml-kit/text-recognition` or
  vision-camera frame processor) by editing only `app/(tabs)/index.tsx::handleOcrResult`.
- **Sheet sync**: backend converts the edit URL to a CSV export URL and pulls rows
  with `httpx` (follow_redirects). Sheet must be "Anyone with the link can view".

## Key Files
- `backend/server.py` – API: `/api/settings`, `/api/sync`, `/api/orders`,
  `/api/orders/search`, `/api/orders/lookup`, `/api/ocr`, `/api/health`.
- `frontend/app/(tabs)/index.tsx` – Live scan screen.
- `frontend/app/(tabs)/search.tsx` – Manual search.
- `frontend/app/(tabs)/history.tsx` – Local scan history.
- `frontend/app/(tabs)/settings.tsx` – Sheet URL + manual sync.
- `frontend/src/components/ScanResultSheet.tsx` – Result bottom sheet.
- `frontend/src/lib/api.ts` – API client + local cache (AsyncStorage) + offline lookup + fuzzy matching.

## Features Implemented
- Real-time scan loop (1.5 s cadence) inside a centered rectangle with dim overlay.
- Auto-pause on detection + haptic success + 120 ms primary-color flash.
- Duplicate protection — same Order ID does not re-fire until ≥ 2 frames without a detection.
- Fuzzy matching for common OCR confusions (0↔O, 1↔I/L, 5↔S, 8↔B, 2↔Z) — backend and client.
- Manual search across order ID, name, phone, product (offline against cached orders).
- Scan history (last 200 scans) stored locally via `@/src/utils/storage`.
- Settings: sheet URL + manual sync + last-sync metadata.
- Camera permission flow with `Linking.openSettings()` fallback respected by RN.
- Sheet column mapping per spec: B=Order ID, C=Date, D=Customer, E=Phone, F=Product, R=Amount.

## Not Implemented / Future
- True on-device ML Kit OCR (deferred to native dev build; see comments at top of
  `app/(tabs)/index.tsx`).
- Audio beep on success — currently haptic-only (avoid extra `expo-audio` dependency
  for first cut).
- WhatsApp send, payment confirmation, collection log, barcode support, cloud migration
  (explicit "future" items in the spec).

## Configuration
- `backend/.env`: `MONGO_URL`, `DB_NAME`, `EMERGENT_LLM_KEY`.
- `frontend/.env`: `EXPO_PUBLIC_BACKEND_URL` (preset).
- Sheet URL is entered in Settings inside the app.
