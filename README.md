# AI UNIVERSAL SIGNAL RADAR

Standalone Android screen-observation app with a stateful analysis backend.

## Current status
This is an initial engineering scaffold, not a released APK or validated trading system. The backend deliberately returns STANDBY until a real vision/model adapter and validation dataset are configured. It never invents prices or signals.

## Components
- `backend/`: FastAPI health, session, authenticated frame-ingestion and conservative decision contract.
- `android/`: Android app scaffold for START/STOP and MediaProjection capture.
- `PROJECT-HANDOFF.md`: approved requirements and continuity record.

## Backend
Python 3.11+:
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
RADAR_INGEST_TOKEN='replace-with-a-long-random-secret' uvicorn app:app --host 0.0.0.0 --port 8000
```
Set `RADAR_INGEST_TOKEN` only in the server environment. Do not commit it or embed it in the APK.

## Android
Open `android/` in Android Studio (recent stable version, JDK 17, Android SDK 35). Set the backend HTTPS URL in `local.properties`/BuildConfig before use. Android MediaProjection always requires the user's system permission prompt. A fresh session requires fresh consent.

## Important
No automatic broker orders. Screenshot sampling is not a tick feed. Universal broker compatibility is a test target, not a guarantee. Do not use for live trading until perception, signal logic, security, latency and out-of-sample performance are independently validated.
